import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { DrizzleSqliteAccountingRepository } from "./d1-repository.ts";
import { RELATIONAL_DDL } from "./ddl.ts";
import * as schema from "./schema.ts";

export interface LocalSqliteOptions {
  dbPath?: string;
  applyMigrations?: boolean;
}

/**
 * Self-hosted Local SQLite adapter implementing AccountingRepository without Cloudflare Workers/D1.
 * Reuses DrizzleSqliteAccountingRepository over Node's built-in `node:sqlite` (DatabaseSync)
 * with atomic `BEGIN IMMEDIATE ... COMMIT / ROLLBACK` transactions.
 */
export class LocalSqliteAccountingRepository extends DrizzleSqliteAccountingRepository {
  private readonly sqlite: DatabaseSync;
  readonly dbPath: string;

  constructor(sqlite: DatabaseSync, dbPath: string) {
    const execQuery = (
      sqlText: string,
      params: unknown[],
      method: "run" | "all" | "values" | "get",
    ) => {
      const cleanParams = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
      const prepared = sqlite.prepare(sqlText);
      if (method === "run") {
        prepared.run(...(cleanParams as never[]));
        return { rows: [] };
      }
      if (method === "get") {
        const row = prepared.get(...(cleanParams as never[]));
        return { rows: row ? Object.values(row) : [] };
      }
      const rows = prepared.all(...(cleanParams as never[]));
      return { rows: rows.map((r) => Object.values(r as Record<string, unknown>)) };
    };

    const db = drizzle(
      async (sqlText, params, method) => execQuery(sqlText, params, method),
      async (batch) => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const results = batch.map((b) => execQuery(b.sql, b.params, b.method));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      { schema },
    );

    super(db);
    this.sqlite = sqlite;
    this.dbPath = dbPath;
  }

  getSqliteConnection(): DatabaseSync {
    return this.sqlite;
  }

  close(): void {
    this.sqlite.close();
  }
}

export function applyLocalSqliteSchema(sqlite: DatabaseSync, isFileBacked: boolean): void {
  if (isFileBacked) {
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec("PRAGMA synchronous = NORMAL;");
  }
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const stmt of RELATIONAL_DDL) {
    sqlite.exec(stmt);
  }
  const hasCol = (table: string, col: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
      (c) => c.name === col,
    );
  if (!hasCol("tenants", "business_sector")) {
    sqlite.exec(`ALTER TABLE tenants ADD COLUMN business_sector TEXT DEFAULT 'general' NOT NULL;`);
  }
  if (!hasCol("items", "revenue_account_code")) {
    sqlite.exec(`ALTER TABLE items ADD COLUMN revenue_account_code TEXT;`);
  }
}

export function createLocalSqliteRepository(
  options?: LocalSqliteOptions,
): LocalSqliteAccountingRepository {
  const dbPath =
    options?.dbPath ?? process.env.SQLITE_DB_PATH ?? "./data/umkm-accounting.sqlite";
  const isMemory = dbPath === ":memory:" || dbPath.startsWith("file::memory:");
  if (!isMemory) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new DatabaseSync(dbPath);
  if (options?.applyMigrations !== false) {
    applyLocalSqliteSchema(sqlite, !isMemory);
  }
  return new LocalSqliteAccountingRepository(sqlite, dbPath);
}
