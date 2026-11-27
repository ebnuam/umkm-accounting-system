# Phase 7 Report — Cloudflare Deployment & Public Live Demo

**Branch**: `phase-2-accounting-core` (branch `main` tidak diubah)  
**Tanggal Verifikasi**: 2026-11-27  
**URL Live Demo**: `https://umkm-accounting-demo.ebnunih.workers.dev`

---

## 1. Environment & Resource Cloudflare yang Dibuat

Seluruh resource demo dibuat terpisah khusus untuk live demo pada akun `Ebnunih@proton.me's Account` (`ef9a94d2093561fca84be6a40f1feaf3`), dengan 0 database D1 lama yang disentuh:

| Resource | Nama / Identifier | Keterangan |
| --- | --- | --- |
| Worker Demo | `umkm-accounting-demo` | Domain `https://umkm-accounting-demo.ebnunih.workers.dev` (`Version ID: d961256d-bd3b-4143-a2b6-ebdd88982b9d`, startup `13 ms`) |
| D1 Database Demo | `umkm-accounting-demo-db` | `database_id`: `786d846e-cda3-4426-901d-3114b41c936e` (region `APAC`) |
| Binding | `DB` | Terikat ke `umkm-accounting-demo-db` via [`config/wrangler.demo.jsonc`](file:///config/wrangler.demo.jsonc) |
| Environment Variables | `APP_DEMO_MODE="true"`, `DISABLE_PUBLIC_SIGNUP="false"` | Hanya aktif pada demo Worker |
| Secret | `SESSION_SECRET` | 48-byte random secret diunggah via `wrangler secret put` (tidak pernah disimpan di repo) |

---

## 2. Temuan Pre-Deployment Audit & Perbaikan Teknis

1. **Batas 100 SQL Bind Parameter Cloudflare D1**: D1 menolak multi-row `INSERT` dengan >100 bind parameter (`DEFAULT_ACCOUNTS` berisi 23 akun × 9 kolom = 207 parameter). [`db/d1-repository.ts`](file:///db/d1-repository.ts) kini membagi batch insert secara otomatis via `pushChunked` (`<= 80` parameter per query).
2. **Eksklusi `node:sqlite` dari Bundle Cloudflare Workers**: [`vite.config.ts`](file:///vite.config.ts) memakai plugin `exclude-local-sqlite-for-workers` (`enforce: "pre"`) untuk mengarahkan `node:sqlite` dan `db/local-sqlite-repository.ts` ke [`db/local-sqlite-stub.ts`](file:///db/local-sqlite-stub.ts) pada build D1, sementara build self-hosted (`DB_ADAPTER=sqlite`) tetap berjalan normal.
3. **Konfigurasi Wrangler Terpisah**: Konfigurasi demo diletakkan di [`config/wrangler.demo.jsonc`](file:///config/wrangler.demo.jsonc) agar tidak mengganggu `npm run build:selfhosted`.
4. **Pembersihan Legacy Header Auth**: `app/chatgpt-auth.ts` dihapus karena tidak lagi digunakan setelah Phase 6.
5. **Runtime Env Helper**: [`db/index.ts`](file:///db/index.ts) menyediakan `getRuntimeVar` / `getRuntimeFlag` untuk membaca `env.*` di Cloudflare Workers maupun `process.env.*` di Node.

---

## 3. Desain Data & Akses Demo ("Aneka Snack")

- **Dataset Simulasi**: [`core/sample-data.ts`](file:///core/sample-data.ts) (`seedAnekaSnackDemoWorkspace`) mengisi usaha **"Aneka Snack"** (`Yogyakarta`, periode `2026-09`) lengkap dengan COA, bahan baku (*Singkong Kupas*, *Minyak & Bumbu Balado*, *Kemasan Standing Pouch*) dan barang jadi (*Keripik Singkong Balado*, *Makaroni Pedas Renyah*), saldo awal persediaan, modal awal & peralatan, pembelian kredit/tunai, produksi sederhana, penjualan tunai/kredit, piutang & utang usaha terbuka, biaya operasional, penyusutan, dan laporan keuangan seimbang (`Pendapatan: Rp1.350.000`, `Laba Bersih: Rp465.555`, `Total Aset: Rp11.415.555`).
- **Arsitektur Keamanan Akses**: Menggunakan **Sandbox Demo Terisolasi per Pengunjung** (`POST /api/auth/demo-start`), bukan akun bersama (*shared tenant*). Setiap pengunjung mendapat tenant `demo-<uuid>` sendiri, cookie sesi DB `HttpOnly; Secure; SameSite=Lax`, pasangan akun acak Owner & Staff khusus sandbox tersebut, serta tombol uji ganti peran (`POST /api/auth/demo-switch-role`) yang hanya berlaku di dalam sandbox `demo-` miliknya dengan rotasi token langsung dan pencabutan token sebelumnya.

---

## 4. Hasil Migrasi D1 Remote & Verifikasi

### A. Migrasi D1 Remote (`umkm-accounting-demo-db`)
Dijalankan dengan `npx wrangler d1 migrations apply umkm-accounting-demo-db --remote`:
- `0000_stiff_mad_thinker.sql` — ✅
- `0001_phase3_relational_core.sql` — ✅
- `0002_phase45_hardening_constraints.sql` — ✅
- `0003_phase6_auth_membership.sql` — ✅

### B. Automated Tests, Lint, TypeScript & Builds
| Pemeriksaan | Perintah | Hasil |
| --- | --- | --- |
| Automated Test Suite | `node --test tests/*.test.mjs` | **23/23 lulus** (termasuk test baru demo sandbox terisolasi, RBAC Owner/Staff, dan nonaktifnya endpoint demo saat `APP_DEMO_MODE=false`) |
| ESLint | `.\node_modules\.bin\eslint.cmd core db app scripts public/app.js` | **Lulus** (0 error, 0 warning) |
| TypeScript | `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | **Lulus** (0 error) |
| Build Self-Hosted (SQLite) | `node scripts/selfhosted-cli.mjs build` | **Lulus** (23 route, 290 modul) |
| Build Hosted (Cloudflare D1) | `.\node_modules\.bin\vinext.cmd build` | **Lulus** (23 route, `config/wrangler.demo.jsonc`) |

### C. Verifikasi End-to-End Terhadap URL Live (`https://umkm-accounting-demo.ebnunih.workers.dev`)
Diverifikasi melalui HTTP request nyata terhadap Worker live (`LIVE_CLOUDFLARE_DEMO_VERIFIED`):
- `GET /`, `GET /app.js`, dan `GET /api/auth/session` (`demoMode: true`, `authenticated: false`) mengembalikan `200`.
- Akses tanpa cookie dan cookie palsu ke `/api/accounting/workspace` ditolak `401`.
- `POST /api/auth/demo-start` mengembalikan `201`, cookie `HttpOnly; SameSite=Lax; Secure`, tenant `demo-...`, dan laporan **Aneka Snack** `isBalanced: true`.
- Mutasi pembelian tunai & penjualan tunai live (`201`) memperbarui kuantitas stok, Moving Average, HPP, dan menjaga keseimbangan neraca di D1 remote.
- Export live `/api/export/pdf` (`%PDF-1.4`) dan `/api/export/xlsx` (`PK` OpenXML) mengembalikan `200`.
- Perpindahan ke **Staff** (`POST /api/auth/demo-switch-role`) mengembalikan `200`, langsung mencabut cookie Owner lama (`401`), menyembunyikan `auditLogs` (`[]`), serta memblokir (`403`) akses ke `periods/close`, `reset`, dan `members`.
- Kembali ke **Owner** lalu `POST /api/accounting/reset` mengembalikan data awal `"Aneka Snack"` secara utuh.
- Pengunjung kedua (`Visitor B`) mendapat tenant berbeda dan ditolak (`403` / `404`) saat mencoba berpindah atau memodifikasi item milik `Visitor A`.
- Login salah mengembalikan pesan generik `401 "Email atau kata sandi salah."`, dan `POST /api/auth/logout` mencabut sesi aktif di D1 (`401` setelah logout).

### D. Verifikasi Backup & Restore D1 Remote
- `npx wrangler d1 export umkm-accounting-demo-db --remote` menghasilkan dump SQL valid (`233.118 byte`).
- Pemulihan dump SQL ke SQLite lokal terisolasi berhasil melewati `PRAGMA integrity_check === "ok"` (`3` tenant, `51` entri jurnal terverifikasi).

---

## 5. Biaya, Dokumentasi & Keterbatasan Tersisa

- **Potensi Biaya Cloudflare**: Worker demo dideploy ke `*.workers.dev` dengan binding **D1 saja** (`r2_buckets` kosong, `observability.enabled: false`, tanpa Durable Objects/Queues/Images), sehingga berjalan pada **kuota Free tier Workers & D1** ($0/bulan selama di bawah batas harian/bulanan Cloudflare Free plan: 100.000 request Workers/hari, 5 juta rows read/hari & 100.000 rows written/hari pada D1; bila trafik pembaca artikel melampaui kuota gratis atau akun menggunakan paket Workers Paid, biaya sesuai tarif usage-based Cloudflare berlaku).
- **Keterbatasan yang Masih Ada**:
  1. Sandbox `demo-*` yang dibuat pengunjung tidak memiliki *cron* pembersihan otomatis di D1 (perlu dibersihkan berkala secara manual atau menambah Scheduled Worker jika trafik demo publik sangat tinggi).
  2. Verifikasi email / reset kata sandi mandiri belum tersedia (registrasi standar aktif langsung).
  3. Pengujian rate limiting IP memakai `cf-connecting-ip` di Cloudflare Workers edge; jika di-deploy di balik proxy pihak ketiga tambahan pada self-hosted, pastikan proxy menimpa header IP secara aman.
- **Dokumentasi**: [`docs/deployment-cloudflare.md`](file:///docs/deployment-cloudflare.md), [`docs/demo-guide.md`](file:///docs/demo-guide.md).
