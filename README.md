# UMKM Accounting System (NeracaKita)

Aplikasi pembukuan dan akuntansi **double-entry** multi-sektor (**Dagang**, **Jasa**, dan **Produksi Ringan**) untuk UMKM dengan *accounting core* TypeScript yang terisolasi dari framework web dan mendukung dua runtime database: **Cloudflare Workers + D1** serta **Node.js + Local SQLite**.

> **Status: In Development**  
> Proyek ini masih dalam tahap pengembangan untuk pembelajaran dan portofolio. Seluruh data usaha contoh (**Aneka Snack**) bersifat simulasi, dan aplikasi ini belum diaudit sebagai sistem akuntansi produksi atau pelaporan pajak resmi.

---

## Live Demo

- **URL Demo**: https://umkm-accounting-demo.ebnunih.workers.dev
- Menggunakan dataset simulasi **Aneka Snack** dengan **sandbox terisolasi per pengunjung** serta uji pergantian peran **Owner** vs **Staff**.
- Lihat [docs/demo-guide.md](docs/demo-guide.md) untuk panduan skenario uji coba.

---

## Kemampuan Utama

- **Double-Entry & Kontrol Subledger**: Setiap transaksi membentuk jurnal Debit = Kredit tervalidasi; akun kontrol (`1103`, `2101`, `1104`–`1106`) dilindungi dari posting manual Jurnal Umum agar sinkron dengan subledger.
- **Daftar Akun (43 Akun Bawaan + Custom COA)**: Dirancang untuk pencatatan UMKM dengan mempertimbangkan prinsip SAK EMKM, memisahkan tegas **Akun Riil** (saldo berlanjut antarperiode) dan **Akun Nominal** (ditutup saat tutup buku), serta pembuatan akun kustom khusus **Owner**.
- **Persediaan Perpetual Moving Average**: Memisahkan **Bahan Baku (`1104`)**, **Barang Dalam Proses / WIP (`1106`)**, dan **Barang Jadi (`1105`)** dengan pencegah stok negatif, pembersihan residu pembulatan saat stok `0`, dan **Stock Opname (`+/-`)**.
- **Produksi Ringan & Jasa**: Input pemakaian beberapa bahan baku/WIP per batch produksi dengan kapitalisasi **BTKL** dan **BOP**, serta layanan jasa non-stok (`4102` / `5108`).
- **Piutang & Utang Terhubung ke Faktur**: Pembayaran parsial maupun lunas, validasi pihak, serta pencegahan *overpayment*.
- **Void / Reversal & Audit Trail**: Tidak menyediakan hapus jurnal (`DELETE`); pembatalan pada periode terbuka menerbitkan jurnal pembalik beserta pengembalian stok/faktur secara atomik dan tercatat di `audit_logs`.
- **Laporan & Ekspor**: Buku Besar per akun, Neraca Saldo (Sebelum & Setelah Penyesuaian), Laba Rugi, Perubahan Modal, Posisi Keuangan (Neraca), Ikhtisar Kas & Tagihan, serta ekspor server-side **PDF** dan **XLSX**.
- **Autentikasi Multi-Tenant & RBAC**: Password hashing PBKDF2-SHA256, sesi database dengan rotasi token, proteksi same-origin/CSRF, rate limit login, keanggotaan multi-bisnis, dan peran **Owner** vs **Staff**.

---

## Arsitektur Sistem

```text
app/, public/app.js          UI (Vinext / React) & API Routes (/api/accounting/*, /api/auth/*, /api/export/*)
        ↓ memanggil
core/                        Accounting Core & Auth Service (Pure TypeScript, zero framework/ORM coupling)
        ↓ bergantung pada interface
core/repository.ts           AccountingRepository & AuthRepository
   ├── db/d1-repository.ts           Cloudflare Workers + Cloudflare D1 (Hosted)
   └── db/local-sqlite-repository.ts Node.js node:sqlite WAL mode (Self-Hosted)
```

---

## Menjalankan Secara Lokal (Self-Hosted SQLite)

Prasyarat: **Node.js `>= 22.13.0`** (direkomendasikan Node.js 24+).

```bash
npm install
cp .env.example .env
# Isi DB_ADAPTER=sqlite dan SESSION_SECRET acak minimal 32 karakter pada .env

npm run db:migrate:local
npm run auth:bootstrap-owner -- --email owner@umkm.local --name "Pemilik Usaha" --business "UMKM Makmur"

npm run build:selfhosted
npm run start:selfhosted
```

Panduan lengkap instalasi, konfigurasi environment, dan backup/restore SQLite tersedia pada [docs/self-hosting.md](docs/self-hosting.md).

---

## Pengujian

```bash
node --test tests/*.test.mjs
```

Suite pengujian mencakup unit test accounting core, edge cases pembulatan & concurrency, multi-sektor (Dagang/Jasa/Manufaktur), contract test kesetaraan D1 vs Local SQLite, isolasi multi-tenant, RBAC Owner/Staff, ekspor PDF/XLSX, serta sandbox demo.

---

## Keterbatasan Saat Ini

- Belum tersedia **Laporan Arus Kas** tersendiri.
- Modul produksi bersifat input bahan per batch (belum memiliki *Bill of Materials* / master resep tersimpan permanen per produk).
- Pembatalan transaksi persediaan dilakukan melalui *Void / Reversal* satu dokumen penuh (belum berupa retur parsial per baris).
- Belum tersedia *Fixed Asset Register* otomatis maupun rekonsiliasi mutasi rekening koran.
- Belum tersedia verifikasi email dan pemulihan kata sandi mandiri.

---

## Dokumentasi

- [docs/accounting-policy.md](docs/accounting-policy.md) — Kebijakan & perlakuan akuntansi
- [docs/architecture.md](docs/architecture.md) — Pemisahan layer & repository abstraction
- [docs/authentication.md](docs/authentication.md) — Autentikasi, sesi, keanggotaan bisnis & RBAC
- [docs/self-hosting.md](docs/self-hosting.md) — Instalasi self-hosted dengan SQLite lokal
- [docs/deployment-cloudflare.md](docs/deployment-cloudflare.md) — Deployment Cloudflare Workers & D1
- [docs/demo-guide.md](docs/demo-guide.md) — Panduan penggunaan live demo publik
