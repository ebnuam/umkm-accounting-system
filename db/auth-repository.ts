import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  AuthRepository,
  BusinessMemberInfo,
  BusinessMembership,
  BusinessRole,
  LoginRateLimitRecord,
  MembershipSummary,
  UserRecord,
  UserSessionRecord,
} from "../core/index.ts";
import {
  businessMemberships,
  loginRateLimits,
  tenants,
  users,
  userSessions,
} from "./schema.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

/**
 * Shared Drizzle SQLite implementation of AuthRepository used by BOTH
 * Cloudflare D1 and Self-Hosted Local SQLite without duplicating SQL logic.
 */
export class DrizzleSqliteAuthRepository implements AuthRepository {
  private readonly db: DrizzleDb;

  constructor(db: DrizzleDb) {
    this.db = db;
  }

  async countUsers(): Promise<number> {
    const rows = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(users);
    return Number(rows?.[0]?.cnt ?? 0);
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ? this.mapUser(row) : null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row ? this.mapUser(row) : null;
  }

  async createUser(user: UserRecord): Promise<void> {
    await this.db.insert(users).values({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      passwordHash: user.passwordHash,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  async getMembership(userId: string, tenantId: string): Promise<BusinessMembership | null> {
    const [row] = await this.db
      .select()
      .from(businessMemberships)
      .where(
        and(
          eq(businessMemberships.userId, userId),
          eq(businessMemberships.tenantId, tenantId),
        ),
      )
      .limit(1);
    return row ? this.mapMembership(row) : null;
  }

  async listMembershipsForUser(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.db
      .select({
        id: businessMemberships.id,
        userId: businessMemberships.userId,
        tenantId: businessMemberships.tenantId,
        role: businessMemberships.role,
        active: businessMemberships.active,
        createdAt: businessMemberships.createdAt,
        updatedAt: businessMemberships.updatedAt,
        businessName: tenants.businessName,
        city: tenants.city,
        activePeriod: tenants.activePeriod,
      })
      .from(businessMemberships)
      .innerJoin(tenants, eq(businessMemberships.tenantId, tenants.id))
      .where(and(eq(businessMemberships.userId, userId), eq(businessMemberships.active, true)))
      .orderBy(asc(tenants.businessName));

    return rows.map((r: DrizzleDb) => ({
      id: r.id,
      userId: r.userId,
      tenantId: r.tenantId,
      role: r.role as BusinessRole,
      active: Boolean(r.active),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      businessName: r.businessName,
      city: r.city ?? "",
      activePeriod: r.activePeriod,
    }));
  }

  async listMembersForBusiness(tenantId: string): Promise<BusinessMemberInfo[]> {
    const memRows = await this.db
      .select()
      .from(businessMemberships)
      .where(eq(businessMemberships.tenantId, tenantId));

    if (!memRows.length) return [];
    const userIds = Array.from(new Set<string>(memRows.map((m: DrizzleDb) => String(m.userId))));
    const userRows = await this.db
      .select()
      .from(users)
      .where(inArray(users.id, userIds));

    const userById = new Map<string, DrizzleDb>();
    for (const u of userRows) {
      userById.set(String(u.id), u);
    }

    const result: BusinessMemberInfo[] = [];
    for (const m of memRows) {
      const u = userById.get(String(m.userId));
      if (!u) continue;
      result.push({
        membershipId: m.id,
        userId: u.id,
        email: u.email,
        fullName: u.fullName,
        role: m.role as BusinessRole,
        active: Boolean(m.active) && Boolean(u.active),
        createdAt: m.createdAt,
      });
    }
    return result.sort((a, b) => a.email.localeCompare(b.email));
  }

  async saveMembership(membership: BusinessMembership): Promise<void> {
    await this.db
      .insert(businessMemberships)
      .values({
        id: membership.id,
        userId: membership.userId,
        tenantId: membership.tenantId,
        role: membership.role,
        active: membership.active,
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
      })
      .onConflictDoUpdate({
        target: businessMemberships.id,
        set: {
          role: membership.role,
          active: membership.active,
          updatedAt: membership.updatedAt,
        },
      });
  }

  async createSession(session: UserSessionRecord): Promise<void> {
    await this.db.insert(userSessions).values({
      id: session.id,
      userId: session.userId,
      activeTenantId: session.activeTenantId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
    });
  }

  async getSessionByTokenHash(tokenHash: string): Promise<UserSessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1);
    return row ? this.mapSession(row) : null;
  }

  async rotateSessionToken(params: {
    sessionId: string;
    newTokenHash: string;
    newActiveTenantId: string;
    newExpiresAt: string;
    nowIso: string;
  }): Promise<void> {
    await this.db
      .update(userSessions)
      .set({
        tokenHash: params.newTokenHash,
        activeTenantId: params.newActiveTenantId,
        expiresAt: params.newExpiresAt,
        lastSeenAt: params.nowIso,
      })
      .where(eq(userSessions.id, params.sessionId));
  }

  async touchSession(sessionId: string, nowIso: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ lastSeenAt: nowIso })
      .where(eq(userSessions.id, sessionId));
  }

  async revokeSessionById(sessionId: string, nowIso: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: nowIso })
      .where(eq(userSessions.id, sessionId));
  }

  async revokeUserSessionsForTenant(userId: string, tenantId: string, nowIso: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: nowIso })
      .where(
        and(
          eq(userSessions.userId, userId),
          eq(userSessions.activeTenantId, tenantId),
          isNull(userSessions.revokedAt),
        ),
      );
  }

  async getRateLimit(key: string): Promise<LoginRateLimitRecord | null> {
    const [row] = await this.db
      .select()
      .from(loginRateLimits)
      .where(eq(loginRateLimits.key, key))
      .limit(1);
    if (!row) return null;
    return {
      key: row.key,
      attempts: Number(row.attempts),
      windowStartMs: Number(row.windowStartMs),
      lockedUntilMs: Number(row.lockedUntilMs),
    };
  }

  async saveRateLimit(record: LoginRateLimitRecord): Promise<void> {
    await this.db
      .insert(loginRateLimits)
      .values({
        key: record.key,
        attempts: record.attempts,
        windowStartMs: record.windowStartMs,
        lockedUntilMs: record.lockedUntilMs,
      })
      .onConflictDoUpdate({
        target: loginRateLimits.key,
        set: {
          attempts: record.attempts,
          windowStartMs: record.windowStartMs,
          lockedUntilMs: record.lockedUntilMs,
        },
      });
  }

  async deleteRateLimit(key: string): Promise<void> {
    await this.db.delete(loginRateLimits).where(eq(loginRateLimits.key, key));
  }

  private mapUser = (row: DrizzleDb): UserRecord => ({
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapMembership = (row: DrizzleDb): BusinessMembership => ({
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    role: row.role as BusinessRole,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapSession = (row: DrizzleDb): UserSessionRecord => ({
    id: row.id,
    userId: row.userId,
    activeTenantId: row.activeTenantId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt ?? null,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  });
}
