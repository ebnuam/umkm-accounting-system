import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../db/schema.ts";
import { DrizzleSqliteAccountingRepository } from "../db/d1-repository.ts";
import { DrizzleSqliteAuthRepository } from "../db/auth-repository.ts";
import { createLocalSqliteRepository } from "../db/local-sqlite-repository.ts";
import { AccountingEngine, ValidationError, createEmptyWorkspace } from "../core/index.ts";
import { handleManageMembers, handleRegister, handleSwitchBusiness } from "../app/api/auth/_handler.ts";
import { handleMasterMutation, handlePostTransaction } from "../app/api/accounting/_handler.ts";

async function createD1Pair() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = await Promise.all([
    readFile(new URL("../drizzle/0000_stiff_mad_thinker.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_phase3_relational_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_phase45_hardening_constraints.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_phase6_auth_membership.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_phase8_universal_coa_manufacturing.sql", import.meta.url), "utf8"),
  ]);
  for (const sqlText of migrations) {
    for (const stmt of sqlText.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      sqlite.exec(stmt);
    }
  }
  const execQuery = (sql, params, method) => {
    const clean = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
    const prepared = sqlite.prepare(sql);
    if (method === "run") {
      prepared.run(...clean);
      return { rows: [] };
    }
    if (method === "get") {
      const row = prepared.get(...clean);
      return { rows: row ? Object.values(row) : [] };
    }
    const rows = prepared.all(...clean);
    return { rows: rows.map((r) => Object.values(r)) };
  };
  const db = drizzle(
    async (sql, params, method) => execQuery(sql, params, method),
    async (batch) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const res = batch.map((b) => execQuery(b.sql, b.params, b.method));
        sqlite.exec("COMMIT");
        return res;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    { schema },
  );
  return {
    repo: new DrizzleSqliteAccountingRepository(db),
    authRepo: new DrizzleSqliteAuthRepository(db),
    cleanup: async () => sqlite.close(),
  };
}

async function createSqlitePair() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "umkm-sector-"));
  const dbPath = path.join(tmpDir, "sector.sqlite");
  const repo = createLocalSqliteRepository({ dbPath });
  const authRepo = new DrizzleSqliteAuthRepository(repo.getDrizzleClient());
  return {
    repo,
    authRepo,
    cleanup: async () => {
      repo.close();
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

for (const adapter of [
  { name: "D1Adapter", create: createD1Pair },
  { name: "LocalSqliteAdapter", create: createSqlitePair },
]) {
  test(`Multi-sector Accounting (Service, Manufacturing WIP/BOM/Labor/Overhead, Custom COA, General Journal) — ${adapter.name}`, async () => {
    const { repo, cleanup } = await adapter.create();
    try {
      const engine = new AccountingEngine(repo);

      // --- 1. SERVICE BUSINESS (Usaha Jasa) + Custom COA + General Journal ---
      const tService = "t-service";
      await repo.initializeWorkspace(
        tService,
        createEmptyWorkspace(tService, {
          businessName: "Klinik Desain & Konsultan",
          businessSector: "service",
          activePeriod: "2026-09",
        }),
      );

      // Custom COA CRUD + Protected account check
      const customExp = await engine.createAccount(tService, "u1", {
        code: "5120",
        name: "Beban Lisensi Software",
        group: "expense",
      });
      assert.equal(customExp.nature, "nominal");
      assert.equal(customExp.normal, "debit");

      await assert.rejects(() => engine.toggleAccountActive(tService, "u1", "4102"), ValidationError);

      const clientA = await engine.createParty(tService, "u1", { name: "PT Karya", type: "customer" });
      const vendorSub = await engine.createParty(tService, "u1", { name: "Freelancer UI", type: "supplier" });

      const svcItem = await engine.createItem(tService, "u1", {
        name: "Jasa Audit Sistem",
        category: "service",
        unit: "paket",
        defaultSalePrice: 2_500_000,
      });
      assert.equal(svcItem.revenueAccountCode, "4102");
      assert.equal(svcItem.trackInventory, false);

      const subItem = await engine.createItem(tService, "u1", {
        name: "Subkontraktor Desain",
        category: "service",
        unit: "proyek",
      });

      await engine.postCapitalOrDrawing(tService, "u1", { type: "capital", date: "2026-09-01", amount: 5_000_000 });
      await engine.postSale(tService, "u1", {
        date: "2026-09-02",
        paymentMethod: "cash",
        itemId: svcItem.id,
        totalAmount: 1_500_000,
      });
      await engine.postSale(tService, "u1", {
        date: "2026-09-04",
        paymentMethod: "credit",
        partyId: clientA.id,
        itemId: svcItem.id,
        totalAmount: 2_500_000,
      });
      await engine.postPurchase(tService, "u1", {
        date: "2026-09-05",
        paymentMethod: "cash",
        partyId: vendorSub.id,
        itemId: subItem.id,
        totalCost: 600_000,
      });

      // Prepaid rent & monthly amortization + custom license expense via General Journal
      await engine.postGeneralJournal(tService, "u1", {
        date: "2026-09-06",
        description: "Bayar sewa kantor 1 tahun dimuka via Kas",
        lines: [
          { accountCode: "1107", debit: 1_200_000, credit: 0 },
          { accountCode: "1101", debit: 0, credit: 1_200_000 },
        ],
      });
      await engine.postGeneralJournal(tService, "u1", {
        date: "2026-09-30",
        description: "Amortisasi sewa bulan September & lisensi cloud",
        lines: [
          { accountCode: "5112", debit: 100_000, credit: 0 },
          { accountCode: "1107", debit: 0, credit: 100_000 },
          { accountCode: "5120", debit: 200_000, credit: 0 },
          { accountCode: "2102", debit: 0, credit: 200_000 },
        ],
      });

      const fsService = await engine.getFinancialStatements(tService, "2026-09");
      assert.equal(fsService.revenue, 4_000_000);
      assert.equal(fsService.cogs, 600_000); // 5108 Cost of Service
      assert.equal(fsService.grossProfit, 3_400_000);
      assert.equal(fsService.operatingExpenses, 300_000); // 5112 (100k) + 5120 (200k)
      assert.equal(fsService.netIncome, 3_100_000);
      assert.equal(fsService.cumulativeBalances["1107"], 1_100_000);
      assert.equal(fsService.isBalanced, true);
      assert.equal((await repo.listInventoryMovements(tService)).length, 0);

      // Closing period closes custom 5120 and standard 4102/5108/5112 into 3103
      await engine.closePeriod(tService, "u1", "2026-09");
      const fsOct = await engine.getFinancialStatements(tService, "2026-10");
      assert.equal(fsOct.openingCapital, 8_100_000); // 5,000,000 + 3,100,000
      assert.equal(fsOct.isBalanced, true);

      // Subledger control accounts (1103, 1104, 1105, 1106, 2101) cannot be posted directly via General Journal
      for (const ctrlCode of ["1103", "1104", "1105", "1106", "2101"]) {
        await assert.rejects(
          () =>
            engine.postGeneralJournal(tService, "u1", {
              date: "2026-10-02",
              description: "Test control guard",
              lines: [
                { accountCode: ctrlCode, debit: 50_000, credit: 0 },
                { accountCode: "1101", debit: 0, credit: 50_000 },
              ],
            }),
          ValidationError,
        );
      }

      // Toggle custom account inactive after closing
      const toggled = await engine.toggleAccountActive(tService, "u1", "5120");
      assert.equal(toggled.active, false);

      // --- 2. MANUFACTURING (Multi-material BOM + BTKL + BOP + WIP -> Finished Good) ---
      const tMfg = "t-mfg";
      await repo.initializeWorkspace(
        tMfg,
        createEmptyWorkspace(tMfg, {
          businessName: "Konveksi Nusantara",
          businessSector: "manufacturing",
          activePeriod: "2026-09",
        }),
      );
      await engine.postCapitalOrDrawing(tMfg, "u1", { type: "capital", date: "2026-09-01", amount: 5_000_000 });

      const kain = await engine.createItem(tMfg, "u1", {
        name: "Kain Katun",
        category: "raw_material",
        unit: "meter",
        openingQuantity: 10,
        openingTotalCost: 500_000,
        openingDate: "2026-09-01",
      });
      const benang = await engine.createItem(tMfg, "u1", {
        name: "Benang & Kancing",
        category: "raw_material",
        unit: "pack",
        openingQuantity: 10,
        openingTotalCost: 100_000,
        openingDate: "2026-09-01",
      });
      const wipKemeja = await engine.createItem(tMfg, "u1", {
        name: "Kemeja Setengah Jadi",
        category: "wip",
        unit: "pcs",
      });
      const kemejaJadi = await engine.createItem(tMfg, "u1", {
        name: "Kemeja Batik Jadi",
        category: "finished_good",
        unit: "pcs",
      });

      // Stage 1: Raw Materials (200k + 20k) + BTKL (100k) + BOP (80k) -> 4 pcs WIP (400k -> 100k/pc)
      const stage1 = await engine.postProductionRun(tMfg, "u1", {
        date: "2026-09-05",
        materials: [
          { itemId: kain.id, quantity: 4 },
          { itemId: benang.id, quantity: 2 },
        ],
        targetItemId: wipKemeja.id,
        targetQuantity: 4,
        directLaborCost: 100_000,
        overheadCost: 80_000,
        costCreditAccountCode: "2105",
        batchRef: "BATCH-WIP-01",
      });
      assert.equal(stage1.totalProductionCost, 400_000);
      assert.equal((await repo.getItem(tMfg, wipKemeja.id)).movingAverageCost, 100_000);

      // Stage 2: 4 pcs WIP (400k) + Finishing BTKL (60k paid Cash) -> 4 pcs Finished Good (460k -> 115k/pc)
      const stage2 = await engine.postProductionRun(tMfg, "u1", {
        date: "2026-09-07",
        materials: [{ itemId: wipKemeja.id, quantity: 4 }],
        targetItemId: kemejaJadi.id,
        targetQuantity: 4,
        directLaborCost: 60_000,
        overheadCost: 0,
        costCreditAccountCode: "1101",
        batchRef: "BATCH-FIN-01",
      });
      assert.equal(stage2.totalProductionCost, 460_000);
      assert.equal((await repo.getItem(tMfg, wipKemeja.id)).quantityOnHand, 0);
      assert.equal((await repo.getItem(tMfg, kemejaJadi.id)).movingAverageCost, 115_000);

      // Sell 3 pcs Finished Good @ 200,000 = 600,000 (COGS = 345,000)
      const mfgSale = await engine.postSale(tMfg, "u1", {
        date: "2026-09-10",
        paymentMethod: "cash",
        itemId: kemejaJadi.id,
        quantity: 3,
        totalAmount: 600_000,
      });
      assert.equal(mfgSale.cogsAmount, 345_000);

      const fsMfg = await engine.getFinancialStatements(tMfg, "2026-09");
      assert.equal(fsMfg.revenue, 600_000);
      assert.equal(fsMfg.cogs, 345_000);
      assert.equal(fsMfg.grossProfit, 255_000);
      assert.equal(fsMfg.cumulativeBalances["1104"], 380_000); // 500k+100k - 220k
      assert.equal(fsMfg.cumulativeBalances["1105"], 115_000); // 1 pc remaining
      assert.equal(fsMfg.cumulativeBalances["1106"], 0);
      assert.equal(fsMfg.isBalanced, true);

      // Voiding sale restores stock cleanly
      await engine.voidJournalEntry(tMfg, "u1", { entryId: mfgSale.entry.id, reason: "Retur penuh" });
      assert.equal((await repo.getItem(tMfg, kemejaJadi.id)).quantityOnHand, 4);
      assert.equal((await repo.getItem(tMfg, kemejaJadi.id)).totalInventoryValue, 460_000);
    } finally {
      await cleanup();
    }
  });
}

test("API enforces RBAC on custom COA while allowing production_run & general_journal", async () => {
  const { repo, authRepo, cleanup } = await createD1Pair();
  try {
    const origin = "https://app.umkm.test";
    const regOwner = await handleRegister(
      new Request(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "owner-coa@umkm.id",
          fullName: "Owner",
          password: "OwnerPassword!123",
          businessName: "Usaha Multi",
          seedDemo: false,
        }),
      }),
      authRepo,
      repo,
      { disablePublicSignup: false },
    );
    const ownerCookie = regOwner.headers.get("set-cookie").match(/umkm_session=([^;]+)/)[1];
    const ownerTenant = (await regOwner.json()).activeTenantId;

    const regStaff = await handleRegister(
      new Request(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "staff-coa@umkm.id",
          fullName: "Staff",
          password: "StaffPassword!123",
          businessName: "Staff Pribadi",
          seedDemo: false,
        }),
      }),
      authRepo,
      repo,
      { disablePublicSignup: false },
    );
    const staffPersonalCookie = regStaff.headers.get("set-cookie").match(/umkm_session=([^;]+)/)[1];

    await handleManageMembers(
      new Request(`${origin}/api/auth/members`, {
        method: "POST",
        headers: { origin, cookie: `umkm_session=${ownerCookie}`, "content-type": "application/json" },
        body: JSON.stringify({ email: "staff-coa@umkm.id", role: "staff" }),
      }),
      authRepo,
      repo,
    );
    const swRes = await handleSwitchBusiness(
      new Request(`${origin}/api/auth/switch-business`, {
        method: "POST",
        headers: { origin, cookie: `umkm_session=${staffPersonalCookie}`, "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ownerTenant }),
      }),
      authRepo,
      repo,
    );
    const staffCookie = swRes.headers.get("set-cookie").match(/umkm_session=([^;]+)/)[1];

    // Staff cannot create custom COA account (403)
    const staffCoaRes = await handleMasterMutation(
      new Request(`${origin}/api/accounting/master`, {
        method: "POST",
        headers: { origin, cookie: `umkm_session=${staffCookie}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "create_account", code: "5188", name: "Beban Staff", group: "expense" }),
      }),
      repo,
      authRepo,
    );
    assert.equal(staffCoaRes.status, 403);

    // Owner creates custom account & posts general_journal
    const ownerCoaRes = await handleMasterMutation(
      new Request(`${origin}/api/accounting/master`, {
        method: "POST",
        headers: { origin, cookie: `umkm_session=${ownerCookie}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "create_account", code: "5188", name: "Beban Komisi Sales", group: "expense" }),
      }),
      repo,
      authRepo,
    );
    assert.equal(ownerCoaRes.status, 200);

    const jrnRes = await handlePostTransaction(
      new Request(`${origin}/api/accounting/transactions`, {
        method: "POST",
        headers: { origin, cookie: `umkm_session=${staffCookie}`, "content-type": "application/json" },
        body: JSON.stringify({
          type: "general_journal",
          date: "2026-09-08",
          description: "Komisi penjualan bulan berjalan",
          lines: [
            { accountCode: "5188", debit: 150_000, credit: 0 },
            { accountCode: "2102", debit: 0, credit: 150_000 },
          ],
        }),
      }),
      repo,
      authRepo,
    );
    assert.equal(jrnRes.status, 201);
  } finally {
    await cleanup();
  }
});
