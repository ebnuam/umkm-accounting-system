import { and, inArray, isNull, like, lt, lte } from "drizzle-orm";
import {
  accountingPeriods,
  accounts,
  auditLogs,
  businessMemberships,
  inventoryMovements,
  invoicePayments,
  invoices,
  items,
  journalEntries,
  journalLines,
  loginRateLimits,
  parties,
  tenants,
  users,
  userSessions,
} from "./schema.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

export interface DemoCleanupResult {
  deletedTenants: string[];
  deletedUsers: number;
}

/**
 * Deletes expired visitor demo sandboxes (`demo-*`) older than `maxAgeHours`
 * that have no active unrevoked/unexpired sessions, keeping real tenants untouched.
 */
export async function cleanupExpiredDemoSandboxes(
  db: DrizzleDb,
  options?: { maxAgeHours?: number; nowMs?: number; batchSize?: number },
): Promise<DemoCleanupResult> {
  const maxAgeHours = options?.maxAgeHours ?? 24;
  const nowMs = options?.nowMs ?? Date.now();
  const batchSize = Math.min(25, Math.max(1, options?.batchSize ?? 20));
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - maxAgeHours * 3_600_000).toISOString();

  const candidateTenants: Array<{ id: string }> = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(like(tenants.id, "demo-%"), lte(tenants.createdAt, cutoffIso)))
    .limit(batchSize);

  if (candidateTenants.length === 0) {
    await db
      .delete(loginRateLimits)
      .where(and(lt(loginRateLimits.windowStartMs, nowMs - 86_400_000), lt(loginRateLimits.lockedUntilMs, nowMs)));
    return { deletedTenants: [], deletedUsers: 0 };
  }

  const candidateIds = candidateTenants.map((t) => t.id);
  const activeSessions: Array<{ activeTenantId: string; expiresAt: string }> = await db
    .select({
      activeTenantId: userSessions.activeTenantId,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .where(and(inArray(userSessions.activeTenantId, candidateIds), isNull(userSessions.revokedAt)));

  const busyTenantIds = new Set(
    activeSessions.filter((s) => s.expiresAt > nowIso).map((s) => s.activeTenantId),
  );
  const expiredTenantIds = candidateIds.filter((id) => !busyTenantIds.has(id));

  if (expiredTenantIds.length === 0) {
    return { deletedTenants: [], deletedUsers: 0 };
  }

  const demoMemberships: Array<{ userId: string }> = await db
    .select({ userId: businessMemberships.userId })
    .from(businessMemberships)
    .where(inArray(businessMemberships.tenantId, expiredTenantIds));
  const candidateUserIds = Array.from(new Set(demoMemberships.map((m) => m.userId)));

  await db.delete(auditLogs).where(inArray(auditLogs.tenantId, expiredTenantIds));
  await db.delete(accountingPeriods).where(inArray(accountingPeriods.tenantId, expiredTenantIds));
  await db.delete(invoicePayments).where(inArray(invoicePayments.tenantId, expiredTenantIds));
  await db.delete(invoices).where(inArray(invoices.tenantId, expiredTenantIds));
  await db.delete(inventoryMovements).where(inArray(inventoryMovements.tenantId, expiredTenantIds));
  await db.delete(journalLines).where(inArray(journalLines.tenantId, expiredTenantIds));
  await db.delete(journalEntries).where(inArray(journalEntries.tenantId, expiredTenantIds));
  await db.delete(items).where(inArray(items.tenantId, expiredTenantIds));
  await db.delete(parties).where(inArray(parties.tenantId, expiredTenantIds));
  await db.delete(accounts).where(inArray(accounts.tenantId, expiredTenantIds));
  await db.delete(userSessions).where(inArray(userSessions.activeTenantId, expiredTenantIds));
  await db.delete(businessMemberships).where(inArray(businessMemberships.tenantId, expiredTenantIds));
  await db.delete(tenants).where(inArray(tenants.id, expiredTenantIds));

  let deletedUsers = 0;
  if (candidateUserIds.length > 0) {
    const remaining: Array<{ userId: string }> = await db
      .select({ userId: businessMemberships.userId })
      .from(businessMemberships)
      .where(inArray(businessMemberships.userId, candidateUserIds));
    const stillBound = new Set(remaining.map((r) => r.userId));
    const orphanDemoUserIds = candidateUserIds.filter((id) => !stillBound.has(id));
    if (orphanDemoUserIds.length > 0) {
      await db.delete(userSessions).where(inArray(userSessions.userId, orphanDemoUserIds));
      await db
        .delete(users)
        .where(and(inArray(users.id, orphanDemoUserIds), like(users.email, "%@demo.aneka-snack.local")));
      deletedUsers = orphanDemoUserIds.length;
    }
  }

  await db
    .delete(loginRateLimits)
    .where(and(lt(loginRateLimits.windowStartMs, nowMs - 86_400_000), lt(loginRateLimits.lockedUntilMs, nowMs)));

  return { deletedTenants: expiredTenantIds, deletedUsers };
}
