import type { AccountingRepository } from "../core/index.ts";

export class LocalSqliteAccountingRepository {
  readonly dbPath = "";
}

export function createLocalSqliteRepository(): AccountingRepository {
  throw new Error(
    "LocalSqliteAccountingRepository tidak tersedia pada runtime Cloudflare Workers. Gunakan DB_ADAPTER=d1.",
  );
}
