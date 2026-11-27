# Laporan Hasil Pekerjaan — PHASE 2 (Accounting Core & Repository Abstraction)

- **Branch**: `phase-2-accounting-core` (branch `main` tidak diubah)
- **Status**: Selesai & Lulus Pengujian (`6/6` test pass)

## 1. Ringkasan Implementasi

1. **Pemisahan Accounting Core (`core/`)**:
   - Seluruh logika akuntansi dibangun dalam TypeScript murni tanpa ketergantungan framework (`next`, `react`, `cloudflare:workers`) maupun ORM/database (`drizzle-orm`).
   - Modul yang dibuat:
     - `core/types.ts`: Domain model lengkap & error terstruktur (`ValidationError`, `InsufficientStockError`, `OverpaymentError`, `ClosedPeriodError`, `NotFoundError`, `ForbiddenError`).
     - `core/coa.ts`: Chart of Accounts standar UMKM (SAK EMKM) dengan pemisahan eksplisit akun riil (`nature: "real"`) vs akun nominal (`nature: "nominal"`), serta pemisahan `1104 Persediaan Bahan Baku` dan `1105 Persediaan Barang Jadi`.
     - `core/period.ts` & `core/validation.ts`: Validasi format tanggal/periode, pembatasan periode tertutup, serta validasi double-entry (minimal 2 baris, nominal bulat positif, tidak mengisi debit & kredit sekaligus, dan `totalDebit === totalCredit`).
     - `core/inventory.ts`: Mesin **Perpetual Moving Average** (`calculateMovingAverageReceipt`, `calculateMovingAverageIssue`, `reverseInventoryState`), pencegahan stok negatif, dan pencatatan mutasi stok (`opening`, `purchase`, `sale`, `opname_in`, `opname_out`, `usage_out`, `production_in`, `void_reversal`) dengan field siap ekspansi (`batchRef`, `costComponents`).
     - `core/subledger.ts`: Subledger piutang & utang yang mewajibkan keterkaitan ke `partyId` dan `invoiceId` asal serta memblokir pelunasan melebihi `remainingAmount`.
     - `core/statements.ts`: Perhitungan Trial Balance, Buku Besar (dengan saldo awal terbawa antarperiode), Laporan Laba Rugi (scope periode), Laporan Perubahan Modal, dan Laporan Posisi Keuangan (akun riil kumulatif + laba periode sebelumnya belum ditutup + laba periode berjalan).
     - `core/engine.ts`: `AccountingEngine` dengan dukungan transaksi operasional, konversi produksi sederhana tanpa BOM/tenaga kerja/overhead, stock opname positif/negatif, penutupan periode formal (`closePeriod`), pembatalan melalui **void/reversal** (tanpa hapus transaksi), serta pencatatan `auditLogs`.
     - `core/repository.ts` & `core/in-memory-repository.ts`: Kontrak `AccountingRepository` terisolasi per `tenantId` beserta implementasi in-memory untuk pengujian independen dan pondasi adapter SQLite lokal di fase mendatang.
     - `core/sample-data.ts`: Seeder data contoh UMKM Makanan Keluarga melalui `AccountingEngine`.

2. **Dokumentasi Kebijakan & Arsitektur**:
   - `docs/accounting-policy.md`: Dokumentasi perlakuan akuntansi untuk setiap mutasi persediaan, moving average, stock opname (+/-), pemisahan akun riil/nominal, dan keputusan kebijakan.
   - `docs/architecture.md`: Dokumentasi pemisahan layer dan rancangan repository port untuk Cloudflare D1 & adapter SQLite lokal.

## 2. Hasil Pengujian PHASE 2

Perintah: `node --test tests/accounting-core.test.mjs`
- `tests 6 | pass 6 | fail 0` (durasi `342.76ms`):
  1. Moving Average + COGS + Stock Opname (+/-) sesuai perhitungan manual.
  2. Pemisahan Bahan Baku (`1104`) & Barang Jadi (`1105`) serta konversi produksi sederhana.
  3. Subledger AR/AP terhubung ke pelanggan & faktur, blokir kelebihan bayar, serta void/reversal dengan audit trail.
  4. Kelanjutan saldo neraca antarperiode (sebelum dan sesudah `closePeriod`) sesuai perhitungan manual.
  5. Data contoh seimbang dan total nilai subledger persediaan sama persis dengan saldo akun `1104` & `1105`.
  6. Penolakan jurnal tidak seimbang & pemblokiran void pembelian jika stok sudah terlanjur terjual.
