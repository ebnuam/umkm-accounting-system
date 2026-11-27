import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../db/schema.ts";
import { D1AccountingRepository } from "../db/d1-repository.ts";
import { createLocalSqliteRepository } from "../db/local-sqlite-repository.ts";
import { getAccountingRepository, resolveDbAdapter } from "../db/index.ts";
import {
  AccountingEngine,
  ClosedPeriodError,
  OverpaymentError,
  ValidationError,
  createEmptyWorkspace,
} from "../core/index.ts";

async function createSimulatedD1Repo() {
  const sqlite = new DatabaseSync(":memory:");
  const [mig0, mig1, mig2, mig4] = await Promise.all([
    readFile(new URL("../drizzle/0000_stiff_mad_thinker.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_phase3_relational_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_phase45_hardening_constraints.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_phase8_universal_coa_manufacturing.sql", import.meta.url), "utf8"),
  ]);

  for (const sqlText of [mig0, mig1, mig2, mig4]) {
    const chunks = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of chunks) {
      sqlite.exec(stmt);
    }
  }

  const execQuery = (sql, params, method) => {
    const cleanParams = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
    const prepared = sqlite.prepare(sql);
    if (method === "run") {
      prepared.run(...cleanParams);
      return { rows: [] };
    }
    if (method === "get") {
      const row = prepared.get(...cleanParams);
      return { rows: row ? Object.values(row) : [] };
    }
    const rows = prepared.all(...cleanParams);
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
    name: "D1AccountingRepository",
    repo: new D1AccountingRepository(db),
    cleanup: async () => sqlite.close(),
  };
}

async function runFullContractScenario(repo) {
  const engine = new AccountingEngine(repo);
  const tenantA = "contract-tenant-a";
  const tenantB = "contract-tenant-b";

  await repo.initializeWorkspace(tenantA, createEmptyWorkspace(tenantA, { activePeriod: "2026-09" }));
  await repo.initializeWorkspace(tenantB, createEmptyWorkspace(tenantB, { activePeriod: "2026-09" }));

  // Master parties & separated raw/finished items
  const supplier = await engine.createParty(tenantA, "u1", { name: "Pemasok Jaya", type: "supplier" });
  const customer = await engine.createParty(tenantA, "u1", { name: "Toko Maju", type: "customer" });
  const bahan = await engine.createItem(tenantA, "u1", {
    name: "Tepung Garut",
    category: "raw_material",
    unit: "kg",
  });
  const keripik = await engine.createItem(tenantA, "u1", {
    name: "Keripik Kimpul",
    category: "finished_good",
    unit: "bungkus",
  });

  // Capital 5,000,000
  await engine.postCapitalOrDrawing(tenantA, "u1", { type: "capital", date: "2026-09-01", amount: 5_000_000 });

  // Purchases (Moving Average): 10 @ 10,000 + 10 @ 14,000 (credit) -> avg = 12,000
  await engine.postPurchase(tenantA, "u1", {
    date: "2026-09-02",
    paymentMethod: "cash",
    partyId: supplier.id,
    itemId: keripik.id,
    quantity: 10,
    totalCost: 100_000,
  });
  const creditPur = await engine.postPurchase(tenantA, "u1", {
    date: "2026-09-04",
    paymentMethod: "credit",
    partyId: supplier.id,
    itemId: keripik.id,
    quantity: 10,
    totalCost: 140_000,
  });

  // Partial & full payable payment + overpayment check
  await engine.postInvoicePayment(tenantA, "u1", {
    kind: "payable",
    date: "2026-09-06",
    partyId: supplier.id,
    invoiceId: creditPur.invoice.id,
    amount: 100_000,
  });
  await assert.rejects(
    () =>
      engine.postInvoicePayment(tenantA, "u1", {
        kind: "payable",
        date: "2026-09-07",
        partyId: supplier.id,
        invoiceId: creditPur.invoice.id,
        amount: 50_000, // > 40,000 remaining
      }),
    OverpaymentError,
  );
  await engine.postInvoicePayment(tenantA, "u1", {
    kind: "payable",
    date: "2026-09-08",
    partyId: supplier.id,
    invoiceId: creditPur.invoice.id,
    amount: 40_000,
  });

  // Credit sale 5 @ 20,000 = 100,000 (COGS = 60,000) + partial receivable collection
  const creditSale = await engine.postSale(tenantA, "u1", {
    date: "2026-09-10",
    paymentMethod: "credit",
    partyId: customer.id,
    itemId: keripik.id,
    quantity: 5,
    totalAmount: 100_000,
  });
  const arPay = await engine.postInvoicePayment(tenantA, "u1", {
    kind: "receivable",
    date: "2026-09-12",
    partyId: customer.id,
    invoiceId: creditSale.invoice.id,
    amount: 60_000,
  });

  // Void AR payment -> restores remainingAmount back to 100,000
  await engine.voidJournalEntry(tenantA, "u1", { entryId: arPay.entry.id, reason: "Koreksi pelunasan" });
  const arAfterVoid = await repo.getInvoice(tenantA, creditSale.invoice.id);
  assert.equal(arAfterVoid.remainingAmount, 100_000);

  // Stock Opname negative (-2 -> loss 24,000) & positive (+1 -> gain 12,000)
  await engine.postStockOpname(tenantA, "u1", { date: "2026-09-20", itemId: keripik.id, physicalQuantity: 13 });
  await engine.postStockOpname(tenantA, "u1", { date: "2026-09-25", itemId: keripik.id, physicalQuantity: 14 });

  // Raw material purchase + failure atomicity check
  await engine.postPurchase(tenantA, "u1", {
    date: "2026-09-26",
    paymentMethod: "cash",
    itemId: bahan.id,
    quantity: 10,
    totalCost: 200_000,
  });
  await assert.rejects(
    () =>
      engine.postSale(tenantA, "u1", {
        date: "2026-09-27",
        paymentMethod: "cash",
        itemId: bahan.id,
        quantity: 99,
        totalAmount: 990_000,
      }),
  );

  // Tenant isolation check: Tenant B sees zero entries from Tenant A
  const wsB = await repo.getWorkspace(tenantB);
  assert.equal(wsB.items.length, 0);
  assert.equal(wsB.journalEntries.length, 0);
  await assert.rejects(
    () =>
      engine.postInvoicePayment(tenantB, "u2", {
        kind: "receivable",
        date: "2026-09-28",
        partyId: customer.id,
        invoiceId: creditSale.invoice.id,
        amount: 10_000,
      }),
    /tidak ditemukan/,
  );

  const fsSep = await engine.getFinancialStatements(tenantA, "2026-09");
  const tbSep = await engine.getTrialBalance(tenantA, "2026-09", true);
  assert.equal(fsSep.isBalanced, true);
  assert.equal(tbSep.isBalanced, true);

  // Close September & verify October balance carry-forward
  await engine.closePeriod(tenantA, "u1", "2026-09");
  await assert.rejects(() => engine.closePeriod(tenantA, "u1", "2026-09"), ClosedPeriodError);
  await engine.updateProfile(tenantA, "u1", { activePeriod: "2026-10" });
  const fsOct = await engine.getFinancialStatements(tenantA, "2026-10");
  assert.equal(fsOct.isBalanced, true);
  assert.equal(fsOct.totalAssets, fsSep.totalAssets);
  assert.equal(fsOct.openingCapital, fsSep.endingCapital);
  assert.equal(fsOct.revenue, 0);

  const wsA = await repo.getWorkspace(tenantA);
  assert.ok(wsA.auditLogs.some((l) => l.action === "VOID_ENTRY"));
  assert.ok(wsA.auditLogs.some((l) => l.action === "CLOSE_PERIOD"));

  return {
    fsSep: {
      revenue: fsSep.revenue,
      cogs: fsSep.cogs,
      operatingExpenses: fsSep.operatingExpenses,
      netIncome: fsSep.netIncome,
      totalAssets: fsSep.totalAssets,
      totalLiabilities: fsSep.totalLiabilities,
      endingCapital: fsSep.endingCapital,
      cumulativeBalances: fsSep.cumulativeBalances,
    },
    fsOct: {
      openingCapital: fsOct.openingCapital,
      totalAssets: fsOct.totalAssets,
      totalLiabilities: fsOct.totalLiabilities,
      unclosedPriorEarnings: fsOct.unclosedPriorEarnings,
    },
    keripikStock: {
      qty: (await repo.getItem(tenantA, keripik.id)).quantityOnHand,
      val: (await repo.getItem(tenantA, keripik.id)).totalInventoryValue,
      avg: (await repo.getItem(tenantA, keripik.id)).movingAverageCost,
    },
    counts: {
      entries: wsA.journalEntries.length,
      movements: wsA.inventoryMovements.length,
      invoices: wsA.invoices.length,
      auditLogs: wsA.auditLogs.length,
    },
  };
}

test("D1AccountingRepository and LocalSqliteAccountingRepository produce identical accounting outputs across the entire contract", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "umkm-sqlite-contract-"));
  const dbPath = join(tempDir, "contract.sqlite");
  const d1Ctx = await createSimulatedD1Repo();
  const localRepo = createLocalSqliteRepository({ dbPath });

  try {
    const [d1Result, localResult] = await Promise.all([
      runFullContractScenario(d1Ctx.repo),
      runFullContractScenario(localRepo),
    ]);

    assert.deepEqual(localResult, d1Result);

    // Verify expected hand-calculated totals:
    // Cash: 5,000,000 - 100,000 - 140,000 - 200,000 = 4,560,000
    // AR: 100,000; Keripik (14 * 12,000 = 168,000); Bahan (200,000) -> Total Assets = 5,028,000
    // Revenue: 100,000 (sale) + 12,000 (opname+) = 112,000
    // COGS: 60,000; OpExp: 24,000 (opname-) -> Net Income = 28,000; Ending Equity = 5,028,000
    assert.equal(localResult.fsSep.totalAssets, 5_028_000);
    assert.equal(localResult.fsSep.netIncome, 28_000);
    assert.equal(localResult.fsSep.endingCapital, 5_028_000);
    assert.equal(localResult.keripikStock.qty, 14);
    assert.equal(localResult.keripikStock.val, 168_000);
    assert.equal(localResult.keripikStock.avg, 12_000);
  } finally {
    localRepo.close();
    await d1Ctx.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("LocalSqliteAccountingRepository persists data across database close/reopen and rejects invalid DB_ADAPTER", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "umkm-sqlite-persist-"));
  const dbPath = join(tempDir, "persist.sqlite");
  const prevAdapter = process.env.DB_ADAPTER;
  const prevPath = process.env.SQLITE_DB_PATH;

  try {
    process.env.DB_ADAPTER = "sqlite";
    process.env.SQLITE_DB_PATH = dbPath;
    assert.equal(resolveDbAdapter(), "sqlite");

    const repo1 = await getAccountingRepository();
    const engine1 = new AccountingEngine(repo1);
    await repo1.initializeWorkspace("t-persist", createEmptyWorkspace("t-persist", { activePeriod: "2026-09" }));
    await engine1.postCapitalOrDrawing("t-persist", "u1", { type: "capital", date: "2026-09-01", amount: 1_250_000 });
    repo1.close();
    delete globalThis.__umkmLocalSqliteRepo;

    // Reopen fresh connection from disk
    const repo2 = createLocalSqliteRepository({ dbPath });
    try {
      const engine2 = new AccountingEngine(repo2);
      const fs = await engine2.getFinancialStatements("t-persist", "2026-09");
      assert.equal(fs.cumulativeBalances["1101"], 1_250_000);
      assert.equal(fs.endingCapital, 1_250_000);
    } finally {
      repo2.close();
    }

    process.env.DB_ADAPTER = "postgres";
    assert.throws(() => resolveDbAdapter(), ValidationError.prototype ? Error : Error);
  } finally {
    delete globalThis.__umkmLocalSqliteRepo;
    if (prevAdapter === undefined) delete process.env.DB_ADAPTER;
    else process.env.DB_ADAPTER = prevAdapter;
    if (prevPath === undefined) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = prevPath;
    await rm(tempDir, { recursive: true, force: true });
  }
});
