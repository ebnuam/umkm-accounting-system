# Keamanan Multi-Tenant & Checklist Pra-Publik

Dokumen ini menjelaskan kontrol keamanan yang diterapkan sebelum aplikasi hosted Cloudflare D1 dibuka untuk publik.

## 1. Otentikasi Sesi & Pencegahan Pembajakan Tenant
- **Signed Session Cookie (`umkm_session`)**: Cookie berisi `<tenantId>.<base64url(HMAC-SHA256(tenantId, SESSION_SECRET))>` menggunakan Web Crypto API (`crypto.subtle`).
- Cookie lama tanpa tanda tangan (`umkm_session_id`) diabaikan dan dibersihkan (`Max-Age=0`) sehingga penyerang tidak dapat menukar UUID di cookie untuk membaca atau menimpa data tenant lain.
- Jika token cookie dimodifikasi (tanda tangan tidak cocok), API mengembalikan `401 Unauthorized` (`INVALID_SESSION`).
- Mode terautentikasi via header `oai-authenticated-user-email` memetakan email terverifikasi ke `tenantId` secara deterministik melalui HMAC-SHA256.

## 2. Isolasi Data Multi-Tenant di Backend & Database
- `tenantId` tidak pernah diterima dari request body atau query parameter; seluruh handler mengambil `tenantId` hanya dari sesi terverifikasi di server.
- Seluruh tabel relasional (`accounts`, `parties`, `items`, `journal_entries`, `journal_lines`, `inventory_movements`, `invoices`, `invoice_payments`, `accounting_periods`, `audit_logs`) memiliki kolom `tenant_id` terindeks.
- Setiap query `SELECT`, `UPDATE`, dan `DELETE` di `DrizzleSqliteAccountingRepository` menyertakan filter `tenant_id = :tenantId`.
- Upaya mengakses/memodifikasi ID milik tenant lain (mis. melunasi faktur atau membatalkan jurnal milik tenant lain) ditolak dengan `404 Not Found` tanpa mengubah data tenant korban.

## 3. Proteksi Integritas Akuntansi & CSRF
- `PUT /api/state` (penyimpanan JSON mentah dari klien) dinonaktifkan (`410 Gone`). Seluruh mutasi wajib melalui `/api/accounting/*` dan divalidasi oleh `AccountingEngine` di backend.
- Mutasi `POST` memeriksa header `Origin` terhadap `Host` (`verifySameOriginRequest`) untuk mencegah CSRF lintas situs.

## 4. Checklist Sebelum Dibuka untuk Publik
1. Konfigurasikan secret produksi di Cloudflare Workers:
   ```bash
   wrangler secret put SESSION_SECRET
   ```
   Gunakan string acak minimal 32 byte dan set `REQUIRE_SESSION_SECRET="true"`.
2. Terapkan migrasi D1 terbaru (`drizzle/0000_stiff_mad_thinker.sql` dan `drizzle/0001_phase3_relational_core.sql`).
3. Jalankan `node --test tests/multi-tenant-security.test.mjs` dan pastikan seluruh test isolasi lolos.
