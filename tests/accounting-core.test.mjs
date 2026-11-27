import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountingEngine,
  ClosedPeriodError,
  DEFAULT_ACCOUNTS,
  InMemoryAccountingRepository,
  InsufficientStockError,
  OverpaymentError,
  ValidationError,
  createEmptyWorkspace,
  getAccountMap,
  seedSampleWorkspace,
  validateJournalLines,
} from "../core/index.ts";

function setupEngine(tenantId = "tenant-a") {
  const repo = new InMemoryAccountingRepository();
  const engine = new AccountingEngine(repo);
  return { repo, engine, tenantId };
}

test("Moving Average + COGS + Stock Opname (+/-) matches hand-calculated expected results", async () => {
  const { repo, engine, tenantId } = setupEngine();
  await repo.initializeWorkspace(tenantId, createEmptyWorkspace(tenantId, { activePeriod: "2026-09" }));

  const keripik = await engine.createItem(tenantId, "u1", {
    name: "Keripik Kimpul",
    category: "finished_good",
    unit: "bungkus",
  });
  const supplier = await engine.createParty(tenantId, "u1", { name: "Supplier A", type: "supplier" });

  // 1. Capital 5,000,000
  await engine.postCapitalOrDrawing(tenantId, "u1", {
    type: "capital",
    date: "2026-09-01",
    amount: 5_000_000,
  });

  // 2. Purchase 10 @ 10,000 = 100,000 -> avg = 10,000
  await engine.postPurchase(tenantId, "u1", {
    date: "2026-09-02",
    paymentMethod: "cash",
    partyId: supplier.id,
    itemId: keripik.id,
    quantity: 10,
    totalCost: 100_000,
  });

  // 3. Purchase 10 @ 14,000 = 140,000 -> total qty 20, total value 240,000, avg = 12,000
  await engine.postPurchase(tenantId, "u1", {
    date: "2026-09-05",
    paymentMethod: "cash",
    partyId: supplier.id,
    itemId: keripik.id,
    quantity: 10,
    totalCost: 140_000,
  });

  let itemAfterPurchases = await repo.getItem(tenantId, keripik.id);
  assert.equal(itemAfterPurchases.quantityOnHand, 20);
  assert.equal(itemAfterPurchases.totalInventoryValue, 240_000);
  assert.equal(itemAfterPurchases.movingAverageCost, 12_000);

  // 4. Sale 5 @ 20,000 = 100,000 -> COGS = 5 * 12,000 = 60,000; remaining 15 / 180,000
  const sale = await engine.postSale(tenantId, "u1", {
    date: "2026-09-10",
    paymentMethod: "cash",
    itemId: keripik.id,
    quantity: 5,
    totalAmount: 100_000,
  });
  assert.equal(sale.cogsAmount, 60_000);

  const itemAfterSale = await repo.getItem(tenantId, keripik.id);
  assert.equal(itemAfterSale.quantityOnHand, 15);
  assert.equal(itemAfterSale.totalInventoryValue, 180_000);
  assert.equal(itemAfterSale.movingAverageCost, 12_000);

  // Guard: Selling 16 when only 15 available must throw InsufficientStockError
  await assert.rejects(
    () =>
      engine.postSale(tenantId, "u1", {
        date: "2026-09-12",
        paymentMethod: "cash",
        itemId: keripik.id,
        quantity: 16,
        totalAmount: 320_000,
      }),
    InsufficientStockError,
  );

  // 5. Stock Opname Negative: Physical = 13 (diff = -2, loss = 24,000)
  const opnameNeg = await engine.postStockOpname(tenantId, "u1", {
    date: "2026-09-15",
    itemId: keripik.id,
    physicalQuantity: 13,
  });
  assert.equal(opnameNeg.differenceQty, -2);
  assert.equal(opnameNeg.differenceValue, 24_000);
  assert.equal(opnameNeg.item.quantityOnHand, 13);
  assert.equal(opnameNeg.item.totalInventoryValue, 156_000);

  // 6. Stock Opname Positive: Physical = 15 (diff = +2, surplus = 24,000)
  const opnamePos = await engine.postStockOpname(tenantId, "u1", {
    date: "2026-09-20",
    itemId: keripik.id,
    physicalQuantity: 15,
  });
  assert.equal(opnamePos.differenceQty, 2);
  assert.equal(opnamePos.differenceValue, 24_000);
  assert.equal(opnamePos.item.quantityOnHand, 15);
  assert.equal(opnamePos.item.totalInventoryValue, 180_000);

  // Hand-calculated financial statements for 2026-09:
  // Cash = 5,000,000 - 100,000 - 140,000 + 100,000 = 4,860,000
  // Inventory (1105) = 180,000
  // Total Assets = 5,040,000
  // Revenue (4101: 100,000 + 4201: 24,000) = 124,000
  // Expenses (5101: 60,000 + 5107: 24,000) = 84,000
  // Net Income = 40,000
  // Ending Equity = 5,000,000 + 40,000 = 5,040,000
  const fs = await engine.getFinancialStatements(tenantId, "2026-09");
  assert.equal(fs.cumulativeBalances["1101"], 4_860_000);
  assert.equal(fs.cumulativeBalances["1105"], 180_000);
  assert.equal(fs.totalAssets, 5_040_000);
  assert.equal(fs.revenue, 124_000);
  assert.equal(fs.cogs, 60_000);
  assert.equal(fs.totalExpenses, 84_000);
  assert.equal(fs.netIncome, 40_000);
  assert.equal(fs.endingCapital, 5_040_000);
  assert.equal(fs.isBalanced, true);
});

test("Separates raw materials (1104) & finished goods (1105) and supports simple production transfer", async () => {
  const { repo, engine, tenantId } = setupEngine();
  await repo.initializeWorkspace(tenantId, createEmptyWorkspace(tenantId, { activePeriod: "2026-09" }));

  const tepung = await engine.createItem(tenantId, "u1", {
    name: "Tepung Pati Garut",
    category: "raw_material",
    unit: "kg",
  });
  const jenang = await engine.createItem(tenantId, "u1", {
    name: "Jenang Pati Garut",
    category: "finished_good",
    unit: "porsi",
  });

  assert.equal(tepung.inventoryAccountCode, "1104");
  assert.equal(jenang.inventoryAccountCode, "1105");

  await engine.postCapitalOrDrawing(tenantId, "u1", {
    type: "capital",
    date: "2026-09-01",
    amount: 2_000_000,
  });

  // Buy 10 kg Tepung @ 20,000 = 200,000
  await engine.postPurchase(tenantId, "u1", {
    date: "2026-09-02",
    paymentMethod: "cash",
    itemId: tepung.id,
    quantity: 10,
    totalCost: 200_000,
  });

  // Convert 4 kg Tepung (80,000) into 10 porsi Jenang (unit cost = 8,000)
  await engine.postMaterialUsageOrTransfer(tenantId, "u1", {
    date: "2026-09-04",
    sourceItemId: tepung.id,
    sourceQuantity: 4,
    targetItemId: jenang.id,
    targetQuantity: 10,
    batchRef: "BATCH-01",
  });

  // Sell 5 porsi Jenang @ 15,000 = 75,000 (COGS = 40,000)
  const sale = await engine.postSale(tenantId, "u1", {
    date: "2026-09-06",
    paymentMethod: "cash",
    itemId: jenang.id,
    quantity: 5,
    totalAmount: 75_000,
  });

  assert.equal(sale.cogsAmount, 40_000);
  const fs = await engine.getFinancialStatements(tenantId, "2026-09");
  // Expected: 1104 = 120,000; 1105 = 40,000; Cash = 2,000,000 - 200,000 + 75,000 = 1,875,000
  assert.equal(fs.cumulativeBalances["1104"], 120_000);
  assert.equal(fs.cumulativeBalances["1105"], 40_000);
  assert.equal(fs.cumulativeBalances["1101"], 1_875_000);
  assert.equal(fs.grossProfit, 35_000);
  assert.equal(fs.isBalanced, true);
});

test("AR/AP invoices link to parties, prevent overpayment, and void/reversal preserves audit trail", async () => {
  const { repo, engine, tenantId } = setupEngine();
  await repo.initializeWorkspace(tenantId, createEmptyWorkspace(tenantId, { activePeriod: "2026-09" }));

  const custA = await engine.createParty(tenantId, "u1", { name: "Pelanggan A", type: "customer" });
  const custB = await engine.createParty(tenantId, "u1", { name: "Pelanggan B", type: "customer" });
  const item = await engine.createItem(tenantId, "u1", {
    name: "Kue Bawang",
    category: "finished_good",
    unit: "bungkus",
    openingQuantity: 20,
    openingTotalCost: 200_000, // 10,000/bungkus
    openingDate: "2026-09-01",
  });

  // Credit sale 10 bungkus @ 60,000 = 600,000 (COGS = 100,000)
  const sale = await engine.postSale(tenantId, "u1", {
    date: "2026-09-05",
    paymentMethod: "credit",
    partyId: custA.id,
    itemId: item.id,
    quantity: 10,
    totalAmount: 600_000,
  });
  assert.ok(sale.invoice);
  assert.equal(sale.invoice.remainingAmount, 600_000);

  // Wrong party must fail
  await assert.rejects(
    () =>
      engine.postInvoicePayment(tenantId, "u1", {
        kind: "receivable",
        date: "2026-09-08",
        partyId: custB.id,
        invoiceId: sale.invoice.id,
        amount: 100_000,
      }),
    ValidationError,
  );

  // Overpayment 650,000 > 600,000 must fail
  await assert.rejects(
    () =>
      engine.postInvoicePayment(tenantId, "u1", {
        kind: "receivable",
        date: "2026-09-08",
        partyId: custA.id,
        invoiceId: sale.invoice.id,
        amount: 650_000,
      }),
    OverpaymentError,
  );

  // Partial payment 400,000 -> remaining 200,000
  const pay1 = await engine.postInvoicePayment(tenantId, "u1", {
    kind: "receivable",
    date: "2026-09-10",
    partyId: custA.id,
    invoiceId: sale.invoice.id,
    amount: 400_000,
  });
  assert.equal(pay1.invoice.remainingAmount, 200_000);
  assert.equal(pay1.invoice.status, "partial");

  // Second overpayment 250,000 > 200,000 must fail
  await assert.rejects(
    () =>
      engine.postInvoicePayment(tenantId, "u1", {
        kind: "receivable",
        date: "2026-09-12",
        partyId: custA.id,
        invoiceId: sale.invoice.id,
        amount: 250_000,
      }),
    OverpaymentError,
  );

  // Cannot void credit sale invoice while active payment exists
  await assert.rejects(
    () =>
      engine.voidJournalEntry(tenantId, "u1", {
        entryId: sale.entry.id,
        reason: "Salah input",
      }),
    ValidationError,
  );

  // Void the payment -> restores invoice balance to 600,000 and creates reversal entry
  const voidPay = await engine.voidJournalEntry(tenantId, "u1", {
    entryId: pay1.entry.id,
    reason: "Salah nominal transfer",
  });
  assert.equal(voidPay.voidedEntry.status, "voided");
  assert.equal(voidPay.reversalEntry.source, "reversal");
  const invAfterVoidPay = await repo.getInvoice(tenantId, sale.invoice.id);
  assert.equal(invAfterVoidPay.remainingAmount, 600_000);
  assert.equal(invAfterVoidPay.status, "open");

  // Now void the credit sale -> restores item qty back to 20 and value to 200,000
  await engine.voidJournalEntry(tenantId, "u1", {
    entryId: sale.entry.id,
    reason: "Pesanan dibatalkan",
  });
  const itemRestored = await repo.getItem(tenantId, item.id);
  assert.equal(itemRestored.quantityOnHand, 20);
  assert.equal(itemRestored.totalInventoryValue, 200_000);

  const fs = await engine.getFinancialStatements(tenantId, "2026-09");
  assert.equal(fs.cumulativeBalances["1103"], 0);
  assert.equal(fs.revenue, 0);
  assert.equal(fs.cogs, 0);
  assert.equal(fs.isBalanced, true);

  // Audit logs exist for all mutations (no records were deleted)
  const ws = await repo.getWorkspace(tenantId);
  assert.equal(ws.journalEntries.filter((e) => e.status === "voided").length, 2);
  assert.equal(ws.journalEntries.filter((e) => e.source === "reversal").length, 2);
  assert.ok(ws.auditLogs.some((l) => l.action === "VOID_ENTRY"));
});

test("Multi-period balance carry-forward & formal period closing match hand-calculated balances", async () => {
  const { repo, engine, tenantId } = setupEngine();
  await repo.initializeWorkspace(tenantId, createEmptyWorkspace(tenantId, { activePeriod: "2026-09" }));

  const item = await engine.createItem(tenantId, "u1", {
    name: "Keripik",
    category: "finished_good",
    unit: "bungkus",
  });

  // September 2026
  await engine.postCapitalOrDrawing(tenantId, "u1", { type: "capital", date: "2026-09-01", amount: 5_000_000 });
  await engine.postPurchase(tenantId, "u1", {
    date: "2026-09-02",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 10,
    totalCost: 100_000,
  });
  await engine.postSale(tenantId, "u1", {
    date: "2026-09-10",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 4,
    totalAmount: 100_000, // COGS = 40,000
  });
  await engine.postCapitalOrDrawing(tenantId, "u1", { type: "drawing", date: "2026-09-25", amount: 10_000 });

  // Switch active period to 2026-10 BEFORE closing 2026-09
  await engine.updateProfile(tenantId, "u1", { activePeriod: "2026-10" });
  const fsOctBeforeClose = await engine.getFinancialStatements(tenantId, "2026-10");
  // Real balances must carry forward!
  assert.equal(fsOctBeforeClose.cumulativeBalances["1101"], 4_990_000);
  assert.equal(fsOctBeforeClose.cumulativeBalances["1105"], 60_000);
  assert.equal(fsOctBeforeClose.totalAssets, 5_050_000);
  // October operating revenue/expense = 0
  assert.equal(fsOctBeforeClose.revenue, 0);
  assert.equal(fsOctBeforeClose.netIncome, 0);
  // Prior unclosed net earnings (60,000 - 10,000 = 50,000) carried into opening equity
  assert.equal(fsOctBeforeClose.unclosedPriorEarnings, 50_000);
  assert.equal(fsOctBeforeClose.openingCapital, 5_050_000);
  assert.equal(fsOctBeforeClose.isBalanced, true);

  // Formally close September 2026
  const closed = await engine.closePeriod(tenantId, "u1", "2026-09");
  assert.equal(closed.periodRecord.status, "closed");
  assert.ok(closed.closingEntry);

  // Posting into closed 2026-09 must throw ClosedPeriodError
  await assert.rejects(
    () => engine.postCashExpense(tenantId, "u1", { date: "2026-09-15", amount: 25_000, expenseAccountCode: "5104" }),
    ClosedPeriodError,
  );

  // Post October sale: 2 @ 30,000 = 60,000 (COGS = 20,000)
  await engine.postSale(tenantId, "u1", {
    date: "2026-10-05",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 2,
    totalAmount: 60_000,
  });

  const fsOctAfter = await engine.getFinancialStatements(tenantId, "2026-10");
  assert.equal(fsOctAfter.unclosedPriorEarnings, 0);
  assert.equal(fsOctAfter.cumulativeBalances["3103"], -50_000); // Retained earnings credit 50,000
  assert.equal(fsOctAfter.openingCapital, 5_050_000);
  assert.equal(fsOctAfter.revenue, 60_000);
  assert.equal(fsOctAfter.cogs, 20_000);
  assert.equal(fsOctAfter.netIncome, 40_000);
  assert.equal(fsOctAfter.cumulativeBalances["1101"], 5_050_000);
  assert.equal(fsOctAfter.cumulativeBalances["1105"], 40_000);
  assert.equal(fsOctAfter.totalAssets, 5_090_000);
  assert.equal(fsOctAfter.endingCapital, 5_090_000);
  assert.equal(fsOctAfter.isBalanced, true);

  const tbOct = await engine.getTrialBalance(tenantId, "2026-10", true);
  assert.equal(tbOct.isBalanced, true);
});

test("Sample workspace seed produces balanced statements and consistent inventory valuation", async () => {
  const { repo, engine, tenantId } = setupEngine();
  const ws = await seedSampleWorkspace(repo, engine, tenantId);
  const fs = await engine.getFinancialStatements(tenantId, "2026-09");
  const tb = await engine.getTrialBalance(tenantId, "2026-09", true);

  assert.equal(fs.isBalanced, true);
  assert.equal(tb.isBalanced, true);

  // Verify Inventory Subledger sum matches Ledger Accounts 1104 and 1105
  const rawMatSum = ws.items
    .filter((i) => i.category === "raw_material")
    .reduce((sum, i) => sum + i.totalInventoryValue, 0);
  const finGoodSum = ws.items
    .filter((i) => i.category === "finished_good")
    .reduce((sum, i) => sum + i.totalInventoryValue, 0);

  assert.equal(fs.cumulativeBalances["1104"], rawMatSum);
  assert.equal(fs.cumulativeBalances["1105"], finGoodSum);
});

test("Rejects unbalanced journal lines and blocks voiding a purchase whose stock was already sold", async () => {
  const accountMap = getAccountMap(DEFAULT_ACCOUNTS);
  assert.throws(
    () =>
      validateJournalLines(
        [
          { accountCode: "1101", debit: 100_000, credit: 0 },
          { accountCode: "4101", debit: 0, credit: 90_000 },
        ],
        accountMap,
      ),
    ValidationError,
  );

  const { repo, engine, tenantId } = setupEngine();
  await repo.initializeWorkspace(tenantId, createEmptyWorkspace(tenantId, { activePeriod: "2026-09" }));

  const item = await engine.createItem(tenantId, "u1", {
    name: "Keripik",
    category: "finished_good",
    unit: "bungkus",
  });

  const pur = await engine.postPurchase(tenantId, "u1", {
    date: "2026-09-02",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 10,
    totalCost: 100_000,
  });

  await engine.postSale(tenantId, "u1", {
    date: "2026-09-03",
    paymentMethod: "cash",
    itemId: item.id,
    quantity: 4,
    totalAmount: 80_000,
  });

  // Cannot void purchase of 10 units because only 6 remain on hand
  await assert.rejects(
    () =>
      engine.voidJournalEntry(tenantId, "u1", {
        entryId: pur.entry.id,
        reason: "Salah input pembelian",
      }),
    InsufficientStockError,
  );
});

