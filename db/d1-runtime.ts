import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { DrizzleSqliteAuthRepository } from "./auth-repository.ts";
import { D1AccountingRepository } from "./d1-repository.ts";
import { RELATIONAL_DDL } from "./ddl.ts";
import * as schema from "./schema.ts";

let schemaBootstrapped = false;

export function getD1Database() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in config/hosting.json to `DB` or switch to DB_ADAPTER=sqlite for self-hosted mode.",
    );
  }
  return drizzle(env.DB, { schema });
}

export async function createD1Repository() {
  const db = getD1Database();
  const dbBinding = env.DB;
  if (!schemaBootstrapped && dbBinding?.batch) {
    await dbBinding.batch(RELATIONAL_DDL.map((stmt) => dbBinding.prepare(stmt)));
    schemaBootstrapped = true;
  }
  return new D1AccountingRepository(db);
}

export async function createD1AuthRepository() {
  const repo = await createD1Repository();
  return new DrizzleSqliteAuthRepository(repo.getDrizzleClient());
}

export function getCloudflareWorkerVar(name: string): string | undefined {
  const workerEnv = env as unknown as Record<string, unknown>;
  const val = workerEnv[name];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}
