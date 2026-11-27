import {
  AccountingError,
  type AccountingRepository,
  type AuthRepository,
  AuthService,
  type BusinessRole,
  ValidationError,
} from "../../../core/index.ts";
import {
  attachAuthSessionCookie,
  authenticateRequest,
  clearAuthSessionCookie,
  extractAuthToken,
  extractClientKey,
  verifySameOriginRequest,
} from "../../request-session.ts";

const MAX_AUTH_JSON_BYTES = 16_384;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseJson(request: Request): Promise<Record<string, any>> {
  const raw = await request.text();
  if (raw.length > MAX_AUTH_JSON_BYTES) {
    throw new AccountingError("PAYLOAD_TOO_LARGE", "Ukuran permintaan melebihi batas.", 413);
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("Payload JSON harus berupa objek.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AccountingError) throw err;
    throw new ValidationError("Format JSON tidak valid.", "INVALID_JSON");
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function handleAuthError(error: unknown): Response {
  if (error instanceof AccountingError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }
  console.error("auth_api_error", error);
  return Response.json({ error: "Terjadi kesalahan pada layanan autentikasi." }, { status: 500 });
}

export async function handleGetAuthSession(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
  options?: { nowMs?: number; disablePublicSignup?: boolean; demoMode?: boolean },
): Promise<Response> {
  try {
    const authService = new AuthService(authRepo, accountingRepo);
    const rawToken = extractAuthToken(request);
    const publicRegistrationEnabled =
      !(options?.disablePublicSignup ?? process.env.DISABLE_PUBLIC_SIGNUP === "true");
    const demoMode = options?.demoMode ?? process.env.APP_DEMO_MODE === "true";

    if (!rawToken) {
      const needsBootstrap = demoMode ? false : await authService.needsBootstrap();
      return Response.json({
        authenticated: false,
        needsBootstrap,
        publicRegistrationEnabled,
        demoMode,
      });
    }

    try {
      const ctx = await authService.authenticateToken(rawToken, { nowMs: options?.nowMs });
      const res = Response.json({
        authenticated: true,
        user: ctx.user,
        activeTenantId: ctx.tenantId,
        role: ctx.role,
        memberships: ctx.memberships,
        publicRegistrationEnabled,
        demoMode,
      });
      return ctx.rotatedToken ? attachAuthSessionCookie(res, request, ctx.rotatedToken) : res;
    } catch {
      const needsBootstrap = demoMode ? false : await authService.needsBootstrap();
      const res = Response.json({
        authenticated: false,
        needsBootstrap,
        publicRegistrationEnabled,
        demoMode,
      });
      return clearAuthSessionCookie(res, request);
    }
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleDemoStart(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
  options?: { demoMode?: boolean; nowMs?: number },
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const demoMode = options?.demoMode ?? process.env.APP_DEMO_MODE === "true";
    if (!demoMode) {
      return Response.json(
        { error: "Mode demo publik tidak aktif pada environment ini.", code: "DEMO_DISABLED" },
        { status: 404 },
      );
    }
    const authService = new AuthService(authRepo, accountingRepo);
    const body = await parseJson(request);
    const role: BusinessRole = body.role === "staff" ? "staff" : "owner";
    const resData = await authService.provisionDemoSandbox({
      role,
      clientKey: extractClientKey(request),
      nowMs: options?.nowMs,
    });
    const response = Response.json(
      {
        authenticated: true,
        demoMode: true,
        user: resData.user,
        activeTenantId: resData.tenantId,
        role: resData.role,
        memberships: resData.memberships,
        demoAccounts: resData.demoAccounts,
      },
      { status: 201 },
    );
    return attachAuthSessionCookie(response, request, resData.rawToken);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleDemoSwitchRole(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
  options?: { demoMode?: boolean; nowMs?: number },
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const demoMode = options?.demoMode ?? process.env.APP_DEMO_MODE === "true";
    if (!demoMode) {
      return Response.json(
        { error: "Mode demo publik tidak aktif pada environment ini.", code: "DEMO_DISABLED" },
        { status: 404 },
      );
    }
    const authService = new AuthService(authRepo, accountingRepo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    const body = await parseJson(request);
    const targetRole: BusinessRole = body.role === "owner" ? "owner" : "staff";
    const updated = await authService.switchDemoRole(ctx, targetRole, options?.nowMs);
    const response = Response.json({
      authenticated: true,
      demoMode: true,
      user: updated.user,
      activeTenantId: updated.tenantId,
      role: updated.role,
      memberships: updated.memberships,
    });
    return attachAuthSessionCookie(response, request, updated.rawToken);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleRegister(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
  options?: { disablePublicSignup?: boolean },
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const disabled = options?.disablePublicSignup ?? process.env.DISABLE_PUBLIC_SIGNUP === "true";
    if (disabled) {
      return Response.json(
        { error: "Pendaftaran publik dinonaktifkan oleh administrator.", code: "SIGNUP_DISABLED" },
        { status: 403 },
      );
    }
    const authService = new AuthService(authRepo, accountingRepo);
    const body = await parseJson(request);
    const resData = await authService.register({
      email: String(body.email ?? ""),
      fullName: String(body.fullName ?? ""),
      password: String(body.password ?? ""),
      businessName: String(body.businessName ?? ""),
      city: body.city ? String(body.city) : "Indonesia",
      seedDemo: body.seedDemo !== false,
    });
    const response = Response.json(
      {
        authenticated: true,
        user: resData.user,
        activeTenantId: resData.tenantId,
        role: resData.role,
        memberships: resData.memberships,
      },
      { status: 201 },
    );
    return attachAuthSessionCookie(response, request, resData.rawToken);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleBootstrapOwner(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
  options?: { bootstrapSecret?: string },
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    if (!(await authService.needsBootstrap())) {
      return Response.json(
        { error: "Bootstrap ditutup: akun Owner awal sudah ada.", code: "BOOTSTRAP_LOCKED" },
        { status: 403 },
      );
    }
    const expectedToken = options?.bootstrapSecret ?? process.env.BOOTSTRAP_SETUP_TOKEN;
    const body = await parseJson(request);
    const providedToken = String(body.bootstrapToken ?? "");
    if (!expectedToken || expectedToken.length < 16 || !constantTimeStringEqual(providedToken, expectedToken)) {
      return Response.json(
        { error: "Token bootstrap tidak valid atau belum dikonfigurasi di server.", code: "FORBIDDEN" },
        { status: 403 },
      );
    }
    const resData = await authService.bootstrapFirstOwner({
      email: String(body.email ?? ""),
      fullName: String(body.fullName ?? ""),
      password: String(body.password ?? ""),
      businessName: String(body.businessName ?? ""),
      city: body.city ? String(body.city) : "Indonesia",
      seedDemo: body.seedDemo !== false,
    });
    const response = Response.json(
      {
        authenticated: true,
        user: resData.user,
        activeTenantId: resData.tenantId,
        role: resData.role,
        memberships: resData.memberships,
      },
      { status: 201 },
    );
    return attachAuthSessionCookie(response, request, resData.rawToken);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleLogin(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
  options?: { nowMs?: number },
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    const body = await parseJson(request);
    const resData = await authService.login({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      clientKey: extractClientKey(request),
      nowMs: options?.nowMs,
    });
    const response = Response.json({
      authenticated: true,
      user: resData.user,
      activeTenantId: resData.tenantId,
      role: resData.role,
      memberships: resData.memberships,
    });
    return attachAuthSessionCookie(response, request, resData.rawToken);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleLogoutAuth(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    await authService.logout(extractAuthToken(request));
    const response = Response.json({ loggedOut: true });
    return clearAuthSessionCookie(response, request);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleCreateBusiness(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    const ctx = await authenticateRequest(request, authService);
    const body = await parseJson(request);
    const updated = await authService.createBusinessForUser(ctx, {
      businessName: String(body.businessName ?? ""),
      city: body.city ? String(body.city) : "Indonesia",
      seedDemo: Boolean(body.seedDemo),
    });
    const response = Response.json(
      {
        authenticated: true,
        user: updated.user,
        activeTenantId: updated.tenantId,
        role: updated.role,
        memberships: updated.memberships,
      },
      { status: 201 },
    );
    return updated.rotatedToken
      ? attachAuthSessionCookie(response, request, updated.rotatedToken)
      : response;
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleSwitchBusiness(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    const ctx = await authenticateRequest(request, authService);
    const body = await parseJson(request);
    const updated = await authService.switchBusiness(ctx, String(body.tenantId ?? ""));
    const response = Response.json({
      authenticated: true,
      user: updated.user,
      activeTenantId: updated.tenantId,
      role: updated.role,
      memberships: updated.memberships,
    });
    return updated.rotatedToken
      ? attachAuthSessionCookie(response, request, updated.rotatedToken)
      : response;
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleListMembers(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
): Promise<Response> {
  try {
    const authService = new AuthService(authRepo, accountingRepo);
    const ctx = await authenticateRequest(request, authService);
    const members = await authService.listMembers(ctx);
    const response = Response.json({ members });
    return ctx.rotatedToken ? attachAuthSessionCookie(response, request, ctx.rotatedToken) : response;
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function handleManageMembers(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    const ctx = await authenticateRequest(request, authService);
    const body = await parseJson(request);
    const action = String(body.action ?? "upsert");
    const members =
      action === "remove"
        ? await authService.removeMember(ctx, String(body.userId ?? ""))
        : await authService.upsertMember(ctx, {
            email: String(body.email ?? ""),
            role: body.role as BusinessRole,
          });
    const response = Response.json({ members });
    return ctx.rotatedToken ? attachAuthSessionCookie(response, request, ctx.rotatedToken) : response;
  } catch (error) {
    return handleAuthError(error);
  }
}
