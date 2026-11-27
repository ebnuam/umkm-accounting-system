import { mkdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolve(process.env.SQLITE_DB_PATH || "./data/umkm-accounting.sqlite");
const drizzleDir = resolve("./drizzle");

mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = new DatabaseSync(dbPath);

try {
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __local_migrations (
      tag TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const files = (await readdir(drizzleDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const applied = new Set(
    sqlite
      .prepare("SELECT tag FROM __local_migrations")
      .all()
      .map((r) => String(r.tag)),
  );

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = await readFile(resolve(drizzleDir, file), "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const stmt of statements) {
        sqlite.exec(stmt);
      }
      sqlite
        .prepare("INSERT INTO __local_migrations (tag, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
      sqlite.exec("COMMIT");
      appliedCount++;
      console.log(`[migrate-local] Applied ${file}`);
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  }

  console.log(
    `[migrate-local] Database ready at ${dbPath} (${appliedCount} new migration(s), ${files.length} total).`,
  );
} finally {
  sqlite.close();
}
