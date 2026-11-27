# Laporan Hasil Pekerjaan — PHASE 3 (Cloudflare D1 Relational Schema, Multi-Tenant API & Security)

- **Branch**: `phase-2-accounting-core`
- **Status**: Selesai & Lulus Pengujian (`3/3` test isolasi & keamanan multi-tenant pass di atas SQLite relasional nyata)

## 1. Ringkasan Implementasi

1. **Skema Relasional & Migrasi D1 (`db/schema.ts`, `drizzle/0001_phase3_relational_core.sql`)**:
   - Menambahkan tabel relasional terindeks per `tenant_id`: `tenants`, `accounts`, `parties`, `items`, `journal_entries`, `journal_lines`, `inventory_movements`, `invoices`, `invoice_payments`, `accounting_periods`, dan `audit_logs`.
   - Mempertahankan tabel lama `accounting_states` untuk kompatibilitas mundur migrasi.

2. **D1 / SQLite Repository Adapter (`db/d1-repository.ts`, `db/index.ts`)**:
   - `DrizzleSqliteAccountingRepository` mengimplementasikan kontrak `AccountingRepository` dengan filter `tenant_id` pada setiap query dan eksekusi atomik menggunakan `db.batch(...)` pada Cloudflare D1.
   - `db/index.ts` menyediakan `getD1Repository()` dengan bootstrap DDL idempoten dan `getRuntimeSessionSecret()`.

3. **Keamanan Multi-Tenant & API Backend (`app/request-session.ts`, `app/api/accounting/**`)**:
   - Cookie sesi ditandatangani secara kriptografis menggunakan HMAC-SHA256 (`umkm_session=<tenantId>.<sig>`) melalui Web Crypto API; cookie tanpa tanda tangan lama ditolak/dihapus dan cookie yang dimodifikasi menghasilkan `401 Unauthorized`.
   - Validasi CSRF `Origin` vs `Host` pada endpoint mutasi `POST`.
   - Endpoint backend tervalidasi penuh oleh `AccountingEngine`:
     - `GET /api/accounting/workspace`
     - `POST /api/accounting/transactions`
     - `POST /api/accounting/opname`
     - `POST /api/accounting/adjustments`
     - `POST /api/accounting/entries/[id]/void`
     - `POST /api/accounting/periods/close`
     - `POST /api/accounting/master`
     - `POST /api/accounting/reset`
   - `PUT /api/state` dinonaktifkan (`410 Gone`) agar klien tidak dapat mem-bypass validasi double-entry.
   - `/api/export/xlsx` dan `/api/export/pdf` diamankan dengan verifikasi sesi & same-origin.
   - Dokumentasi keamanan dan checklist pra-publik disimpan di `docs/security.md`.

## 2. Hasil Pengujian PHASE 3

Perintah: `node --test tests/multi-tenant-security.test.mjs`
- `tests 3 | pass 3 | fail 0` (menggunakan `node:sqlite` + migrasi SQL Drizzle `0000` & `0001`):
  1. Verifikasi penandatanganan HMAC cookie sesi dan penolakan token yang dimodifikasi.
  2. Isolasi penuh multi-tenant (penolakan cookie palsu `401`, penolakan cookie legacy tanpa tanda tangan, penolakan CSRF cross-origin `401`, penolakan bayar faktur lintas tenant `404`, penolakan void/opname/toggle barang lintas tenant `404`, penolakan pelunasan melebihi saldo tagihan `409`, dan isolasi tutup periode & reset per tenant).
  3. Isolasi deterministik pengguna terautentikasi via header `oai-authenticated-user-email`.
