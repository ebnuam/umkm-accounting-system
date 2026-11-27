import {
  AuthenticationError,
  type AuthenticatedContext,
  type AuthService,
} from "../core/index.ts";

export const AUTH_SESSION_COOKIE = "umkm_session";
const LEGACY_SESSION_COOKIE = "umkm_session_id";
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export class InvalidSessionError extends AuthenticationError {
  constructor(message = "Sesi tidak valid, kedaluwarsa, atau dicabut.") {
    super(message);
    this.name = "InvalidSessionError";
  }
}

function readCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function extractAuthToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return readCookieValue(cookieHeader, AUTH_SESSION_COOKIE);
}

export function extractClientKey(request: Request): string | undefined {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
  if (!forwarded) return undefined;
  return forwarded.split(",")[0]?.trim().slice(0, 64) || undefined;
}

export async function authenticateRequest(
  request: Request,
  authService: AuthService,
  options?: { nowMs?: number; forceRotate?: boolean },
): Promise<AuthenticatedContext> {
  const rawToken = extractAuthToken(request);
  if (!rawToken) {
    throw new AuthenticationError("Silakan login terlebih dahulu.");
  }
  return authService.authenticateToken(rawToken, options);
}

export function verifySameOriginRequest(request: Request): void {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    throw new InvalidSessionError("Permintaan lintas-situs (CSRF) ditolak.");
  }

  const reqUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === "null") {
      throw new InvalidSessionError("Origin null ditolak.");
    }
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new InvalidSessionError("Header Origin tidak valid.");
    }
    if (originUrl.host !== reqUrl.host) {
      throw new InvalidSessionError("Permintaan lintas-origin (CSRF) ditolak.");
    }
    return;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    let refUrl: URL;
    try {
      refUrl = new URL(referer);
    } catch {
      throw new InvalidSessionError("Header Referer tidak valid.");
    }
    if (refUrl.host !== reqUrl.host) {
      throw new InvalidSessionError("Permintaan lintas-origin (Referer) ditolak.");
    }
  }
}

export function attachAuthSessionCookie(
  response: Response,
  request: Request,
  rawToken: string,
): Response {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append(
    "set-cookie",
    `${AUTH_SESSION_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; Max-Age=${SEVEN_DAYS_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
  );
  response.headers.append(
    "set-cookie",
    `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
  return response;
}

export function clearAuthSessionCookie(response: Response, request: Request): Response {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append(
    "set-cookie",
    `${AUTH_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
  response.headers.append(
    "set-cookie",
    `${LEGACY_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
  return response;
}
