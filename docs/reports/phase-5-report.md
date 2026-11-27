# Laporan Hasil Pekerjaan — PHASE 5 (Self-Hosted Local SQLite Adapter)

- **Branch**: `phase-2-accounting-core` (branch `main` tidak diubah)
- **Status**: Selesai & Lulus Pengujian (`20/20` automated tests, live HTTP self-hosted server E2E, `eslint` 0 error, `tsc` 0 error, serta kedua build `build:selfhosted` dan `vinext build` sukses)

---

## 1. Arsitektur Adapter & Zero Code Duplication

```text
  AccountingEngine (core/engine.ts)
          │
          ▼  (bergantung hanya pada interface)
  AccountingRepository (core/repository.ts)
          │
          ▼  (dipilih via env DB_ADAPTER di db/index.ts)
    ┌─────┴────────────────────────────────────────┐
    │                                              │
    ▼ DB_ADAPTER=d1 (default hosted)               ▼ DB_ADAPTER=sqlite (self-hosted)
  db/d1-runtime.ts                               db/local-sqlite-repository.ts
  (drizzle-orm/d1 + cloudflare:workers)          (node:sqlite DatabaseSync + drizzle sqlite-proxy)
    │                                              │
    └──────────────► DrizzleSqliteAccountingRepository (db/d1-repository.ts) ◄──────────────┘
                     + Shared DDL & Triggers (db/ddl.ts & drizzle/0000..0002)
```

1. **Zero Duplikasi Query & Logika**:
   - `LocalSqliteAccountingRepository` ([local-sqlite-repository.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/db/local-sqlite-repository.ts)) mewarisi `DrizzleSqliteAccountingRepository` ([d1-repository.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/db/d1-repository.ts)) dan menggunakan `db/ddl.ts` ([ddl.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/db/ddl.ts)) yang sama dengan Cloudflare D1.
   - Operasi tulis menggunakan transaksi atomik `BEGIN IMMEDIATE ... COMMIT / ROLLBACK` serta SQLite `WAL` mode, `busy_timeout = 5000`, `foreign_keys = ON`, dan trigger integritas stok/faktur/periode yang identik dengan D1.
2. **Pemisahan Runtime Cloudflare vs Node.js**:
   - `import { env } from "cloudflare:workers"` diisolasi khusus ke [d1-runtime.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/db/d1-runtime.ts).
   - [db/index.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/db/index.ts) memilih adapter berdasarkan `DB_ADAPTER` (`sqlite` vs `d1`) secara dinamis melalui `getAccountingRepository()`.
   - [vite.config.ts](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/vite.config.ts) melewati `@cloudflare/vite-plugin` saat `DB_ADAPTER=sqlite` dan menargetkan runtime Node.js murni lewat [selfhosted-cli.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/scripts/selfhosted-cli.mjs).

---

## 2. File & Skrip Mode Self-Hosted

- [.env.example](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/.env.example): Template konfigurasi `DB_ADAPTER`, `SQLITE_DB_PATH`, `SESSION_SECRET`, `PORT`, dan `HOST` (tanpa secret pribadi).
- [migrate-local.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/scripts/migrate-local.mjs) (`npm run db:migrate:local`): Menerapkan migrasi `drizzle/0000..0002` secara idempoten ke SQLite lokal dengan tabel pencatat `__local_migrations`.
- [backup-local.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/scripts/backup-local.mjs) (`npm run db:backup:local`): Backup online atomik menggunakan `VACUUM INTO` diikuti verifikasi `PRAGMA integrity_check`.
- [self-hosting.md](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/docs/self-hosting.md): Panduan instalasi dari nol, migrasi, menjalankan server lokal tanpa akun Cloudflare, serta prosedur backup & restore.

---

## 3. Hasil Pengujian PHASE 5

1. **Contract Parity Test (`node --test tests/*.test.mjs`) — `20/20` Pass (`0` fail)**:
   - [repository-contract.test.mjs](file:///C:/Users/USER/Documents/UMKM%20Accounting%20Syclus/tests/repository-contract.test.mjs) (`2/2` pass):
     - Menjalankan skenario penuh yang identik pada `D1AccountingRepository` dan `LocalSqliteAccountingRepository` (pembelian & penjualan, moving average & HPP, stock opname +/-, faktur piutang/utang, pembayaran parsial & pelunasan, overpayment blocked, void/reversal, audit trail, carry-forward antarperiode, penutupan periode, atomisitas kegagalan, isolasi tenant) dan memverifikasi hasil akhir keduanya **sama persis (`assert.deepEqual`)**.
     - Memverifikasi persistensi file SQLite lokal saat koneksi ditutup dan dibuka kembali, serta penolakan `DB_ADAPTER` tidak valid.
2. **Live Self-Hosted Server Verification (Tanpa Akun Cloudflare)**:
   - Menjalankan `node scripts/selfhosted-cli.mjs build` (berhasil, 5 stage & 12 routes).
   - Menjalankan `migrate-local.mjs` dua kali (idempoten: `3 new`, lalu `0 new`).
   - Menjalankan server produksi lokal (`node scripts/selfhosted-cli.mjs start -p 3412 -H 127.0.0.1`), mengirim request HTTP nyata ke `/`, `/api/accounting/workspace`, `/api/accounting/master`, `/api/accounting/transactions`, `/api/export/xlsx`, dan `/api/export/pdf`, menjalankan `backup-local.mjs` (`integrity_check: ok`), lalu me-restart server dan memverifikasi saldo stok (`6` unit / `Rp60.000`) tetap tersimpan persis di file SQLite lokal.
3. **Kualitas Kode & Build**:
   - ESLint (`./node_modules/.bin/eslint.cmd core db app scripts public/app.js`): Exit code `0` (`0` errors, `0` warnings).
   - TypeScript (`./node_modules/.bin/tsc.cmd --noEmit --incremental false`): Exit code `0` (`0` errors).
   - Default Hosted Build (`./node_modules/.bin/vinext.cmd build`): Exit code `0` (kompatibilitas Cloudflare D1 tetap terjaga).

---

## 4. Keterbatasan & Temuan yang Belum Terselesaikan

1. **Prasyarat Node.js `>= 22.13.0` / `24.x`**: `LocalSqliteAccountingRepository` menggunakan modul bawaan `node:sqlite` (`DatabaseSync`) agar bebas dependensi C++ native; lingkungan Node.js di bawah `22.13` tidak didukung (sesuai `engines.node` di `package.json`).
2. **Single-Writer SQLite**: Dalam mode self-hosted SQLite lokal, seluruh proses penulisan berjalan pada satu node/server (`WAL` + `busy_timeout = 5000`); tidak cocok untuk deployment multi-instance horizontal tanpa shared database terpusat.
3. **Temuan Terbuka dari Phase 4.5 (Belum Diubah Sesuai Batasan)**:
   - Sistem registrasi/login user + membership bisnis + pencabutan sesi server-side untuk deployment multi-user publik belum dibangun.
   - Retur pembelian & retur penjualan parsial belum diimplementasikan (masih menunggu konfirmasi kebijakan akuntansi).
   - Pembaruan dependensi `npm audit` (`next`, `fflate`, `zod`) masih ditunda untuk koordinasi kompatibilitas `vinext`.
