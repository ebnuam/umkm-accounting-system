import type {
  AuthRepository,
  BusinessMemberInfo,
  BusinessMembership,
  LoginRateLimitRecord,
  MembershipSummary,
  UserRecord,
  UserSessionRecord,
} from "./auth.ts";
import type { AccountingRepository } from "./repository.ts";

export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, UserRecord>();
  private readonly memberships = new Map<string, BusinessMembership>();
  private readonly sessions = new Map<string, UserSessionRecord>();
  private readonly rateLimits = new Map<string, LoginRateLimitRecord>();
  private readonly accountingRepo?: AccountingRepository;

  constructor(accountingRepo?: AccountingRepository) {
    this.accountingRepo = accountingRepo;
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const u = this.users.get(userId);
    return u ? { ...u } : null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return { ...u };
    }
    return null;
  }

  async createUser(user: UserRecord): Promise<void> {
    this.users.set(user.id, { ...user });
  }

  private memKey(userId: string, tenantId: string): string {
    return `${userId}::${tenantId}`;
  }

  async getMembership(userId: string, tenantId: string): Promise<BusinessMembership | null> {
    const m = this.memberships.get(this.memKey(userId, tenantId));
    return m ? { ...m } : null;
  }

  async listMembershipsForUser(userId: string): Promise<MembershipSummary[]> {
    const out: MembershipSummary[] = [];
    for (const m of this.memberships.values()) {
      if (m.userId !== userId || !m.active) continue;
      let businessName = m.tenantId;
      let city = "";
      let activePeriod = "2026-09";
      if (this.accountingRepo) {
        try {
          const ws = await this.accountingRepo.getWorkspace(m.tenantId);
          businessName = ws.profile.businessName;
          city = ws.profile.city;
          activePeriod = ws.profile.activePeriod;
        } catch {
          // Ignore if workspace not yet loaded
        }
      }
      out.push({ ...m, businessName, city, activePeriod });
    }
    return out;
  }

  async listMembersForBusiness(tenantId: string): Promise<BusinessMemberInfo[]> {
    const out: BusinessMemberInfo[] = [];
    for (const m of this.memberships.values()) {
      if (m.tenantId !== tenantId) continue;
      const u = this.users.get(m.userId);
      if (!u) continue;
      out.push({
        membershipId: m.id,
        userId: u.id,
        email: u.email,
        fullName: u.fullName,
        role: m.role,
        active: m.active && u.active,
        createdAt: m.createdAt,
      });
    }
    return out;
  }

  async saveMembership(membership: BusinessMembership): Promise<void> {
    this.memberships.set(this.memKey(membership.userId, membership.tenantId), { ...membership });
  }

  async createSession(session: UserSessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async getSessionByTokenHash(tokenHash: string): Promise<UserSessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.tokenHash === tokenHash) return { ...s };
    }
    return null;
  }

  async rotateSessionToken(params: {
    sessionId: string;
    newTokenHash: string;
    newActiveTenantId: string;
    newExpiresAt: string;
    nowIso: string;
  }): Promise<void> {
    const s = this.sessions.get(params.sessionId);
    if (!s) return;
    this.sessions.set(params.sessionId, {
      ...s,
      tokenHash: params.newTokenHash,
      activeTenantId: params.newActiveTenantId,
      expiresAt: params.newExpiresAt,
      lastSeenAt: params.nowIso,
    });
  }

  async touchSession(sessionId: string, nowIso: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.set(sessionId, { ...s, lastSeenAt: nowIso });
  }

  async revokeSessionById(sessionId: string, nowIso: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.set(sessionId, { ...s, revokedAt: nowIso });
  }

  async revokeUserSessionsForTenant(userId: string, tenantId: string, nowIso: string): Promise<void> {
    for (const [id, s] of this.sessions.entries()) {
      if (s.userId === userId && s.activeTenantId === tenantId && !s.revokedAt) {
        this.sessions.set(id, { ...s, revokedAt: nowIso });
      }
    }
  }

  async getRateLimit(key: string): Promise<LoginRateLimitRecord | null> {
    const r = this.rateLimits.get(key);
    return r ? { ...r } : null;
  }

  async saveRateLimit(record: LoginRateLimitRecord): Promise<void> {
    this.rateLimits.set(record.key, { ...record });
  }

  async deleteRateLimit(key: string): Promise<void> {
    this.rateLimits.delete(key);
  }
}
