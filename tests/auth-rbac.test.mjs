import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../db/schema.ts";
import { DrizzleSqliteAccountingRepository } from "../db/d1-repository.ts";
import { DrizzleSqliteAuthRepository } from "../db/auth-repository.ts";
import { cleanupExpiredDemoSandboxes } from "../db/demo-cleanup.ts";
import { createLocalSqliteRepository } from "../db/local-sqlite-repository.ts";
import { hashPassword, verifyPassword } from "../core/index.ts";
import {
  handleBootstrapOwner,
  handleCreateBusiness,
  handleDemoStart,
  handleDemoSwitchRole,
  handleGetAuthSession,
  handleListMembers,
  handleLogin,
  handleLogoutAuth,
  handleManageMembers,
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

const execFileAsync = promisify(execFile);

function extractSessionCookie(response) {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(/umkm_session=([^;]+)/);
  assert.ok(match, "Expected umkm_session Set-Cookie header");
  return `umkm_session=${match[1]}`;
}

async function createD1StyleRepos() {
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
    accountingRepo: new DrizzleSqliteAccountingRepository(db),
    authRepo: new DrizzleSqliteAuthRepository(db),
    cleanup: async () => sqlite.close(),
  };
}

async function createLocalSqliteRepos() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "umkm-auth-"));
  const dbPath = path.join(tmpDir, "auth.sqlite");
  await execFileAsync(process.execPath, ["scripts/migrate-local.mjs"], {
    env: { ...process.env, SQLITE_DB_PATH: dbPath },
  });
  const accountingRepo = createLocalSqliteRepository({ dbPath });
  const authRepo = new DrizzleSqliteAuthRepository(accountingRepo.getDrizzleClient());
  return {
    accountingRepo,
    authRepo,
    cleanup: async () => {
      accountingRepo.close();
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

test("PBKDF2 password hashing uses random salts and never stores plaintext", async () => {
  const pw = "RahasiaUMKM#2026";
  const h1 = await hashPassword(pw);
  const h2 = await hashPassword(pw);
  assert.match(h1, /^pbkdf2_sha256\$100000\$/);
  assert.notEqual(h1, h2);
  assert.ok(!h1.includes(pw));
  assert.equal(await verifyPassword(pw, h1), true);
  assert.equal(await verifyPassword("SalahPassword1", h1), false);
});

for (const adapter of [
  { name: "D1Adapter", create: createD1StyleRepos },
  { name: "LocalSqliteAdapter", create: createLocalSqliteRepos },
]) {
  test(`Phase 6 Auth, Session Lifecycle, Multi-Business & RBAC (${adapter.name})`, async () => {
    const { accountingRepo, authRepo, cleanup } = await adapter.create();
    try {
      const origin = "https://app.umkm.test";

      // 1. Unauthenticated session state reports needsBootstrap=true
      const resInitSess = await handleGetAuthSession(
        new Request(`${origin}/api/auth/session`),
        authRepo,
        accountingRepo,
        { disablePublicSignup: false },
      );
      assert.equal(resInitSess.status, 200);
      const initSess = await resInitSess.json();
      assert.equal(initSess.authenticated, false);
      assert.equal(initSess.needsBootstrap, true);

      // 2. Unauthenticated access to accounting endpoints fails with 401
      assert.equal(
        (await handleGetWorkspace(new Request(`${origin}/api/accounting/workspace`), accountingRepo, authRepo)).status,
        401,
      );
      assert.equal(
        (
          await handlePostTransaction(
            new Request(`${origin}/api/accounting/transactions`, {
              method: "POST",
              headers: { origin, "content-type": "application/json" },
              body: JSON.stringify({ type: "capital", date: "2026-09-01", amount: 10000 }),
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        401,
      );

      // 3. Register Owner A & check secure cookie attributes + duplicate email rejection
      const resRegOwner = await handleRegister(
        new Request(`${origin}/api/auth/register`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            email: "owner@umkm.id",
            fullName: "Sari Pemilik",
            password: "OwnerPassword!99",
            businessName: "Keripik Sari",
            city: "Yogyakarta",
          }),
        }),
        authRepo,
        accountingRepo,
        { disablePublicSignup: false },
      );
      assert.equal(resRegOwner.status, 201);
      const setCookieRaw = resRegOwner.headers.get("set-cookie") ?? "";
      assert.match(setCookieRaw, /HttpOnly/);
      assert.match(setCookieRaw, /SameSite=Lax/);
      assert.match(setCookieRaw, /Secure/);
      const ownerCookie1 = extractSessionCookie(resRegOwner);
      const regOwner = await resRegOwner.json();
      assert.equal(regOwner.role, "owner");
      const tenant1 = regOwner.activeTenantId;

      const resDup = await handleRegister(
        new Request(`${origin}/api/auth/register`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            email: "OWNER@umkm.id",
            fullName: "Dup",
            password: "OwnerPassword!99",
            businessName: "Dup",
          }),
        }),
        authRepo,
        accountingRepo,
        { disablePublicSignup: false },
      );
      assert.equal(resDup.status, 409);

      // 4. Generic identical error for wrong password vs nonexistent email + rate limit after 5 failures
      const baseMs = 1_795_000_000_000;
      const resNoUser = await handleLogin(
        new Request(`${origin}/api/auth/login`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
          body: JSON.stringify({ email: "tidakada@umkm.id", password: "RandomPassword1" }),
        }),
        authRepo,
        accountingRepo,
        { nowMs: baseMs },
      );
      assert.equal(resNoUser.status, 401);
      const noUserJson = await resNoUser.json();

      let wrongJson;
      for (let i = 0; i < 5; i++) {
        const resWrong = await handleLogin(
          new Request(`${origin}/api/auth/login`, {
            method: "POST",
            headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
            body: JSON.stringify({ email: "owner@umkm.id", password: `Salah${i}!` }),
          }),
          authRepo,
          accountingRepo,
          { nowMs: baseMs + i * 1000 },
        );
        assert.equal(resWrong.status, 401);
        wrongJson = await resWrong.json();
      }
      assert.equal(wrongJson.error, noUserJson.error);

      // 6th attempt must be blocked (429) even with valid password
      const resLocked = await handleLogin(
        new Request(`${origin}/api/auth/login`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
          body: JSON.stringify({ email: "owner@umkm.id", password: "OwnerPassword!99" }),
        }),
        authRepo,
        accountingRepo,
        { nowMs: baseMs + 10_000 },
      );
      assert.equal(resLocked.status, 429);

      // After 16 minutes window expires, valid login succeeds
      const resLoginAfterLock = await handleLogin(
        new Request(`${origin}/api/auth/login`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
          body: JSON.stringify({ email: "owner@umkm.id", password: "OwnerPassword!99" }),
        }),
        authRepo,
        accountingRepo,
        { nowMs: baseMs + 16 * 60 * 1000 },
      );
      assert.equal(resLoginAfterLock.status, 200);
      const freshCookie = extractSessionCookie(resLoginAfterLock);

      // 5. Session token rotation after 12h + expiration after 7d
      const loginTime = baseMs + 16 * 60 * 1000;
      const resRotated = await handleGetWorkspace(
        new Request(`${origin}/api/accounting/workspace`, {
          headers: { cookie: freshCookie },
        }),
        accountingRepo,
        authRepo,
        { nowMs: loginTime + 13 * 60 * 60 * 1000 },
      );
      assert.equal(resRotated.status, 200);
      const rotatedCookie = extractSessionCookie(resRotated);
      assert.notEqual(rotatedCookie, freshCookie);

      // Old cookie immediately invalid after rotation!
      const resOldAfterRotate = await handleGetWorkspace(
        new Request(`${origin}/api/accounting/workspace`, {
          headers: { cookie: freshCookie },
        }),
        accountingRepo,
        authRepo,
        { nowMs: loginTime + 13 * 60 * 60 * 1000 + 1000 },
      );
      assert.equal(resOldAfterRotate.status, 401);

      // Expired session past 7 days rejected with 401
      const resExpired = await handleGetWorkspace(
        new Request(`${origin}/api/accounting/workspace`, {
          headers: { cookie: rotatedCookie },
        }),
        accountingRepo,
        authRepo,
        { nowMs: loginTime + 8 * 24 * 60 * 60 * 1000 },
      );
      assert.equal(resExpired.status, 401);

      // 6. Owner creates second business and switches back and forth cleanly
      const resCreateBiz2 = await handleCreateBusiness(
        new Request(`${origin}/api/auth/businesses`, {
          method: "POST",
          headers: { origin, cookie: ownerCookie1, "content-type": "application/json" },
          body: JSON.stringify({ businessName: "Toko Roti Sari", city: "Solo", seedDemo: false }),
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resCreateBiz2.status, 201);
      const biz2Json = await resCreateBiz2.json();
      const tenant2 = biz2Json.activeTenantId;
      const ownerCookie2 = extractSessionCookie(resCreateBiz2);
      assert.notEqual(tenant2, tenant1);
      assert.equal(biz2Json.memberships.length, 2);

      // Switch back to tenant1
      const resSwitchBack = await handleSwitchBusiness(
        new Request(`${origin}/api/auth/switch-business`, {
          method: "POST",
          headers: { origin, cookie: ownerCookie2, "content-type": "application/json" },
          body: JSON.stringify({ tenantId: tenant1 }),
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resSwitchBack.status, 200);
      const ownerCookieSwitched = extractSessionCookie(resSwitchBack);
      const switchJson = await resSwitchBack.json();
      assert.equal(switchJson.activeTenantId, tenant1);

      // Passing rogue tenantId in accounting payload cannot switch tenant
      const resRogueTenantBody = await handleMasterMutation(
        new Request(`${origin}/api/accounting/master`, {
          method: "POST",
          headers: { origin, cookie: ownerCookieSwitched, "content-type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant2,
            action: "create_party",
            name: "Pelanggan Tenant 1",
            type: "customer",
          }),
        }),
        accountingRepo,
        authRepo,
      );
      assert.equal(resRogueTenantBody.status, 200);
      const partyPayload = await resRogueTenantBody.json();
      assert.equal(partyPayload.workspace.profile.tenantId, tenant1);

      // 7. Register Staff user in its own business, then Owner invites Staff to tenant1
      const resRegStaff = await handleRegister(
        new Request(`${origin}/api/auth/register`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            email: "staff@umkm.id",
            fullName: "Budi Kasir",
            password: "StaffPassword!99",
            businessName: "Bisnis Budi",
          }),
        }),
        authRepo,
        accountingRepo,
        { disablePublicSignup: false },
      );
      assert.equal(resRegStaff.status, 201);
      const staffData = await resRegStaff.json();
      const staffPersonalCookie = extractSessionCookie(resRegStaff);

      const resAddMember = await handleManageMembers(
        new Request(`${origin}/api/auth/members`, {
          method: "POST",
          headers: { origin, cookie: ownerCookieSwitched, "content-type": "application/json" },
          body: JSON.stringify({ email: "staff@umkm.id", role: "staff" }),
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resAddMember.status, 200);

      // Staff switches into tenant1 -> succeeds & rotates cookie
      const resStaffSwitch = await handleSwitchBusiness(
        new Request(`${origin}/api/auth/switch-business`, {
          method: "POST",
          headers: { origin, cookie: staffPersonalCookie, "content-type": "application/json" },
          body: JSON.stringify({ tenantId: tenant1 }),
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resStaffSwitch.status, 200);
      const staffTenant1Cookie = extractSessionCookie(resStaffSwitch);

      // Staff can read workspace (without audit logs), post operational tx, opname, and void
      const resStaffWs = await handleGetWorkspace(
        new Request(`${origin}/api/accounting/workspace`, {
          headers: { cookie: staffTenant1Cookie },
        }),
        accountingRepo,
        authRepo,
      );
      assert.equal(resStaffWs.status, 200);
      const staffWs = await resStaffWs.json();
      assert.equal(staffWs.role, "staff");
      assert.equal(staffWs.workspace.auditLogs.length, 0);

      const resStaffTx = await handlePostTransaction(
        new Request(`${origin}/api/accounting/transactions`, {
          method: "POST",
          headers: { origin, cookie: staffTenant1Cookie, "content-type": "application/json" },
          body: JSON.stringify({ type: "capital", date: "2026-09-05", amount: 50_000 }),
        }),
        accountingRepo,
        authRepo,
      );
      assert.equal(resStaffTx.status, 201);
      const createdEntryId = (await resStaffTx.json()).result.id;

      const stockItem = staffWs.workspace.items.find((i) => i.trackInventory && i.active);
      assert.equal(
        (
          await handlePostOpname(
            new Request(`${origin}/api/accounting/opname`, {
              method: "POST",
              headers: { origin, cookie: staffTenant1Cookie, "content-type": "application/json" },
              body: JSON.stringify({ date: "2026-09-06", itemId: stockItem.id, physicalQuantity: stockItem.quantityOnHand }),
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        201,
      );

      assert.equal(
        (
          await handleVoidEntry(
            new Request(`${origin}/api/accounting/entries/${createdEntryId}/void`, {
              method: "POST",
              headers: { origin, cookie: staffTenant1Cookie, "content-type": "application/json" },
              body: JSON.stringify({ reason: "Koreksi kasir" }),
            }),
            createdEntryId,
            accountingRepo,
            authRepo,
          )
        ).status,
        200,
      );

      // Staff MUST be denied (403) on Owner-only operations
      assert.equal(
        (
          await handleMasterMutation(
            new Request(`${origin}/api/accounting/master`, {
              method: "POST",
              headers: { origin, cookie: staffTenant1Cookie, "content-type": "application/json" },
              body: JSON.stringify({ action: "update_profile", businessName: "Dibajak Staff" }),
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await handleClosePeriod(
            new Request(`${origin}/api/accounting/periods/close`, {
              method: "POST",
              headers: { origin, cookie: staffTenant1Cookie, "content-type": "application/json" },
              body: JSON.stringify({ period: "2026-09" }),
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await handleResetWorkspace(
            new Request(`${origin}/api/accounting/reset`, {
              method: "POST",
              headers: { origin, cookie: staffTenant1Cookie },
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await handleListMembers(
            new Request(`${origin}/api/auth/members`, {
              headers: { cookie: staffTenant1Cookie },
            }),
            authRepo,
            accountingRepo,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await handleManageMembers(
            new Request(`${origin}/api/auth/members`, {
              method: "POST",
              headers: { origin, cookie: staffTenant1Cookie, "content-type": "application/json" },
              body: JSON.stringify({ email: "staff@umkm.id", role: "owner" }),
            }),
            authRepo,
            accountingRepo,
          )
        ).status,
        403,
      );

      // Owner cannot remove the sole remaining Owner
      const resRemoveSelf = await handleManageMembers(
        new Request(`${origin}/api/auth/members`, {
          method: "POST",
          headers: { origin, cookie: ownerCookieSwitched, "content-type": "application/json" },
          body: JSON.stringify({ action: "remove", userId: regOwner.user.id }),
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resRemoveSelf.status, 400);

      // Owner removes staff -> staff's active session on tenant1 is revoked immediately!
      const resRemoveStaff = await handleManageMembers(
        new Request(`${origin}/api/auth/members`, {
          method: "POST",
          headers: { origin, cookie: ownerCookieSwitched, "content-type": "application/json" },
          body: JSON.stringify({ action: "remove", userId: staffData.user.id }),
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resRemoveStaff.status, 200);
      assert.equal(
        (
          await handleGetWorkspace(
            new Request(`${origin}/api/accounting/workspace`, {
              headers: { cookie: staffTenant1Cookie },
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        401,
      );

      // 8. Owner closes period & sees audit logs, then logs out (session revoked)
      const resOwnerClose = await handleClosePeriod(
        new Request(`${origin}/api/accounting/periods/close`, {
          method: "POST",
          headers: { origin, cookie: ownerCookieSwitched, "content-type": "application/json" },
          body: JSON.stringify({ period: "2026-09" }),
        }),
        accountingRepo,
        authRepo,
      );
      assert.equal(resOwnerClose.status, 200);
      const closedJson = await resOwnerClose.json();
      assert.ok(closedJson.workspace.auditLogs.length > 0);

      const resLogout = await handleLogoutAuth(
        new Request(`${origin}/api/auth/logout`, {
          method: "POST",
          headers: { origin, cookie: ownerCookieSwitched },
        }),
        authRepo,
        accountingRepo,
      );
      assert.equal(resLogout.status, 200);
      assert.equal(
        (
          await handleGetWorkspace(
            new Request(`${origin}/api/accounting/workspace`, {
              headers: { cookie: ownerCookieSwitched },
            }),
            accountingRepo,
            authRepo,
          )
        ).status,
        401,
      );
    } finally {
      await cleanup();
    }
  });
}

test("Self-hosted bootstrap endpoint & CLI lock permanently once first Owner exists", async () => {
  const { accountingRepo, authRepo, cleanup } = await createLocalSqliteRepos();
  try {
    const origin = "http://127.0.0.1:3000";
    const secret = "bootstrap-setup-token-min-16-chars";

    // Wrong or missing bootstrap token -> 403
    const resWrongBoot = await handleBootstrapOwner(
      new Request(`${origin}/api/auth/bootstrap`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          bootstrapToken: "wrong-token-00000",
          email: "first@umkm.local",
          fullName: "First Owner",
          password: "BootstrapPassword!1",
          businessName: "Usaha Pertama",
        }),
      }),
      authRepo,
      accountingRepo,
      { bootstrapSecret: secret },
    );
    assert.equal(resWrongBoot.status, 403);

    // Valid token creates first Owner
    const resBoot = await handleBootstrapOwner(
      new Request(`${origin}/api/auth/bootstrap`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          bootstrapToken: secret,
          email: "first@umkm.local",
          fullName: "First Owner",
          password: "BootstrapPassword!1",
          businessName: "Usaha Pertama",
        }),
      }),
      authRepo,
      accountingRepo,
      { bootstrapSecret: secret },
    );
    assert.equal(resBoot.status, 201);

    // Subsequent bootstrap call MUST fail permanently with 403 BOOTSTRAP_LOCKED
    const resLocked = await handleBootstrapOwner(
      new Request(`${origin}/api/auth/bootstrap`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          bootstrapToken: secret,
          email: "attacker@umkm.local",
          fullName: "Attacker",
          password: "BootstrapPassword!1",
          businessName: "Fake",
        }),
      }),
      authRepo,
      accountingRepo,
      { bootstrapSecret: secret },
    );
    assert.equal(resLocked.status, 403);
    assert.equal((await resLocked.json()).code, "BOOTSTRAP_LOCKED");
  } finally {
    await cleanup();
  }

  // Test bootstrap CLI script on an isolated migrated SQLite file
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "umkm-boot-cli-"));
  const cliDb = path.join(tmpDir, "cli-bootstrap.sqlite");
  try {
    const env = {
      ...process.env,
      SQLITE_DB_PATH: cliDb,
      BOOTSTRAP_OWNER_EMAIL: "cli-owner@umkm.local",
      BOOTSTRAP_OWNER_NAME: "Owner CLI",
      BOOTSTRAP_BUSINESS_NAME: "Warung CLI",
      BOOTSTRAP_OWNER_PASSWORD: "CliStrongPassword!22",
    };
    await execFileAsync(process.execPath, ["scripts/migrate-local.mjs"], { env });
    const { stdout } = await execFileAsync(process.execPath, ["scripts/bootstrap-owner.mjs"], { env });
    assert.match(stdout, /Sukses!/);

    // Running CLI again must fail because Owner already exists
    await assert.rejects(() =>
      execFileAsync(process.execPath, ["scripts/bootstrap-owner.mjs"], { env }),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("Controlled Aneka Snack demo sandbox isolates visitors, enforces Owner/Staff RBAC, and disables when APP_DEMO_MODE=false", async () => {
  const { accountingRepo, authRepo, cleanup } = await createD1StyleRepos();
  try {
    const origin = "https://demo.umkm.test";

    // Disabled by default when APP_DEMO_MODE !== true
    const resDisabled = await handleDemoStart(
      new Request(`${origin}/api/auth/demo-start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ role: "owner" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: false },
    );
    assert.equal(resDisabled.status, 404);

    // Visitor A starts isolated Aneka Snack Owner sandbox
    const resStartA = await handleDemoStart(
      new Request(`${origin}/api/auth/demo-start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "cf-connecting-ip": "198.51.100.1" },
        body: JSON.stringify({ role: "owner" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: true },
    );
    assert.equal(resStartA.status, 201);
    const cookieA = extractSessionCookie(resStartA);
    const payloadA = await resStartA.json();
    assert.ok(payloadA.activeTenantId.startsWith("demo-"));
    assert.equal(payloadA.role, "owner");

    // Verify Aneka Snack simulation data & balanced statements
    const resWsA = await handleGetWorkspace(
      new Request(`${origin}/api/accounting/workspace`, { headers: { cookie: cookieA } }),
      accountingRepo,
      authRepo,
    );
    assert.equal(resWsA.status, 200);
    const wsA = await resWsA.json();
    assert.equal(wsA.workspace.profile.businessName, "Aneka Snack");
    assert.equal(wsA.statements.isBalanced, true);
    assert.ok(wsA.workspace.items.some((i) => i.category === "raw_material" && i.name.includes("Singkong")));
    assert.ok(wsA.workspace.items.some((i) => i.category === "finished_good" && i.name.includes("Keripik")));
    assert.ok(wsA.workspace.invoices.some((inv) => inv.kind === "receivable" && inv.remainingAmount > 0));
    assert.ok(wsA.workspace.invoices.some((inv) => inv.kind === "payable" && inv.remainingAmount > 0));

    // Visitor B gets a completely separate sandbox tenant
    const resStartB = await handleDemoStart(
      new Request(`${origin}/api/auth/demo-start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "cf-connecting-ip": "198.51.100.2" },
        body: JSON.stringify({ role: "owner" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: true },
    );
    assert.equal(resStartB.status, 201);
    const cookieB = extractSessionCookie(resStartB);
    const payloadB = await resStartB.json();
    assert.notEqual(payloadB.activeTenantId, payloadA.activeTenantId);

    // Cross-tenant isolation between Visitor B and Visitor A
    const itemA = wsA.workspace.items[0];
    assert.equal(
      (
        await handleMasterMutation(
          new Request(`${origin}/api/accounting/master`, {
            method: "POST",
            headers: { origin, cookie: cookieB, "content-type": "application/json" },
            body: JSON.stringify({ action: "toggle_item", itemId: itemA.id }),
          }),
          accountingRepo,
          authRepo,
        )
      ).status,
      404,
    );

    // Visitor A switches role to Staff inside their own sandbox -> closes blocked (403)
    const resToStaff = await handleDemoSwitchRole(
      new Request(`${origin}/api/auth/demo-switch-role`, {
        method: "POST",
        headers: { origin, cookie: cookieA, "content-type": "application/json" },
        body: JSON.stringify({ role: "staff" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: true },
    );
    assert.equal(resToStaff.status, 200, await resToStaff.clone().text());
    const staffCookieA = extractSessionCookie(resToStaff);
    // Old Owner session was revoked upon role switch
    assert.equal(
      (await handleGetWorkspace(new Request(`${origin}/api/accounting/workspace`, { headers: { cookie: cookieA } }), accountingRepo, authRepo)).status,
      401,
    );
    assert.equal(
      (
        await handleClosePeriod(
          new Request(`${origin}/api/accounting/periods/close`, {
            method: "POST",
            headers: { origin, cookie: staffCookieA, "content-type": "application/json" },
            body: JSON.stringify({ period: "2026-09" }),
          }),
          accountingRepo,
          authRepo,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await handleResetWorkspace(
          new Request(`${origin}/api/accounting/reset`, {
            method: "POST",
            headers: { origin, cookie: staffCookieA },
          }),
          accountingRepo,
          authRepo,
        )
      ).status,
      403,
    );

    // Switch back to Owner -> reset restores clean Aneka Snack workspace
    const resToOwner = await handleDemoSwitchRole(
      new Request(`${origin}/api/auth/demo-switch-role`, {
        method: "POST",
        headers: { origin, cookie: staffCookieA, "content-type": "application/json" },
        body: JSON.stringify({ role: "owner" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: true },
    );
    assert.equal(resToOwner.status, 200);
    const newOwnerCookieA = extractSessionCookie(resToOwner);
    const resReset = await handleResetWorkspace(
      new Request(`${origin}/api/accounting/reset`, {
        method: "POST",
        headers: { origin, cookie: newOwnerCookieA },
      }),
      accountingRepo,
      authRepo,
    );
    assert.equal(resReset.status, 200);
    const resetJson = await resReset.json();
    assert.equal(resetJson.workspace.profile.businessName, "Aneka Snack");
    assert.equal(resetJson.statements.isBalanced, true);
  } finally {
    await cleanup();
  }
});

test("cleanupExpiredDemoSandboxes removes expired demo-* tenants while preserving active demo and real tenants", async () => {
  const { accountingRepo, authRepo, cleanup } = await createD1StyleRepos();
  try {
    const origin = "https://demo.umkm.test";
    const tOld = Date.now() - 48 * 3_600_000;
    const tNow = Date.now();

    // 1. Real user business (must never be touched)
    const realRes = await handleRegister(
      new Request(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "real@umkm.id",
          fullName: "Pemilik Asli",
          password: "RealPassword!99",
          businessName: "Toko Nyata",
          seedDemo: false,
        }),
      }),
      authRepo,
      accountingRepo,
      { disablePublicSignup: false },
    );
    assert.equal(realRes.status, 201);
    const realTenantId = (await realRes.json()).activeTenantId;

    // 2. Old demo sandbox created 48h ago (session now expired/revoked)
    const oldDemoRes = await handleDemoStart(
      new Request(`${origin}/api/auth/demo-start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ role: "owner" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: true, nowMs: tOld },
    );
    assert.equal(oldDemoRes.status, 201);
    const oldDemoTenantId = (await oldDemoRes.json()).activeTenantId;
    const oldDemoCookie = extractSessionCookie(oldDemoRes);
    await handleLogoutAuth(
      new Request(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { origin, cookie: oldDemoCookie },
      }),
      authRepo,
      accountingRepo,
    );

    // 3. Active demo sandbox created right now
    const freshDemoRes = await handleDemoStart(
      new Request(`${origin}/api/auth/demo-start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ role: "owner" }),
      }),
      authRepo,
      accountingRepo,
      { demoMode: true, nowMs: tNow },
    );
    assert.equal(freshDemoRes.status, 201);
    const freshDemoTenantId = (await freshDemoRes.json()).activeTenantId;

    // Force old demo tenant created_at to 48h ago in DB
    const db = accountingRepo.getDrizzleClient();
    await db.update(schema.tenants).set({ createdAt: new Date(tOld).toISOString() }).where(
      (await import("drizzle-orm")).eq(schema.tenants.id, oldDemoTenantId),
    );

    const summary = await cleanupExpiredDemoSandboxes(db, { maxAgeHours: 24, nowMs: tNow });
    assert.deepEqual(summary.deletedTenants, [oldDemoTenantId]);
    assert.equal(summary.deletedUsers, 2);

    // Real tenant & fresh demo remain intact
    const realWs = await accountingRepo.getWorkspace(realTenantId);
    assert.equal(realWs.profile.businessName, "Toko Nyata");
    const freshWs = await accountingRepo.getWorkspace(freshDemoTenantId);
    assert.equal(freshWs.profile.businessName, "Aneka Snack");
    assert.equal(await authRepo.countUsers(), 3); // 1 real + 2 fresh demo
  } finally {
    await cleanup();
  }
});
