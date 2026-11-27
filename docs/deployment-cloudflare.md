# Panduan Deployment Cloudflare Workers & D1

Dokumen ini menjelaskan arsitektur, konfigurasi Wrangler, migrasi D1 non-destruktif, pengelolaan secret, serta backup & restore untuk deployment **UMKM Accounting System** di Cloudflare Workers + Cloudflare D1.

---

## 1. Arsitektur & Konfigurasi

| Komponen | Lokasi / Nilai | Keterangan |
| --- | --- | --- |
| Entrypoint Worker | [`worker/index.ts`](file:///worker/index.ts) | Menjalankan Vinext App Router + static assets (`dist/client`) |
| Konfigurasi Wrangler | [`config/wrangler.demo.jsonc`](file:///config/wrangler.demo.jsonc) | Dedicated demo environment (`umkm-accounting-demo`, `nodejs_compat`, `workers_dev: true`, cron pembersihan sandbox tiap 6 jam `0 */6 * * *`) |
| Konfigurasi Vite Build | [`vite.config.ts`](file:///vite.config.ts) | Mengalias `node:sqlite` dan `db/local-sqlite-repository.ts` ke [`db/local-sqlite-stub.ts`](file:///db/local-sqlite-stub.ts) saat build Cloudflare Workers |
| D1 Repository & Chunking | [`db/d1-repository.ts`](file:///db/d1-repository.ts) | Membagi multi-row `INSERT` secara otomatis (`<= 80` bind parameters per statement) agar patuh terhadap batas 100 bind parameter Cloudflare D1 |
| Runtime Env Vars | [`db/index.ts`](file:///db/index.ts) + [`db/d1-runtime.ts`](file:///db/d1-runtime.ts) | Membaca `env.*` dari `cloudflare:workers` maupun `process.env.*` secara seragam |

### Binding & Environment Variables (`config/wrangler.demo.jsonc`)
- **D1 Binding**: `DB` → `umkm-accounting-demo-db` (`database_id`: `786d846e-cda3-4426-901d-3114b41c936e`, region `APAC`, `migrations_dir: "drizzle"`).
- **Vars**:
  - `APP_DEMO_MODE`: `"true"` *(hanya diaktifkan pada environment demo publik; wajib `"false"` atau tidak diset di environment produksi!)*
  - `DISABLE_PUBLIC_SIGNUP`: `"false"` *(dapat diset `"true"` untuk deployment privat)*
- **Secrets** (diunggah via `wrangler secret put`, **tidak pernah** disimpan di source code):
  - `SESSION_SECRET`: 96 karakter heksadesimal acak (48 byte entropi).
- **Layanan Berbayar**: `r2_buckets` tidak dipakai, `observability.enabled` diset `false`, dan tidak ada Durable Objects, Queues, atau KV tambahan yang dikonfigurasi.

---

## 2. Migrasi Database Cloudflare D1

Seluruh migrasi di folder `drizzle/` (`0000`–`0004`) bersifat **non-destruktif** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, trigger integritas `BEFORE UPDATE`, serta `ALTER TABLE` penambah kolom tanpa `DROP TABLE`):

1. `0000_stiff_mad_thinker.sql` — tabel legacy baseline.
2. `0001_phase3_relational_core.sql` — tabel inti akuntansi multi-tenant (`tenants`, `accounts`, `parties`, `items`, `journal_entries`, `journal_lines`, `inventory_movements`, `invoices`, `invoice_payments`, `accounting_periods`, `audit_logs`).
3. `0002_phase45_hardening_constraints.sql` — unique index anti double-void serta 3 trigger SQLite (`CHECK_NEGATIVE_STOCK`, `CHECK_OVERPAYMENT`, `CHECK_DOUBLE_PERIOD_CLOSE`).
4. `0003_phase6_auth_membership.sql` — `users`, `business_memberships`, `user_sessions`, `login_rate_limits`.
5. `0004_phase8_universal_coa_manufacturing.sql` — `business_sector` pada `tenants` dan `revenue_account_code` pada `items`.

Menjalankan migrasi ke D1 remote target:
```bash
npx wrangler d1 migrations apply umkm-accounting-demo-db --config config/wrangler.demo.jsonc --remote
```

---

## 3. Build, Secret & Deploy

```bash
# 1. Build bundle Cloudflare Workers + client assets
npx vinext build

# 2. Deploy ke Cloudflare Workers (memakai wrangler.json hasil build di dist/server/wrangler.json)
npx wrangler deploy --config dist/server/wrangler.json

# 3. Set secret SESSION_SECRET secara aman tanpa mencetak ke terminal
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" | npx wrangler secret put SESSION_SECRET --config dist/server/wrangler.json
```

> **Catatan Produksi Terpisah**: Jika kelak men-deploy environment produksi non-demo, buat database D1 baru terpisah (`wrangler d1 create umkm-accounting-prod-db`), set `"APP_DEMO_MODE": "false"`, dan jangan arahkan binding produksi ke `umkm-accounting-demo-db`.

---

## 4. Backup & Restore D1 Remote

### Backup Snapshot
```bash
npx wrangler d1 export umkm-accounting-demo-db --remote --output ./backups/demo-d1-snapshot.sql
```

### Verifikasi / Restore Lokal
File `.sql` hasil `wrangler d1 export` dapat diverifikasi integritasnya menggunakan SQLite lokal (atau direstore ke database D1 baru yang kosong dengan `npx wrangler d1 execute <NEW_DB_NAME> --remote --file=./backups/demo-d1-snapshot.sql` — tanpa menimpa database aktif secara destruktif).
