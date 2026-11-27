import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../db/schema.ts";
import { DrizzleSqliteAccountingRepository } from "../db/d1-repository.ts";
import { DrizzleSqliteAuthRepository } from "../db/auth-repository.ts";
import {
  AccountingEngine,
  ClosedPeriodError,
  ConcurrencyError,
  InMemoryAccountingRepository,
  InsufficientStockError,
  OverpaymentError,
  ValidationError,
  createEmptyWorkspace,
} from "../core/index.ts";
import { handleRegister } from "../app/api/auth/_handler.ts";
import {
  handleClosePeriod,
  handleMasterMutation,
  handlePostAdjustment,
  handlePostOpname,
  handlePostTransaction,
} from "../app/api/accounting/_handler.ts";
import { buildPdfBytes, buildVerifiedExportData, buildXlsxBytes } from "../app/api/accounting/_export.ts";

async function createSqliteRepo() {
  const sqlite = new DatabaseSync(":memory:");
  const [mig0, mig1, mig2, mig3, mig4] = await Promise.all([
    readFile(new URL("../drizzle/0000_stiff_mad_thinker.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_phase3_relational_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_phase45_hardening_constraints.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_phase6_auth_membership.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_phase8_universal_coa_manufacturing.sql", import.meta.url), "utf8"),
  ]);

  for (const sqlText of [mig0, mig1, mig2, mig3, mig4]) {
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
        const results = batch.map((b) => execQuery(b.sql, b.params, b.method));
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    { schema },
  );

  return {
    sqlite,
    repo: new DrizzleSqliteAccountingRepository(db),
    authRepo: new DrizzleSqliteAuthRepository(db),
  };
}

test("Moving average rounding & exact residual clearance when stock reaches zero", async () => {
  const repo = new InMemoryAccountingRepository();
  const engine = new AccountingEngine(repo);
  const t = "t-rounding";
  await repo.initializeWorkspace(t, createEmptyWorkspace(t, { activePeriod: "2026-09" }));

  const item = await engine.createItem(t, "u1", {
    name: "Gula Aren",
    category: "raw_material",
    unit: "kg",
  });
  await engine.postCapitalOrDrawing(t, "u1", { type: "capital", date: "2026-09-01", amount: 100_000 });

  // Buy 3 kg for Rp10,000 -> avg = 3,333.3333...
  await engine.postPurchase(t, "u1", {
    date: "2026-09-02",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 3,
    totalCost: 10_000,
  });

  // Sell 1 kg -> round(10000 * 1 / 3) = 3,333; rem 2 kg / 6,667
  const s1 = await engine.postSale(t, "u1", {
    date: "2026-09-03",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 1,
    totalAmount: 6_000,
  });
  assert.equal(s1.cogsAmount, 3_333);

  // Sell 1 kg -> round(6667 * 1 / 2) = 3,334; rem 1 kg / 3,333
  const s2 = await engine.postSale(t, "u1", {
    date: "2026-09-04",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 1,
    totalAmount: 6_000,
  });
  assert.equal(s2.cogsAmount, 3_334);

  // Sell last 1 kg -> exact remaining value 3,333; rem 0 kg / 0
  const s3 = await engine.postSale(t, "u1", {
    date: "2026-09-05",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 1,
    totalAmount: 6_000,
  });
  assert.equal(s3.cogsAmount, 3_333);
  assert.equal(s1.cogsAmount + s2.cogsAmount + s3.cogsAmount, 10_000);

  const finalItem = await repo.getItem(t, item.id);
  assert.equal(finalItem.quantityOnHand, 0);
  assert.equal(finalItem.totalInventoryValue, 0);

  const fs = await engine.getFinancialStatements(t, "2026-09");
  assert.equal(fs.cumulativeBalances["1104"], 0);
  assert.equal(fs.cogs, 10_000);
  assert.equal(fs.isBalanced, true);
});

test("Full purchase & sale cancellation via void/reversal, closed period blocking, and repeated close rejection", async () => {
  const repo = new InMemoryAccountingRepository();
  const engine = new AccountingEngine(repo);
  const t = "t-edge";
  await repo.initializeWorkspace(t, createEmptyWorkspace(t, { activePeriod: "2026-09" }));

  const supplier = await engine.createParty(t, "u1", { name: "Supplier X", type: "supplier" });
  const customer = await engine.createParty(t, "u1", { name: "Customer Y", type: "customer" });
  const item = await engine.createItem(t, "u1", {
    name: "Keripik Singkong",
    category: "finished_good",
    unit: "bungkus",
  });

  await engine.postCapitalOrDrawing(t, "u1", { type: "capital", date: "2026-09-01", amount: 10_000_000 });

  // Full purchase void (full return)
  const purVoidable = await engine.postPurchase(t, "u1", {
    date: "2026-09-02",
    paymentMethod: "credit",
    partyId: supplier.id,
    itemId: item.id,
    quantity: 10,
    totalCost: 100_000,
  });
  await engine.voidJournalEntry(t, "u1", { entryId: purVoidable.entry.id, reason: "Retur penuh pembelian" });
  assert.equal((await repo.getItem(t, item.id)).quantityOnHand, 0);
  assert.equal((await repo.getInvoice(t, purVoidable.invoice.id)).status, "voided");

  // Re-purchase 20 @ 20,000 = 400,000
  await engine.postPurchase(t, "u1", {
    date: "2026-09-03",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 20,
    totalCost: 400_000,
  });

  // Credit sale 5 = 150,000 (COGS 100,000) -> Void (full sales return)
  const saleVoidable = await engine.postSale(t, "u1", {
    date: "2026-09-04",
    paymentMethod: "credit",
    partyId: customer.id,
    itemId: item.id,
    quantity: 5,
    totalAmount: 150_000,
  });
  await engine.voidJournalEntry(t, "u1", { entryId: saleVoidable.entry.id, reason: "Retur penuh penjualan" });
  assert.equal((await repo.getItem(t, item.id)).quantityOnHand, 20);
  assert.equal((await repo.getItem(t, item.id)).totalInventoryValue, 400_000);

  // Repeated void of already-voided entry must fail
  await assert.rejects(
    () => engine.voidJournalEntry(t, "u1", { entryId: saleVoidable.entry.id, reason: "Double void" }),
    ValidationError,
  );

  // Actual operating entries in 2026-09:
  // Equipment cash 6,000,000; Sale 10 = 500,000 (COGS 200,000); Depr 100,000; Accrued Elec 250,000
  await engine.postPurchase(t, "u1", {
    date: "2026-09-05",
    paymentMethod: "cash",
    isEquipment: true,
    totalCost: 6_000_000,
  });
  const creditSale = await engine.postSale(t, "u1", {
    date: "2026-09-10",
    paymentMethod: "credit",
    partyId: customer.id,
    itemId: item.id,
    quantity: 10,
    totalAmount: 500_000,
  });
  // Partial payment 300,000 + Final settlement 200,000 + Overpayment blocked
  await engine.postInvoicePayment(t, "u1", {
    kind: "receivable",
    date: "2026-09-15",
    partyId: customer.id,
    invoiceId: creditSale.invoice.id,
    amount: 300_000,
  });
  await engine.postInvoicePayment(t, "u1", {
    kind: "receivable",
    date: "2026-09-18",
    partyId: customer.id,
    invoiceId: creditSale.invoice.id,
    amount: 200_000,
  });
  await assert.rejects(
    () =>
      engine.postInvoicePayment(t, "u1", {
        kind: "receivable",
        date: "2026-09-20",
        partyId: customer.id,
        invoiceId: creditSale.invoice.id,
        amount: 1_000,
      }),
    OverpaymentError,
  );

  await engine.postAdjustment(t, "u1", {
    type: "depreciation",
    date: "2026-09-30",
    assetCost: 6_000_000,
    lifeMonths: 60,
  });
  await engine.postAdjustment(t, "u1", {
    type: "accrued_expense",
    date: "2026-09-30",
    expenseAccountCode: "5103",
    amount: 250_000,
  });

  // Hand-calculated September Net Loss = 500,000 - (200,000 + 100,000 + 250,000) = -50,000
  const fsSep = await engine.getFinancialStatements(t, "2026-09");
  assert.equal(fsSep.netIncome, -50_000);
  assert.equal(fsSep.totalAssets, 10_200_000);
  assert.equal(fsSep.totalLiabilities, 250_000);
  assert.equal(fsSep.endingCapital, 9_950_000);
  assert.equal(fsSep.isBalanced, true);

  // Close 2026-09 -> repeated closing must fail
  await engine.closePeriod(t, "u1", "2026-09");
  await assert.rejects(() => engine.closePeriod(t, "u1", "2026-09"), ClosedPeriodError);

  // Any posting or opname or void in closed 2026-09 must fail
  await assert.rejects(
    () => engine.postStockOpname(t, "u1", { date: "2026-09-30", itemId: item.id, physicalQuantity: 9 }),
    ClosedPeriodError,
  );

  // Carry forward into 2026-10 after closing Net Loss
  await engine.updateProfile(t, "u1", { activePeriod: "2026-10" });
  const fsOct = await engine.getFinancialStatements(t, "2026-10");
  assert.equal(fsOct.openingCapital, 9_950_000);
  assert.equal(fsOct.totalAssets, 10_200_000);
  assert.equal(fsOct.totalLiabilities, 250_000);
  assert.equal(fsOct.unclosedPriorEarnings, 0);
  assert.equal(fsOct.isBalanced, true);
});

test("Mid-process commit failure leaves zero partial state in SQLite D1 repository", async () => {
  const { sqlite, repo } = await createSqliteRepo();
  const engine = new AccountingEngine(repo);
  const t = "t-atomic";
  await repo.initializeWorkspace(t, createEmptyWorkspace(t, { activePeriod: "2026-09" }));

  const item = await engine.createItem(t, "u1", {
    name: "Kacang Oven",
    category: "finished_good",
    unit: "bungkus",
    openingQuantity: 10,
    openingTotalCost: 100_000,
    openingDate: "2026-09-01",
  });

  // Inject a SQLite trigger failure on audit_logs insert (last statement in commitPosting batch!)
  sqlite.exec(`
    CREATE TRIGGER fail_audit_mid_batch BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'POST_SALE'
    BEGIN
      SELECT RAISE(ABORT, 'SIMULATED_MID_BATCH_FAILURE');
    END;
  `);

  const beforeEntries = (await repo.listJournalEntries(t)).length;
  const beforeMovements = (await repo.listInventoryMovements(t)).length;

  await assert.rejects(
    () =>
      engine.postSale(t, "u1", {
        date: "2026-09-05",
        paymentMethod: "cash",
        itemId: item.id,
        quantity: 4,
        totalAmount: 80_000,
      }),
    /SIMULATED_MID_BATCH_FAILURE/,
  );

  // Verify ZERO partial updates: journal_entries, inventory_movements, and item qty remained unchanged!
  assert.equal((await repo.listJournalEntries(t)).length, beforeEntries);
  assert.equal((await repo.listInventoryMovements(t)).length, beforeMovements);
  assert.equal((await repo.getItem(t, item.id)).quantityOnHand, 10);
  assert.equal((await repo.getItem(t, item.id)).totalInventoryValue, 100_000);
});

test("Full Manual Smoke Test: Registration -> Profile -> Opening -> Purchase -> Production -> Sale -> AR/AP -> Opname -> Adj -> Export -> Close -> Next Period", async () => {
  const { repo, authRepo } = await createSqliteRepo();
  const engine = new AccountingEngine(repo);

  // 1. Fresh user registration + authenticated tenant session
  const resInit = await handleRegister(
    new Request("https://app.umkm.test/api/auth/register", {
      method: "POST",
      headers: {
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "smoke@umkm.id",
        fullName: "Smoke Owner",
        password: "SmokePassword!123",
        businessName: "Keripik Bantul Jaya",
        city: "Bantul",
        seedDemo: false,
      }),
    }),
    authRepo,
    repo,
    { disablePublicSignup: false },
  );
  assert.equal(resInit.status, 201);
  const cookie = resInit.headers.get("set-cookie").match(/umkm_session=([^;]+)/)[1];
  const cookieHeader = `umkm_session=${cookie}`;
  const initPayload = await resInit.json();
  const tenantId = initPayload.activeTenantId;

  // Reset to clean empty workspace with activePeriod 2026-09 so we verify every single figure from zero!
  await repo.resetWorkspace(tenantId, createEmptyWorkspace(tenantId, {
    businessName: "Keripik Bantul Jaya",
    city: "Bantul",
    activePeriod: "2026-09",
  }));

  const post = (handler, path, body) =>
    handler(
      new Request(`https://app.umkm.test${path}`, {
        method: "POST",
        headers: {
          cookie: cookieHeader,
          origin: "https://app.umkm.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      repo,
      authRepo,
    );

  // 2. Update Profile
  let res = await post(handleMasterMutation, "/api/accounting/master", {
    action: "update_profile",
    businessName: "=Keripik Bantul Jaya", // also tests spreadsheet formula-injection neutralization!
    city: "Bantul, DIY",
    activePeriod: "2026-09",
  });
  assert.equal(res.status, 200);

  // 3. Create supplier, customer, raw material (opening 50 kg = 250,000), finished good
  res = await post(handleMasterMutation, "/api/accounting/master", {
    action: "create_party",
    name: "Petani Pak Budi",
    type: "supplier",
  });
  const supplier = (await res.json()).result;

  res = await post(handleMasterMutation, "/api/accounting/master", {
    action: "create_party",
    name: "Toko Oleh-Oleh",
    type: "customer",
  });
  const customer = (await res.json()).result;

  res = await post(handleMasterMutation, "/api/accounting/master", {
    action: "create_item",
    name: "Singkong",
    category: "raw_material",
    unit: "kg",
    openingQuantity: 50,
    openingTotalCost: 250_000,
    openingDate: "2026-09-01",
  });
  const rawItem = (await res.json()).result;

  res = await post(handleMasterMutation, "/api/accounting/master", {
    action: "create_item",
    name: "Keripik Pedas",
    category: "finished_good",
    unit: "bungkus",
  });
  const finItem = (await res.json()).result;

  // Capital 5,000,000
  res = await post(handlePostTransaction, "/api/accounting/transactions", {
    type: "capital",
    date: "2026-09-01",
    amount: 5_000_000,
  });
  assert.equal(res.status, 201);

  // 4. Credit purchase 50 kg Singkong = 350,000 (total 100 kg / 600,000 -> avg 6,000/kg)
  res = await post(handlePostTransaction, "/api/accounting/transactions", {
    type: "inventory_credit",
    date: "2026-09-02",
    partyId: supplier.id,
    itemId: rawItem.id,
    quantity: 50,
    amount: 350_000,
  });
  const apInvoice = (await res.json()).result.invoice;

  // 5. Production transfer: 40 kg Singkong (240,000) -> 80 bungkus Keripik Pedas (avg 3,000)
  res = await post(handlePostTransaction, "/api/accounting/transactions", {
    type: "production_transfer",
    date: "2026-09-04",
    sourceItemId: rawItem.id,
    sourceQuantity: 40,
    targetItemId: finItem.id,
    targetQuantity: 80,
  });
  assert.equal(res.status, 201);

  // 6. Credit sale 50 bungkus @ 10,000 = 500,000 (COGS = 150,000)
  res = await post(handlePostTransaction, "/api/accounting/transactions", {
    type: "credit_sale",
    date: "2026-09-06",
    partyId: customer.id,
    itemId: finItem.id,
    quantity: 50,
    amount: 500_000,
  });
  const arInvoice = (await res.json()).result.invoice;

  // 7. Collect Receivable 300,000 (rem 200,000)
  res = await post(handlePostTransaction, "/api/accounting/transactions", {
    type: "collect_receivable",
    date: "2026-09-10",
    partyId: customer.id,
    invoiceId: arInvoice.id,
    amount: 300_000,
  });
  assert.equal(res.status, 201);

  // 8. Pay Payable 200,000 (rem 150,000)
  res = await post(handlePostTransaction, "/api/accounting/transactions", {
    type: "pay_payable",
    date: "2026-09-12",
    partyId: supplier.id,
    invoiceId: apInvoice.id,
    amount: 200_000,
  });
  assert.equal(res.status, 201);

  // 9. Stock Opname: Physical Keripik Pedas = 28 (book 30 -> -2 = 6,000 loss)
  res = await post(handlePostOpname, "/api/accounting/opname", {
    date: "2026-09-29",
    itemId: finItem.id,
    physicalQuantity: 28,
  });
  assert.equal(res.status, 201);

  // 10. Accrued Electricity 100,000
  res = await post(handlePostAdjustment, "/api/accounting/adjustments", {
    type: "accrued_expense",
    date: "2026-09-30",
    expenseAccountCode: "5103",
    amount: 100_000,
  });
  assert.equal(res.status, 201);

  // Verify exact hand-calculated September statements
  const fsSep = await engine.getFinancialStatements(tenantId, "2026-09");
  assert.equal(fsSep.revenue, 500_000);
  assert.equal(fsSep.cogs, 150_000);
  assert.equal(fsSep.grossProfit, 350_000);
  assert.equal(fsSep.operatingExpenses, 106_000);
  assert.equal(fsSep.netIncome, 244_000);
  assert.equal(fsSep.cumulativeBalances["1101"], 5_100_000);
  assert.equal(fsSep.cumulativeBalances["1103"], 200_000);
  assert.equal(fsSep.cumulativeBalances["1104"], 360_000);
  assert.equal(fsSep.cumulativeBalances["1105"], 84_000);
  assert.equal(fsSep.totalAssets, 5_744_000);
  assert.equal(fsSep.totalLiabilities, 250_000);
  assert.equal(fsSep.endingCapital, 5_494_000);
  assert.equal(fsSep.isBalanced, true);

  // 11. Verify Server-Derived Exports (XLSX + PDF)
  const expData = await buildVerifiedExportData(repo, tenantId, "2026-09");
  const xlsxBytes = buildXlsxBytes(expData.sheets);
  const pdfBytes = buildPdfBytes(expData.businessName, expData.sections);
  assert.ok(xlsxBytes.length > 500);
  assert.ok(new TextDecoder().decode(pdfBytes).startsWith("%PDF-1.4"));
  // Verify formula injection neutralization on Laba Rugi / Jurnal Umum
  const labaSheet = expData.sheets.find((s) => s.name === "Laba Rugi");
  assert.deepEqual(labaSheet.rows[5], ["Laba Bersih", 244_000]);

  // 12. Close 2026-09 and open 2026-10
  res = await post(handleClosePeriod, "/api/accounting/periods/close", { period: "2026-09" });
  assert.equal(res.status, 200);

  res = await post(handleMasterMutation, "/api/accounting/master", {
    action: "update_profile",
    activePeriod: "2026-10",
  });
  const octPayload = await res.json();
  assert.equal(octPayload.statements.totalAssets, 5_744_000);
  assert.equal(octPayload.statements.openingCapital, 5_494_000);
  assert.equal(octPayload.statements.revenue, 0);
  assert.equal(octPayload.statements.isBalanced, true);
});
