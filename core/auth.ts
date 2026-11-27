import type { AccountingRepository } from "./repository.ts";
import { createEmptyWorkspace, seedAnekaSnackDemoWorkspace, seedSampleWorkspace } from "./sample-data.ts";
import {
  AccountingError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./types.ts";
import { assertNonEmptyText } from "./validation.ts";

export type BusinessRole = "owner" | "staff";

export type Permission =
  | "workspace:read"
  | "transactions:post"
  | "opname:post"
  | "adjustments:post"
  | "master:write"
  | "entry:void"
  | "reports:export"
  | "period:close"
  | "profile:update"
  | "workspace:reset"
  | "members:manage"
  | "audit:read";

const ROLE_PERMISSIONS: Record<BusinessRole, Set<Permission>> = {
  owner: new Set<Permission>([
    "workspace:read",
    "transactions:post",
    "opname:post",
    "adjustments:post",
    "master:write",
    "entry:void",
    "reports:export",
    "period:close",
    "profile:update",
    "workspace:reset",
    "members:manage",
    "audit:read",
  ]),
  staff: new Set<Permission>([
    "workspace:read",
    "transactions:post",
    "opname:post",
    "adjustments:post",
    "master:write",
    "entry:void",
    "reports:export",
  ]),
};

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  createdAt: string;
}

export interface BusinessMembership {
  id: string;
  userId: string;
  tenantId: string;
  role: BusinessRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipSummary extends BusinessMembership {
  businessName: string;
  city: string;
  activePeriod: string;
}

export interface BusinessMemberInfo {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  role: BusinessRole;
  active: boolean;
  createdAt: string;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  activeTenantId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface LoginRateLimitRecord {
  key: string;
  attempts: number;
  windowStartMs: number;
  lockedUntilMs: number;
}

export interface AuthenticatedContext {
  session: UserSessionRecord;
  user: PublicUser;
  tenantId: string;
  role: BusinessRole;
  memberships: MembershipSummary[];
  rotatedToken: string | null;
}

export class AuthenticationError extends AccountingError {
  constructor(message = "Email atau kata sandi salah.") {
    super("UNAUTHORIZED", message, 401);
    this.name = "AuthenticationError";
  }
}

export class TooManyAttemptsError extends AccountingError {
  constructor(message = "Terlalu banyak percobaan login gagal. Coba lagi beberapa menit lagi.") {
    super("TOO_MANY_ATTEMPTS", message, 429);
    this.name = "TooManyAttemptsError";
  }
}

export interface AuthRepository {
  countUsers(): Promise<number>;
  getUserById(userId: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<void>;

  getMembership(userId: string, tenantId: string): Promise<BusinessMembership | null>;
  listMembershipsForUser(userId: string): Promise<MembershipSummary[]>;
  listMembersForBusiness(tenantId: string): Promise<BusinessMemberInfo[]>;
  saveMembership(membership: BusinessMembership): Promise<void>;

  createSession(session: UserSessionRecord): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<UserSessionRecord | null>;
  rotateSessionToken(params: {
    sessionId: string;
    newTokenHash: string;
    newActiveTenantId: string;
    newExpiresAt: string;
    nowIso: string;
  }): Promise<void>;
  touchSession(sessionId: string, nowIso: string): Promise<void>;
  revokeSessionById(sessionId: string, nowIso: string): Promise<void>;
  revokeUserSessionsForTenant(userId: string, tenantId: string, nowIso: string): Promise<void>;

  getRateLimit(key: string): Promise<LoginRateLimitRecord | null>;
  saveRateLimit(record: LoginRateLimitRecord): Promise<void>;
  deleteRateLimit(key: string): Promise<void>;
}

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ROTATE_AFTER_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function normalizeEmail(raw: string): string {
  const clean = String(raw ?? "").trim().toLowerCase();
  if (!clean || clean.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new ValidationError("Format email tidak valid.");
  }
  return clean;
}

export function assertValidPassword(password: string): string {
  const raw = String(password ?? "");
  if (raw.length < 8 || raw.length > 128) {
    throw new ValidationError("Kata sandi wajib 8 hingga 128 karakter.");
  }
  return raw;
}

export async function hashPassword(password: string): Promise<string> {
  assertValidPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
      keyMaterial,
      256,
    ),
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 500_000) return false;
  const salt = fromBase64Url(parts[2]);
  const expected = fromBase64Url(parts[3]);
  if (!salt || !expected || expected.length !== 32) return false;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      keyMaterial,
      256,
    ),
  );
  return constantTimeBytesEqual(actual, expected);
}

export function generateOpaqueSessionToken(): string {
  return `umkmsess_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function hashSessionToken(rawToken: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken)),
  );
  return toBase64Url(digest);
}

export function hasPermission(role: BusinessRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function assertPermission(role: BusinessRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(
      `Akses ditolak: peran "${role}" tidak memiliki izin "${permission}". Operasi ini hanya untuk Owner.`,
    );
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export class AuthService {
  private readonly authRepo: AuthRepository;
  private readonly accountingRepo: AccountingRepository;

  constructor(authRepo: AuthRepository, accountingRepo: AccountingRepository) {
    this.authRepo = authRepo;
    this.accountingRepo = accountingRepo;
  }

  async needsBootstrap(): Promise<boolean> {
    return (await this.authRepo.countUsers()) === 0;
  }

  async bootstrapFirstOwner(input: {
    email: string;
    fullName: string;
    password: string;
    businessName: string;
    city?: string;
    seedDemo?: boolean;
  }) {
    if ((await this.authRepo.countUsers()) > 0) {
      throw new ForbiddenError("Bootstrap ditolak: akun Owner awal sudah terdaftar.");
    }
    return this.createRegisteredUserWithBusiness(input);
  }

  async register(input: {
    email: string;
    fullName: string;
    password: string;
    businessName: string;
    city?: string;
    seedDemo?: boolean;
  }) {
    return this.createRegisteredUserWithBusiness(input);
  }

  private async createRegisteredUserWithBusiness(input: {
    email: string;
    fullName: string;
    password: string;
    businessName: string;
    city?: string;
    seedDemo?: boolean;
  }) {
    const email = normalizeEmail(input.email);
    const fullName = assertNonEmptyText(input.fullName, "Nama lengkap");
    const businessName = assertNonEmptyText(input.businessName, "Nama usaha");
    const city = String(input.city ?? "Indonesia").trim();
    assertValidPassword(input.password);

    const existing = await this.authRepo.getUserByEmail(email);
    if (existing) {
      throw new AccountingError("REGISTRATION_FAILED", "Pendaftaran gagal. Gunakan email lain atau masuk ke akun Anda.", 409);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const userId = `usr-${crypto.randomUUID()}`;
    const tenantId = `tnt-${crypto.randomUUID()}`;
    const passwordHash = await hashPassword(input.password);

    const user: UserRecord = {
      id: userId,
      email,
      fullName,
      passwordHash,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const { AccountingEngine } = await import("./engine.ts");
    const engine = new AccountingEngine(this.accountingRepo);
    if (input.seedDemo !== false) {
      await seedSampleWorkspace(this.accountingRepo, engine, tenantId, userId);
      await engine.updateProfile(tenantId, userId, { businessName, city });
    } else {
      await this.accountingRepo.initializeWorkspace(
        tenantId,
        createEmptyWorkspace(tenantId, { businessName, city, nowIso }),
      );
    }

    await this.authRepo.createUser(user);
    const membership: BusinessMembership = {
      id: `mem-${crypto.randomUUID()}`,
      userId,
      tenantId,
      role: "owner",
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.authRepo.saveMembership(membership);

    const { session, rawToken } = await this.issueSession(userId, tenantId, nowMs);
    const memberships = await this.authRepo.listMembershipsForUser(userId);

    return {
      user: toPublicUser(user),
      tenantId,
      role: "owner" as BusinessRole,
      memberships,
      session,
      rawToken,
    };
  }

  async login(input: {
    email: string;
    password: string;
    clientKey?: string;
    nowMs?: number;
  }) {
    const nowMs = input.nowMs ?? Date.now();
    const email = normalizeEmail(input.email);
    const rateKeys = [`email:${email}`];
    if (input.clientKey) rateKeys.push(`ip:${input.clientKey}`);

    for (const key of rateKeys) {
      const rec = await this.authRepo.getRateLimit(key);
      if (rec && rec.lockedUntilMs > nowMs) {
        throw new TooManyAttemptsError();
      }
    }

    const user = await this.authRepo.getUserByEmail(email);
    const passwordOk = user && user.active
      ? await verifyPassword(String(input.password ?? ""), user.passwordHash)
      : false;

    if (!user || !user.active || !passwordOk) {
      for (const key of rateKeys) {
        await this.recordFailedAttempt(key, nowMs);
      }
      // Identical generic message whether email exists or password is wrong
      throw new AuthenticationError("Email atau kata sandi salah.");
    }

    for (const key of rateKeys) {
      await this.authRepo.deleteRateLimit(key);
    }

    const memberships = await this.authRepo.listMembershipsForUser(user.id);
    const activeMembership = memberships.find((m) => m.active);
    if (!activeMembership) {
      throw new ForbiddenError("Akun tidak memiliki keanggotaan bisnis yang aktif.");
    }

    const { session, rawToken } = await this.issueSession(user.id, activeMembership.tenantId, nowMs);
    return {
      user: toPublicUser(user),
      tenantId: activeMembership.tenantId,
      role: activeMembership.role,
      memberships,
      session,
      rawToken,
    };
  }

  async authenticateToken(
    rawToken: string,
    options?: { nowMs?: number; forceRotate?: boolean },
  ): Promise<AuthenticatedContext> {
    if (!rawToken || rawToken.length < 20) {
      throw new AuthenticationError("Sesi tidak ditemukan atau tidak valid.");
    }
    const nowMs = options?.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const tokenHash = await hashSessionToken(rawToken);
    const session = await this.authRepo.getSessionByTokenHash(tokenHash);

    if (!session || session.revokedAt !== null) {
      throw new AuthenticationError("Sesi tidak valid atau telah dicabut.");
    }
    if (Date.parse(session.expiresAt) <= nowMs) {
      await this.authRepo.revokeSessionById(session.id, nowIso);
      throw new AuthenticationError("Sesi telah kedaluwarsa. Silakan login kembali.");
    }

    const user = await this.authRepo.getUserById(session.userId);
    if (!user || !user.active) {
      throw new AuthenticationError("Akun pengguna tidak aktif.");
    }

    const membership = await this.authRepo.getMembership(user.id, session.activeTenantId);
    if (!membership || !membership.active) {
      throw new ForbiddenError("Anda tidak memiliki akses ke bisnis aktif ini.");
    }

    const memberships = await this.authRepo.listMembershipsForUser(user.id);
    const createdAtMs = Date.parse(session.createdAt);
    const shouldRotate =
      Boolean(options?.forceRotate) ||
      (Number.isFinite(createdAtMs) && nowMs - createdAtMs >= SESSION_ROTATE_AFTER_MS);

    let rotatedToken: string | null = null;
    let activeSession = session;

    if (shouldRotate) {
      const nextRawToken = generateOpaqueSessionToken();
      const nextHash = await hashSessionToken(nextRawToken);
      const nextExpiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();
      await this.authRepo.rotateSessionToken({
        sessionId: session.id,
        newTokenHash: nextHash,
        newActiveTenantId: session.activeTenantId,
        newExpiresAt: nextExpiresAt,
        nowIso,
      });
      rotatedToken = nextRawToken;
      activeSession = {
        ...session,
        tokenHash: nextHash,
        expiresAt: nextExpiresAt,
        lastSeenAt: nowIso,
      };
    } else {
      await this.authRepo.touchSession(session.id, nowIso);
    }

    return {
      session: activeSession,
      user: toPublicUser(user),
      tenantId: membership.tenantId,
      role: membership.role,
      memberships,
      rotatedToken,
    };
  }

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    const tokenHash = await hashSessionToken(rawToken);
    const session = await this.authRepo.getSessionByTokenHash(tokenHash);
    if (session && !session.revokedAt) {
      await this.authRepo.revokeSessionById(session.id, new Date().toISOString());
    }
  }

  async switchBusiness(
    ctx: AuthenticatedContext,
    targetTenantId: string,
    nowMs = Date.now(),
  ): Promise<AuthenticatedContext> {
    const cleanTarget = assertNonEmptyText(targetTenantId, "ID bisnis tujuan");
    const membership = await this.authRepo.getMembership(ctx.user.id, cleanTarget);
    if (!membership || !membership.active) {
      throw new ForbiddenError("Anda bukan anggota aktif pada bisnis yang diminta.");
    }

    const nowIso = new Date(nowMs).toISOString();
    const newRawToken = generateOpaqueSessionToken();
    const newHash = await hashSessionToken(newRawToken);
    const newExpiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();

    await this.authRepo.rotateSessionToken({
      sessionId: ctx.session.id,
      newTokenHash: newHash,
      newActiveTenantId: cleanTarget,
      newExpiresAt,
      nowIso,
    });

    const memberships = await this.authRepo.listMembershipsForUser(ctx.user.id);
    return {
      session: {
        ...ctx.session,
        activeTenantId: cleanTarget,
        tokenHash: newHash,
        expiresAt: newExpiresAt,
        lastSeenAt: nowIso,
      },
      user: ctx.user,
      tenantId: cleanTarget,
      role: membership.role,
      memberships,
      rotatedToken: newRawToken,
    };
  }

  async createBusinessForUser(
    ctx: AuthenticatedContext,
    input: { businessName: string; city?: string; seedDemo?: boolean },
    nowMs = Date.now(),
  ) {
    const businessName = assertNonEmptyText(input.businessName, "Nama bisnis baru");
    const city = String(input.city ?? "Indonesia").trim();
    const nowIso = new Date(nowMs).toISOString();
    const tenantId = `tnt-${crypto.randomUUID()}`;

    const { AccountingEngine } = await import("./engine.ts");
    const engine = new AccountingEngine(this.accountingRepo);
    if (input.seedDemo) {
      await seedSampleWorkspace(this.accountingRepo, engine, tenantId, ctx.user.id);
      await engine.updateProfile(tenantId, ctx.user.id, { businessName, city });
    } else {
      await this.accountingRepo.initializeWorkspace(
        tenantId,
        createEmptyWorkspace(tenantId, { businessName, city, nowIso }),
      );
    }

    await this.authRepo.saveMembership({
      id: `mem-${crypto.randomUUID()}`,
      userId: ctx.user.id,
      tenantId,
      role: "owner",
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return this.switchBusiness(ctx, tenantId, nowMs);
  }

  async listMembers(ctx: AuthenticatedContext): Promise<BusinessMemberInfo[]> {
    assertPermission(ctx.role, "members:manage");
    return this.authRepo.listMembersForBusiness(ctx.tenantId);
  }

  async upsertMember(
    ctx: AuthenticatedContext,
    input: { email: string; role: BusinessRole },
  ): Promise<BusinessMemberInfo[]> {
    assertPermission(ctx.role, "members:manage");
    const email = normalizeEmail(input.email);
    if (input.role !== "owner" && input.role !== "staff") {
      throw new ValidationError(`Peran "${input.role}" tidak valid. Pilih "owner" atau "staff".`);
    }

    const targetUser = await this.authRepo.getUserByEmail(email);
    if (!targetUser || !targetUser.active) {
      throw new NotFoundError(`Pengguna dengan email "${email}" belum terdaftar.`);
    }

    const existing = await this.authRepo.getMembership(targetUser.id, ctx.tenantId);
    const members = await this.authRepo.listMembersForBusiness(ctx.tenantId);
    if (existing?.role === "owner" && existing.active && input.role === "staff") {
      const ownerCount = members.filter((m) => m.active && m.role === "owner").length;
      if (ownerCount <= 1) {
        throw new ValidationError("Bisnis wajib memiliki minimal 1 Owner aktif.");
      }
    }

    const nowIso = new Date().toISOString();
    await this.authRepo.saveMembership({
      id: existing?.id ?? `mem-${crypto.randomUUID()}`,
      userId: targetUser.id,
      tenantId: ctx.tenantId,
      role: input.role,
      active: true,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });

    return this.authRepo.listMembersForBusiness(ctx.tenantId);
  }

  async removeMember(
    ctx: AuthenticatedContext,
    targetUserId: string,
  ): Promise<BusinessMemberInfo[]> {
    assertPermission(ctx.role, "members:manage");
    const existing = await this.authRepo.getMembership(targetUserId, ctx.tenantId);
    if (!existing || !existing.active) {
      throw new NotFoundError("Keanggotaan pengguna tidak ditemukan.");
    }

    const members = await this.authRepo.listMembersForBusiness(ctx.tenantId);
    if (existing.role === "owner") {
      const ownerCount = members.filter((m) => m.active && m.role === "owner").length;
      if (ownerCount <= 1) {
        throw new ValidationError("Tidak dapat menonaktifkan Owner terakhir pada bisnis ini.");
      }
    }

    const nowIso = new Date().toISOString();
    await this.authRepo.saveMembership({
      ...existing,
      active: false,
      updatedAt: nowIso,
    });
    await this.authRepo.revokeUserSessionsForTenant(targetUserId, ctx.tenantId, nowIso);
    return this.authRepo.listMembersForBusiness(ctx.tenantId);
  }

  /**
   * Provisions an isolated per-visitor "Aneka Snack" demo sandbox with its own
   * Owner & Staff accounts and real database-backed session authentication.
   */
  async provisionDemoSandbox(input: {
    role?: BusinessRole;
    clientKey?: string;
    nowMs?: number;
  }) {
    const requestedRole: BusinessRole = input.role === "staff" ? "staff" : "owner";
    const nowMs = input.nowMs ?? Date.now();
    const limitKey = `demo:${input.clientKey ?? "global"}`;
    const existingLimit = await this.authRepo.getRateLimit(limitKey);
    if (existingLimit && nowMs - existingLimit.windowStartMs <= RATE_LIMIT_WINDOW_MS) {
      if (existingLimit.attempts >= 12) {
        throw new TooManyAttemptsError(
          "Terlalu banyak pembuatan sesi demo dalam waktu singkat. Coba lagi beberapa menit lagi.",
        );
      }
      await this.authRepo.saveRateLimit({
        ...existingLimit,
        attempts: existingLimit.attempts + 1,
      });
    } else {
      await this.authRepo.saveRateLimit({
        key: limitKey,
        attempts: 1,
        windowStartMs: nowMs,
        lockedUntilMs: 0,
      });
    }

    const nowIso = new Date(nowMs).toISOString();
    const tenantId = `demo-${crypto.randomUUID()}`;
    const shortTag = tenantId.slice(5, 13);
    const ownerUserId = `usr-${crypto.randomUUID()}`;
    const staffUserId = `usr-${crypto.randomUUID()}`;

    const randomSecret = () => toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
    const [ownerHash, staffHash] = await Promise.all([
      hashPassword(randomSecret()),
      hashPassword(randomSecret()),
    ]);

    const ownerUser: UserRecord = {
      id: ownerUserId,
      email: `owner-${shortTag}@demo.aneka-snack.local`,
      fullName: "Pemilik Aneka Snack (Demo)",
      passwordHash: ownerHash,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const staffUser: UserRecord = {
      id: staffUserId,
      email: `staff-${shortTag}@demo.aneka-snack.local`,
      fullName: "Staf Kasir Aneka Snack (Demo)",
      passwordHash: staffHash,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.authRepo.createUser(ownerUser);
    await this.authRepo.createUser(staffUser);

    const { AccountingEngine } = await import("./engine.ts");
    const engine = new AccountingEngine(this.accountingRepo);
    await seedAnekaSnackDemoWorkspace(this.accountingRepo, engine, tenantId, ownerUserId);

    await this.authRepo.saveMembership({
      id: `mem-${crypto.randomUUID()}`,
      userId: ownerUserId,
      tenantId,
      role: "owner",
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await this.authRepo.saveMembership({
      id: `mem-${crypto.randomUUID()}`,
      userId: staffUserId,
      tenantId,
      role: "staff",
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const activeUser = requestedRole === "staff" ? staffUser : ownerUser;
    const { rawToken } = await this.issueSession(activeUser.id, tenantId, nowMs);
    const memberships = await this.authRepo.listMembershipsForUser(activeUser.id);

    return {
      user: toPublicUser(activeUser),
      tenantId,
      role: requestedRole,
      memberships,
      rawToken,
      demoAccounts: {
        ownerEmail: ownerUser.email,
        staffEmail: staffUser.email,
      },
    };
  }

  /**
   * Switches between the pre-provisioned Owner and Staff demo accounts scoped strictly
   * inside the caller's already-authenticated isolated demo sandbox tenant.
   */
  async switchDemoRole(
    ctx: AuthenticatedContext,
    targetRole: BusinessRole,
    nowMs = Date.now(),
  ) {
    if (!ctx.tenantId.startsWith("demo-")) {
      throw new ForbiddenError("Ganti peran cepat hanya berlaku pada sandbox demo.");
    }
    if (targetRole !== "owner" && targetRole !== "staff") {
      throw new ValidationError(`Peran demo "${targetRole}" tidak valid.`);
    }

    const members = await this.authRepo.listMembersForBusiness(ctx.tenantId);
    const targetMember = members.find((m) => m.active && m.role === targetRole);
    if (!targetMember) {
      throw new NotFoundError(`Akun demo dengan peran "${targetRole}" tidak ditemukan di sandbox ini.`);
    }

    const targetUser = await this.authRepo.getUserById(targetMember.userId);
    if (!targetUser || !targetUser.active) {
      throw new NotFoundError("Akun demo target tidak aktif.");
    }

    await this.authRepo.revokeSessionById(ctx.session.id, new Date(nowMs).toISOString());
    const { rawToken } = await this.issueSession(targetUser.id, ctx.tenantId, nowMs);
    const memberships = await this.authRepo.listMembershipsForUser(targetUser.id);

    return {
      user: toPublicUser(targetUser),
      tenantId: ctx.tenantId,
      role: targetMember.role,
      memberships,
      rawToken,
    };
  }

  private async issueSession(userId: string, activeTenantId: string, nowMs: number) {
    const rawToken = generateOpaqueSessionToken();
    const tokenHash = await hashSessionToken(rawToken);
    const nowIso = new Date(nowMs).toISOString();
    const session: UserSessionRecord = {
      id: `ses-${crypto.randomUUID()}`,
      userId,
      activeTenantId,
      tokenHash,
      expiresAt: new Date(nowMs + SESSION_TTL_MS).toISOString(),
      revokedAt: null,
      createdAt: nowIso,
      lastSeenAt: nowIso,
    };
    await this.authRepo.createSession(session);
    return { session, rawToken };
  }

  private async recordFailedAttempt(key: string, nowMs: number): Promise<void> {
    const existing = await this.authRepo.getRateLimit(key);
    if (!existing || nowMs - existing.windowStartMs > RATE_LIMIT_WINDOW_MS) {
      await this.authRepo.saveRateLimit({
        key,
        attempts: 1,
        windowStartMs: nowMs,
        lockedUntilMs: 0,
      });
      return;
    }

    const nextAttempts = existing.attempts + 1;
    await this.authRepo.saveRateLimit({
      key,
      attempts: nextAttempts,
      windowStartMs: existing.windowStartMs,
      lockedUntilMs: nextAttempts >= MAX_LOGIN_ATTEMPTS ? nowMs + RATE_LIMIT_WINDOW_MS : 0,
    });
  }
}
