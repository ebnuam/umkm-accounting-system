import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolve(process.env.SQLITE_DB_PATH || "./data/umkm-accounting.sqlite");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = resolve(process.argv[2] || `./backups/umkm-accounting-${stamp}.sqlite`);

mkdirSync(dirname(outPath), { recursive: true });
const sqlite = new DatabaseSync(dbPath);
try {
  const escaped = outPath.replace(/'/g, "''");
  sqlite.exec(`VACUUM INTO '${escaped}';`);
  const backupDb = new DatabaseSync(outPath);
  try {
    const check = backupDb.prepare("PRAGMA integrity_check;").get();
    console.log(`[backup-local] Backup created at ${outPath} (integrity_check: ${check?.integrity_check})`);
  } finally {
    backupDb.close();
  }
} finally {
  sqlite.close();
}
