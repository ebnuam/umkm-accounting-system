# Laporan Audit & Hardening — PHASE 4.5 (Final Verification Before Phase 5)

- **Branch**: `phase-2-accounting-core` (branch `main` tidak diubah)
- **Tanggal**: 2026-11-27

---

## 1. Temuan Audit (Berdasarkan Pemeriksaan Implementasi Aktual)

### A. Security Audit
1. **[CRITICAL — FIXED] Header `oai-authenticated-user-email` Dapat Dipalsukan (Spoofing)** (`app/request-session.ts`):
   - Sebelumnya `resolveVerifiedSession()` mempercayai header HTTP mentah `oai-authenticated-user-email` tanpa verifikasi kriptografis atau shared proxy secret. Pada deployment publik langsung ke Cloudflare Workers, penyerang bisa mengirim header tersebut untuk membajak tenant korban.
2. **[CRITICAL — FIXED] `DEV_FALLBACK_SECRET` Dapat Terpakai Diam-Diam di Host Publik** (`app/request-session.ts`):
   - Sebelumnya `resolveSessionSecret()` hanya melempar error jika `REQUIRE_SESSION_SECRET === "true"`. Jika `SESSION_SECRET` lupa disetel di host produksi, cookie bisa ditandatangani dengan string fallback terbuka di repo.
3. **[HIGH — FIXED] Token Sesi Tidak Memiliki Expiration (`exp`) & Celah CSRF Edge Cases** (`app/request-session.ts`):
   - Token cookie sebelumnya hanya `<tenantId>.<hmac>` tanpa batas masa berlaku server-side; `verifySameOriginRequest()` belum menolak `Origin: null`, `Sec-Fetch-Site: cross-site`, maupun `Referer` lintas-origin; serta belum ada endpoint logout untuk membersihkan cookie sesi.
4. **[HIGH — FIXED] Endpoint Export (`/api/export/xlsx`, `/api/export/pdf`) Menerima Angka Mentah dari Klien & Rentan Formula Injection / Silent Truncation**:
   - Sebelumnya klien mengirim JSON `sheets`/`sections` ke server sehingga angka laporan ekspor tidak diverifikasi terhadap buku besar server, sel spreadsheet rentan formula injection (`=`, `+`, `-`, `@`), dan PDF terpotong diam-diam pada baris ke-48.
5. **[MEDIUM — FIXED] Parsing JSON Body Tanpa Batas Ukuran & Error Handling** (`app/api/accounting/_handler.ts`):
   - JSON malformed menyebabkan `500` alih-alih `400`, dan belum ada batas ukuran request body (`64 KB`).
6. **[HIGH — UNRESOLVED / ARSITEKTUR BELUM DIBANGUN] Belum Ada Registrasi Akun, Login Password/OAuth, Multi-User Business Membership (RBAC), dan Tabel Pencabutan Sesi Server-Side**:
   - Saat ini otentikasi berbasis **sesi tenant anonim bertanda tangan HMAC** (atau email terverifikasi gateway via `TRUST_AUTH_PROXY_SECRET`). Belum ada tabel `users`, `user_sessions` (pencabutan per token/jti), maupun `business_memberships` untuk banyak pengguna dalam satu bisnis.

### B. Data Consistency & Concurrency Audit
1. **[CRITICAL — FIXED] Race Condition / Lost Update pada Stok (`items`), Faktur (`invoices`), dan Double-Void (`journal_entries`)**:
   - Sebelumnya `commitPosting()` menulis angka absolut hasil pembacaan awal (`SET quantity_on_hand = ...`) tanpa pemeriksaan state sebelumnya. Dua permintaan bersamaan dapat menyebabkan stok negatif, pelunasan faktur melebihi saldo tagihan, atau pembatalan (void) ganda.
2. **[HIGH — FIXED] Fallback Non-Batch Tanpa Transaksi SQLite** (`db/d1-repository.ts`):
   - Jika `db.batch` tidak tersedia (driver non-D1), loop sequential sebelumnya tidak dibungkus `db.transaction`, sehingga kegagalan di tengah berpotensi meninggalkan data parsial.

### C. Accounting Edge-Case Audit
1. **[MEDIUM — UNRESOLVED / MEMBUTUHKAN KONFIRMASI KEBIJAKAN] Retur Pembelian & Retur Penjualan Parsial Belum Terimplementasi**:
   - Pembatalan penuh (100% transaksi) sudah didukung aman melalui `voidJournalEntry()`. Namun **retur parsial** (mis. mengembalikan 2 dari 10 barang rusak setelah ada pembelian baru dengan harga berbeda, atau mengembalikan 2 dari 5 barang terjual dengan sebagian piutang sudah dibayar) **belum ada** dan membutuhkan konfirmasi kebijakan akuntansi sebelum diimplementasikan (lihat Bagian 4).
2. **[LOW — VERIFIED] Pembulatan Moving Average & Sisa Nilai Rupiah**:
   - Terverifikasi aman: saat kuantitas mencapai `0`, HPP mengambil seluruh sisa `totalInventoryValue` sehingga tidak ada residu pembulatan Rupiah.

### D. Technical Quality Audit
1. **`npm audit` (35 total; 9 pada production dependencies `--omit=dev`)**:
   - `next` (`16.2.6`, 1 critical + high), `sharp` (high), `postcss` (high): berdampak rendah/tidak terpakai langsung di runtime Worker karena aplikasi berjalan melalui `vinext` (`0.0.50`) + `IMAGES` binding tanpa Server Actions / Next Node server; tetap perlu dipantau untuk upgrade terkoordinasi dengan `vinext`.
   - `fflate` (`0.7.4`, moderate): Advisory terkait `unzipSync` (ZIP64 loop); aplikasi hanya memakai `zipSync` (kompresi), bukan `unzipSync`.
   - `zod` (`3.25.76`, high), `fast-uri`, `nanoid`, `source-map-js`, `baseline-browser-mapping`: belum digunakan pada alur validasi inti `core/` (yang memakai validator deterministik TypeScript sendiri) atau bersifat dependensi transitif build.
2. **[LOW — FIXED] TypeScript Cloudflare Types**:
   - Sebelumnya `tsc --noEmit` gagal dengan 3 error (`cloudflare:workers`, `Fetcher`, `D1Database`).

---

## 2. Perbaikan yang Dilakukan pada PHASE 4.5

1. **Hardening Keamanan Sesi & Proxy** ([request-session.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/app/request-session.ts), [logout/route.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/app/api/accounting/logout/route.ts)):
   - Format token menjadi `<tenantId>.<expiresAtMs>.<hmac>` dengan validasi masa berlaku (`DEFAULT_SESSION_TTL_DAYS = 7`).
   - Penolakan `oai-authenticated-user-email` jika `x-auth-proxy-secret` tidak cocok dengan `TRUST_AUTH_PROXY_SECRET` (constant-time compare).
   - Kewajiban `SESSION_SECRET` (>= 16 karakter) pada seluruh host non-localhost; fallback dev hanya diizinkan pada `localhost`/`127.0.0.1` non-production.
   - Penolakan `Origin: null`, `Sec-Fetch-Site: cross-site`, dan `Referer` lintas-origin (`401`).
   - Penambahan endpoint `POST /api/accounting/logout` dan pembatasan JSON body `<= 64 KB` pada [_handler.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/app/api/accounting/_handler.ts).
2. **Hardening Konsistensi Data & Concurrency** ([0002_phase45_hardening_constraints.sql](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/drizzle/0002_phase45_hardening_constraints.sql), [d1-repository.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/db/d1-repository.ts), [in-memory-repository.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/core/in-memory-repository.ts), [engine.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/core/engine.ts)):
   - Menambahkan SQLite `UNIQUE INDEX journal_entries_reverses_unique_idx` serta trigger SQLite `trg_items_no_negative_stock_update`, `trg_invoices_no_overpayment_update`, dan `trg_periods_no_double_close_update`.
   - Mengubah update stok & saldo faktur di `commitPosting()` menjadi **relative delta updates** + `ConcurrencyError` (`409`) serta membungkus non-batch fallback dalam `db.transaction()`.
3. **Hardening Export & TypeScript** ([_export.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/app/api/accounting/_export.ts), [xlsx/route.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/app/api/export/xlsx/route.ts), [pdf/route.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/app/api/export/pdf/route.ts), [app.js](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/public/app.js), [cloudflare-env.d.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/cloudflare-env.d.ts)):
   - Export XLSX dan PDF kini dihitung langsung di server dari `AccountingEngine` (mencegah manipulasi angka dari klien), menetralkan formula injection (`'`), dan menambahkan paginasi multi-halaman pada PDF.
   - Menambahkan [cloudflare-env.d.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/cloudflare-env.d.ts) sehingga `tsc --noEmit` bersih (`0` error).
   - Menambahkan dokumentasi prosedur backup & restore D1 di [backup-restore.md](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/docs/backup-restore.md).

---

## 3. Pengujian Baru & Hasil Verifikasi

### Suite Pengujian (`node --test tests/*.test.mjs`) — **18/18 Pass (`0` fail)**
- [accounting-edge-cases.test.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/tests/accounting-edge-cases.test.mjs) (`4/4` pass):
  1. Pembulatan Moving Average (`10.000 / 3` -> `3.333`, `3.334`, `3.333`) tepat `10.000` dengan sisa nilai `0`.
  2. Pembatalan penuh pembelian & penjualan via void/reversal, pembayaran parsial + pelunasan + blokir overpayment, penyesuaian penyusutan & akrual, penutupan rugi neto ke Laba Ditahan, penutupan periode berulang ditolak (`ClosedPeriodError`), dan carry-forward neraca ke bulan berikutnya.
  3. Injeksi kegagalan di tengah batch SQLite (`SIMULATED_MID_BATCH_FAILURE` pada `audit_logs`) menghasilkan **0 perubahan parsial** pada jurnal, stok, maupun mutasi.
  4. **Full Manual Smoke Test End-to-End** di atas SQLite relasional termigrasi (sesi baru → profil → saldo awal bahan baku → modal → pembelian kredit → produksi sederhana → penjualan kredit → penerimaan piutang sebagian → pembayaran utang sebagian → stock opname negatif → beban akrual → verifikasi XLSX/PDF → tutup periode → buka periode berikutnya dengan neraca tepat `Rp5.744.000` seimbang).
- [multi-tenant-security.test.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/tests/multi-tenant-security.test.mjs) (`5/5` pass):
  - Token kedaluwarsa ditolak, `SESSION_SECRET` wajib di host publik, spoofing `oai-authenticated-user-email` tanpa `x-auth-proxy-secret` ditolak `401`, `Origin: null` ditolak `401`, logout menghapus cookie, **concurrency test paralel** (`Promise.all` penjualan melebihi stok, pembayaran melebihi tagihan, dan double-void) terbukti aman, serta sanitasi XLSX formula injection & PDF paginasi multi-halaman teruji.
- [accounting-core.test.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/tests/accounting-core.test.mjs) (`6/6` pass) & [accounting-app.test.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/tests/accounting-app.test.mjs) (`3/3` pass).

### Pemeriksaan Teknis Lainnya
- **ESLint** (`./node_modules/.bin/eslint.cmd core db app public/app.js`): Exit code `0` (`0` errors, `0` warnings).
- **TypeScript** (`./node_modules/.bin/tsc.cmd --noEmit --incremental false`): Exit code `0` (`0` errors).
- **Production Build** (`./node_modules/.bin/vinext.cmd build`): Exit code `0` (seluruh 5 stage `rsc`/`client`/`ssr` dan 12 routes berhasil dibangun).

---

## 4. Temuan yang Belum Terselesaikan & Tingkat Risiko

| No | Temuan | Risiko | Rekomendasi / Keputusan yang Dibutuhkan |
| --- | --- | --- | --- |
| 1 | Belum ada registrasi akun, login password/OAuth, tabel `users`/`memberships`, dan tabel pencabutan sesi (`revoked_sessions` / session version) di server. | **HIGH (untuk public multi-user SaaS)** | Putuskan apakah hosted public memakai Auth (OAuth/Email+Password) sebelum dibuka ke publik; sesi anonim cookie saat ini aman per browser namun hilang jika cookie terhapus dan tidak bisa dicabut per perangkat sebelum TTL 7 hari habis. |
| 2 | **Retur Pembelian & Retur Penjualan Parsial** belum tersedia (baru tersedia pembatalan penuh via void/reversal). | **MEDIUM (fungsionalitas UMKM)** | Konfirmasi kebijakan akuntansi sebelum implementasi: (a) retur penjualan dicatat ke akun kontra `4102 Retur Penjualan` atau langsung mengurangi `4101`, (b) nilai persediaan masuk kembali berdasarkan HPP faktur asal atau moving average berjalan, (c) perlakuan retur pembelian ketika harga moving average telah berubah. |
| 3 | Vulnerability pada `package.json` (`next@16.2.6`, `zod@3.25.76`, `fflate@0.7.4`). | **LOW–MEDIUM** | Rencanakan pembaruan dependensi terkoordinasi (terutama `next` & `fflate` setelah memverifikasi kompatibilitas `vinext`). |
| 4 | Penerapan `drizzle/0002_phase45_hardening_constraints.sql` belum dieksekusi ke D1 remote production (hanya diuji pada SQLite lokal termigrasi). | **MEDIUM (operasional)** | Terapkan seluruh migrasi (`0000`–`0002`) ke D1 sebelum deployment. |

---

## 5. Penilaian Kelayakan Masuk PHASE 5

- **Status Kelayakan untuk PHASE 5 (Self-Hosted Local SQLite Adapter)**: **LAYAK DILANJUTKAN**, dengan catatan:
  - Accounting core, isolasi multi-tenant, atomisitas `commitPosting`, konsistensi moving average, double-entry, dan migrasi relasional (`0000`–`0002`) telah stabil dan teruji 100% (`18/18` test pass, `tsc` 0 error, `eslint` 0 error, `vinext build` sukses).
  - Untuk **mode self-hosted (`LocalSqliteRepository`)**, tidak ada blocker arsitektural — kontrak `AccountingRepository` siap diimplementasikan di Phase 5 menggunakan driver SQLite lokal dengan skema & trigger yang identik.
  - Namun untuk **pembukaan hosted public multi-tenant**, **temuan #1 (Auth User/RBAC & Server-Side Session Revocation)** wajib diselesaikan terlebih dahulu sebelum membuka aplikasi hosted ke publik secara luas.
