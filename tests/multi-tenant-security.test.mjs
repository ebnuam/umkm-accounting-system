import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../db/schema.ts";
import { DrizzleSqliteAccountingRepository } from "../db/d1-repository.ts";
import { DrizzleSqliteAuthRepository } from "../db/auth-repository.ts";
import {
  handleLogin,
  handleLogoutAuth,
  handleRegister,
  handleSwitchBusiness,
} from "../app/api/auth/_handler.ts";
import {
  handleClosePeriod,
  handleGetWorkspace,
  handleMasterMutation,
  handlePostOpname,
  handlePostTransaction,
  handleResetWorkspace,
  handleVoidEntry,
} from "../app/api/accounting/_handler.ts";
import { buildPdfBytes, sanitizeSpreadsheetCell } from "../app/api/accounting/_export.ts";
import { AccountingEngine, createEmptyWorkspace } from "../core/index.ts";

async function createMigratedSqliteRepos() {
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
    sqlite,
    repo: new DrizzleSqliteAccountingRepository(db),
    authRepo: new DrizzleSqliteAuthRepository(db),
  };
}

function extractSessionCookie(response) {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(/umkm_session=([^;]+)/);
  assert.ok(match, "Expected umkm_session Set-Cookie header");
  return `umkm_session=${match[1]}`;
}

test("Authenticated multi-tenant isolation rejects unauthenticated access, token tampering, legacy cookies, CSRF, and cross-tenant writes", async () => {
  const { repo, authRepo } = await createMigratedSqliteRepos();

  // 0. Unauthenticated workspace access must return 401 (no anonymous provisioning!)
  const resUnauth = await handleGetWorkspace(
    new Request("https://app.umkm.test/api/accounting/workspace"),
    repo,
    authRepo,
  );
  assert.equal(resUnauth.status, 401);

  // 1. User A registers Business A
  const resRegA = await handleRegister(
    new Request("https://app.umkm.test/api/auth/register", {
      method: "POST",
      headers: { origin: "https://app.umkm.test", "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@umkm.id",
        fullName: "Alice Owner",
        password: "PasswordAlice!123",
        businessName: "Usaha Alice",
      }),
    }),
    authRepo,
    repo,
    { disablePublicSignup: false },
  );
  assert.equal(resRegA.status, 201);
  const cookieA = extractSessionCookie(resRegA);
  const regAData = await resRegA.json();
  const tenantAId = regAData.activeTenantId;

  const resWsA = await handleGetWorkspace(
    new Request("https://app.umkm.test/api/accounting/workspace", {
      headers: { cookie: cookieA },
    }),
    repo,
    authRepo,
  );
  assert.equal(resWsA.status, 200);
  const dataA = await resWsA.json();
  assert.equal(dataA.workspace.profile.tenantId, tenantAId);
  assert.ok(dataA.workspace.items.length >= 4);

  // 2. User B registers Business B
  const resRegB = await handleRegister(
    new Request("https://app.umkm.test/api/auth/register", {
      method: "POST",
      headers: { origin: "https://app.umkm.test", "content-type": "application/json" },
      body: JSON.stringify({
        email: "bob@umkm.id",
        fullName: "Bob Owner",
        password: "PasswordBob!123",
        businessName: "Usaha Bob",
      }),
    }),
    authRepo,
    repo,
    { disablePublicSignup: false },
  );
  assert.equal(resRegB.status, 201);
  const cookieB = extractSessionCookie(resRegB);
  const regBData = await resRegB.json();
  assert.notEqual(regBData.activeTenantId, tenantAId);

  // 3. Spoofed / forged token and legacy cookie MUST be rejected with 401
  const resTampered = await handleGetWorkspace(
    new Request("https://app.umkm.test/api/accounting/workspace", {
      headers: { cookie: "umkm_session=umkmsess_forgedtokenvalue12345" },
    }),
    repo,
    authRepo,
  );
  assert.equal(resTampered.status, 401);

  const resLegacy = await handleGetWorkspace(
    new Request("https://app.umkm.test/api/accounting/workspace", {
      headers: { cookie: `umkm_session_id=${tenantAId}` },
    }),
    repo,
    authRepo,
  );
  assert.equal(resLegacy.status, 401);

  // 4. Unverified proxy identity header without real session MUST NOT authenticate
  const resHeaderSpoof = await handleGetWorkspace(
    new Request("https://app.umkm.test/api/accounting/workspace", {
      headers: { "oai-authenticated-user-email": "alice@umkm.id" },
    }),
    repo,
    authRepo,
  );
  assert.equal(resHeaderSpoof.status, 401);

  // 5. Cross-origin CSRF attempt on POST must return 401
  const resCsrf = await handlePostTransaction(
    new Request("https://app.umkm.test/api/accounting/transactions", {
      method: "POST",
      headers: {
        cookie: cookieA,
        origin: "https://attacker.evil",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "capital", date: "2026-09-05", amount: 50000 }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resCsrf.status, 401);

  // 6. User B cannot switch into Tenant A via tenantId manipulation -> 403
  const resSwitchHijack = await handleSwitchBusiness(
    new Request("https://app.umkm.test/api/auth/switch-business", {
      method: "POST",
      headers: {
        cookie: cookieB,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ tenantId: tenantAId }),
    }),
    authRepo,
    repo,
  );
  assert.equal(resSwitchHijack.status, 403);

  // 7. User B tries to pay Tenant A's invoice, void Tenant A's entry, opname/toggle Tenant A's item -> 404
  const itemA = dataA.workspace.items.find((i) => i.category === "finished_good");
  const openInvoiceA = dataA.workspace.invoices.find((inv) => inv.kind === "receivable" && inv.remainingAmount > 0);
  const entryA = dataA.workspace.journalEntries[0];
  assert.ok(itemA && openInvoiceA && entryA);

  const resCrossPay = await handlePostTransaction(
    new Request("https://app.umkm.test/api/accounting/transactions", {
      method: "POST",
      headers: {
        cookie: cookieB,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "collect_receivable",
        date: "2026-09-20",
        partyId: openInvoiceA.partyId,
        invoiceId: openInvoiceA.id,
        amount: 50000,
      }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resCrossPay.status, 404);

  const resCrossVoid = await handleVoidEntry(
    new Request(`https://app.umkm.test/api/accounting/entries/${entryA.id}/void`, {
      method: "POST",
      headers: {
        cookie: cookieB,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "Cross tenant attack" }),
    }),
    entryA.id,
    repo,
    authRepo,
  );
  assert.equal(resCrossVoid.status, 404);

  const resCrossOpname = await handlePostOpname(
    new Request("https://app.umkm.test/api/accounting/opname", {
      method: "POST",
      headers: {
        cookie: cookieB,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ date: "2026-09-30", itemId: itemA.id, physicalQuantity: 0 }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resCrossOpname.status, 404);

  const resCrossToggle = await handleMasterMutation(
    new Request("https://app.umkm.test/api/accounting/master", {
      method: "POST",
      headers: {
        cookie: cookieB,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "toggle_item", itemId: itemA.id }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resCrossToggle.status, 404);

  // 8. Tenant A attempts overpayment -> 409; Tenant A closes period; Tenant B remains unaffected
  const resOverpay = await handlePostTransaction(
    new Request("https://app.umkm.test/api/accounting/transactions", {
      method: "POST",
      headers: {
        cookie: cookieA,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "collect_receivable",
        date: "2026-09-22",
        partyId: openInvoiceA.partyId,
        invoiceId: openInvoiceA.id,
        amount: openInvoiceA.remainingAmount + 1000,
      }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resOverpay.status, 409);

  const resCloseA = await handleClosePeriod(
    new Request("https://app.umkm.test/api/accounting/periods/close", {
      method: "POST",
      headers: {
        cookie: cookieA,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ period: "2026-09" }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resCloseA.status, 200);

  const resPostB = await handlePostTransaction(
    new Request("https://app.umkm.test/api/accounting/transactions", {
      method: "POST",
      headers: {
        cookie: cookieB,
        origin: "https://app.umkm.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "capital",
        date: "2026-09-25",
        amount: 250000,
      }),
    }),
    repo,
    authRepo,
  );
  assert.equal(resPostB.status, 201);

  const resResetB = await handleResetWorkspace(
    new Request("https://app.umkm.test/api/accounting/reset", {
      method: "POST",
      headers: { cookie: cookieB, origin: "https://app.umkm.test" },
    }),
    repo,
    authRepo,
  );
  assert.equal(resResetB.status, 200);
  const periodA = await repo.getPeriod(tenantAId, "2026-09");
  assert.equal(periodA.status, "closed");

  // 9. Logout revokes session server-side and clears cookie
  const resNullOrigin = await handleLogoutAuth(
    new Request("https://app.umkm.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "null" },
    }),
    authRepo,
    repo,
  );
  assert.equal(resNullOrigin.status, 401);

  const resLogout = await handleLogoutAuth(
    new Request("https://app.umkm.test/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookieA, origin: "https://app.umkm.test" },
    }),
    authRepo,
    repo,
  );
  assert.equal(resLogout.status, 200);
  assert.match(resLogout.headers.get("set-cookie") ?? "", /umkm_session=;.*Max-Age=0/);

  // Reusing revoked cookieA must return 401!
  const resAfterLogout = await handleGetWorkspace(
    new Request("https://app.umkm.test/api/accounting/workspace", {
      headers: { cookie: cookieA },
    }),
    repo,
    authRepo,
  );
  assert.equal(resAfterLogout.status, 401);

  // Re-login issues a fresh valid session
  const resLoginAgain = await handleLogin(
    new Request("https://app.umkm.test/api/auth/login", {
      method: "POST",
      headers: { origin: "https://app.umkm.test", "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@umkm.id", password: "PasswordAlice!123" }),
    }),
    authRepo,
    repo,
  );
  assert.equal(resLoginAgain.status, 200);
  const freshCookieA = extractSessionCookie(resLoginAgain);
  assert.notEqual(freshCookieA, cookieA);
});

test("Concurrent stock sales, invoice payments, and double-voids cannot corrupt D1/SQLite state", async () => {
  const { repo } = await createMigratedSqliteRepos();
  const engine = new AccountingEngine(repo);
  const t = "t-concurrent";
  await repo.initializeWorkspace(t, createEmptyWorkspace(t, { activePeriod: "2026-09" }));

  const customer = await engine.createParty(t, "u1", { name: "Toko Jaya", type: "customer" });
  const item = await engine.createItem(t, "u1", {
    name: "Keripik",
    category: "finished_good",
    unit: "bungkus",
    openingQuantity: 10,
    openingTotalCost: 100_000,
    openingDate: "2026-09-01",
  });

  const [s1, s2] = await Promise.allSettled([
    engine.postSale(t, "u1", {
      date: "2026-09-02",
      paymentMethod: "cash",
      itemId: item.id,
      quantity: 6,
      totalAmount: 120_000,
    }),
    engine.postSale(t, "u1", {
      date: "2026-09-02",
      paymentMethod: "cash",
      itemId: item.id,
      quantity: 6,
      totalAmount: 120_000,
    }),
  ]);
  const fulfilledSales = [s1, s2].filter((r) => r.status === "fulfilled");
  const rejectedSales = [s1, s2].filter((r) => r.status === "rejected");
  assert.equal(fulfilledSales.length, 1);
  assert.equal(rejectedSales.length, 1);
  const itemAfter = await repo.getItem(t, item.id);
  assert.equal(itemAfter.quantityOnHand, 4);
  assert.equal(itemAfter.totalInventoryValue, 40_000);

  const sale = await engine.postSale(t, "u1", {
    date: "2026-09-03",
    paymentMethod: "credit",
    partyId: customer.id,
    itemId: item.id,
    quantity: 4,
    totalAmount: 400_000,
  });
  const [p1, p2] = await Promise.allSettled([
    engine.postInvoicePayment(t, "u1", {
      kind: "receivable",
      date: "2026-09-05",
      partyId: customer.id,
      invoiceId: sale.invoice.id,
      amount: 300_000,
    }),
    engine.postInvoicePayment(t, "u1", {
      kind: "receivable",
      date: "2026-09-05",
      partyId: customer.id,
      invoiceId: sale.invoice.id,
      amount: 300_000,
    }),
  ]);
  assert.equal([p1, p2].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal([p1, p2].filter((r) => r.status === "rejected").length, 1);
  const invAfter = await repo.getInvoice(t, sale.invoice.id);
  assert.equal(invAfter.remainingAmount, 100_000);

  const targetEntryId = fulfilledSales[0].value.entry.id;
  const [v1, v2] = await Promise.allSettled([
    engine.voidJournalEntry(t, "u1", { entryId: targetEntryId, reason: "Void 1" }),
    engine.voidJournalEntry(t, "u1", { entryId: targetEntryId, reason: "Void 2" }),
  ]);
  assert.equal([v1, v2].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal([v1, v2].filter((r) => r.status === "rejected").length, 1);
  const reversals = (await repo.listJournalEntries(t)).filter((e) => e.reversesEntryId === targetEntryId);
  assert.equal(reversals.length, 1);
});

test("Export hardening neutralizes spreadsheet formula injection and paginates large PDFs", () => {
  assert.equal(sanitizeSpreadsheetCell("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");
  assert.equal(sanitizeSpreadsheetCell("+SUM(A1:A2)"), "'+SUM(A1:A2)");
  assert.equal(sanitizeSpreadsheetCell("-100"), "'-100");
  assert.equal(sanitizeSpreadsheetCell("@SUM(1,2)"), "'@SUM(1,2)");
  assert.equal(sanitizeSpreadsheetCell("Penjualan Tunai"), "Penjualan Tunai");

  const manyRows = Array.from({ length: 75 }, (_, i) => ({
    label: `Akun #${i + 1}`,
    value: "Rp100.000",
    kind: "detail",
  }));
  const pdf = new TextDecoder().decode(
    buildPdfBytes("UMKM Uji", [{ title: "Laporan Panjang", subtitle: "2026-09", rows: manyRows }]),
  );
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /LAPORAN PANJANG \\\(LANJUTAN\\\)/);
});
