import type { AccountingRepository, AuthRepository } from "../core/index.ts";
import type { LocalSqliteAccountingRepository } from "./local-sqlite-repository.ts";

export type DbAdapterKind = "d1" | "sqlite";

const globalKey = "__umkmLocalSqliteRepo";

export function resolveDbAdapter(): DbAdapterKind {
  const raw = (process.env.DB_ADAPTER ?? "d1").trim().toLowerCase();
  if (raw === "sqlite" || raw === "local" || raw === "local-sqlite") {
    return "sqlite";
  }
  if (raw === "d1" || raw === "") {
    return "d1";
  }
  throw new Error(
    `DB_ADAPTER="${raw}" tidak didukung. Gunakan "d1" (Cloudflare D1) atau "sqlite" (Self-Hosted SQLite).`,
  );
}

async function getLocalRepoSingleton() {
  const g = globalThis as Record<string, unknown>;
  const targetPath = process.env.SQLITE_DB_PATH ?? "./data/umkm-accounting.sqlite";
  const { createLocalSqliteRepository } = await import(
    "./local-sqlite-repository.ts"
  );
  const existing = g[globalKey] as LocalSqliteAccountingRepository | undefined;
  if (existing && existing.dbPath === targetPath) {
    return existing;
  }
  const repo = createLocalSqliteRepository({ dbPath: targetPath });
  g[globalKey] = repo;
  return repo;
}

/**
 * Unified repository factory selected via DB_ADAPTER environment variable.
 * - DB_ADAPTER=d1 (default): Cloudflare D1 via db/d1-runtime.ts
 * - DB_ADAPTER=sqlite: Local SQLite file via db/local-sqlite-repository.ts
 */
export async function getAccountingRepository(): Promise<AccountingRepository> {
  if (resolveDbAdapter() === "sqlite") {
    return getLocalRepoSingleton();
  }

  const { createD1Repository } = await import("./d1-runtime.ts");
  return createD1Repository();
}

export async function getAuthRepository(): Promise<AuthRepository> {
  if (resolveDbAdapter() === "sqlite") {
    const repo = await getLocalRepoSingleton();
    const { DrizzleSqliteAuthRepository } = await import("./auth-repository.ts");
    return new DrizzleSqliteAuthRepository(repo.getDrizzleClient());
  }

  const { createD1AuthRepository } = await import("./d1-runtime.ts");
  return createD1AuthRepository();
}

export async function getRepositories(): Promise<{
  accountingRepo: AccountingRepository;
  authRepo: AuthRepository;
}> {
  if (resolveDbAdapter() === "sqlite") {
    const repo = await getLocalRepoSingleton();
    const { DrizzleSqliteAuthRepository } = await import("./auth-repository.ts");
    return {
      accountingRepo: repo,
      authRepo: new DrizzleSqliteAuthRepository(repo.getDrizzleClient()),
    };
  }

  const [{ createD1Repository }, { DrizzleSqliteAuthRepository }] = await Promise.all([
    import("./d1-runtime.ts"),
    import("./auth-repository.ts"),
  ]);
  const repo = await createD1Repository();
  return {
    accountingRepo: repo,
    authRepo: new DrizzleSqliteAuthRepository(repo.getDrizzleClient()),
  };
}

/**
 * Backward-compatible alias for Cloudflare D1 route handlers.
 */
export async function getD1Repository(): Promise<AccountingRepository> {
  return getAccountingRepository();
}

export async function getRuntimeVar(name: string): Promise<string | undefined> {
  const fromProc = process.env[name];
  if (typeof fromProc === "string" && fromProc.length > 0) return fromProc;
  if (resolveDbAdapter() === "sqlite") return undefined;
  const { getCloudflareWorkerVar } = await import("./d1-runtime.ts");
  return getCloudflareWorkerVar(name);
}

export async function getRuntimeFlag(name: string): Promise<boolean> {
  const val = await getRuntimeVar(name);
  return val?.trim().toLowerCase() === "true";
}

export async function getRuntimeSessionSecret(): Promise<string | undefined> {
  return getRuntimeVar("SESSION_SECRET");
}

export async function getRuntimeProxySecret(): Promise<string | undefined> {
  return getRuntimeVar("TRUST_AUTH_PROXY_SECRET");
}

export async function getRuntimeBootstrapSecret(): Promise<string | undefined> {
  return getRuntimeVar("BOOTSTRAP_SETUP_TOKEN");
}
