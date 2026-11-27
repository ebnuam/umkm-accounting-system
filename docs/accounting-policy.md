# Kebijakan & Perlakuan Akuntansi (Accounting Policy)

Dokumen ini mendokumentasikan perlakuan akuntansi standar yang diterapkan pada **Accounting Core** untuk seluruh sektor usaha (**Dagang**, **Jasa**, **Manufaktur / Produksi**, maupun **Usaha Campuran**) mengacu pada prinsip **SAK EMKM / SAK ETAP** & akuntansi *double-entry*.

## 1. Klasifikasi Akun Universal (Akun Riil vs Akun Nominal)

Standar bawaan menyediakan **43 akun** (`1101`–`5199`) di [`core/coa.ts`](file:///core/coa.ts) dan mendukung penambahan akun kustom per bisnis:

| Kelompok | Kode Akun | Nama Akun | Sifat Akun | Saldo Normal | Perlakuan Antarperiode |
| --- | --- | --- | --- | --- | --- |
| Aset Lancar | `1101`–`1108` | Kas, Bank, Piutang Usaha, Persediaan Bahan Baku (`1104`), Barang Jadi (`1105`), WIP (`1106`), Perlengkapan/Sewa Dimuka (`1107`), PPN Masukan (`1108`) | Riil | Debit | Saldo terbawa (kumulatif) |
| Aset Tetap | `1201`, `1203`, `1204` | Peralatan & Mesin, Kendaraan & Inventaris, Bangunan & Tanah | Riil | Debit | Saldo terbawa (kumulatif) |
| Kontra Aset | `1202` | Akumulasi Penyusutan | Riil | Kredit | Saldo terbawa (kumulatif) |
| Liabilitas | `2101`–`2105`, `2201` | Utang Usaha, Utang Beban, Pendapatan Diterima Dimuka (`2103`), PPN Keluaran (`2104`), Utang Gaji & Pajak (`2105`), Utang Bank Jangka Panjang (`2201`) | Riil | Kredit | Saldo terbawa (kumulatif) |
| Ekuitas | `3101`, `3103` | Modal Pemilik, Laba Ditahan | Riil | Kredit | Saldo terbawa (kumulatif) |
| Kontra Ekuitas | `3102` | Prive | Nominal | Debit | Ditutup ke `3103` akhir periode |
| Penutup | `3999` | Ikhtisar Laba Rugi | Nominal | Kredit | Akun perantara penutupan periode |
| Pendapatan | `4101`, `4102`, `4201`, `4202` | Penjualan Barang (`4101`), Pendapatan Jasa (`4102`), Selisih Persediaan (`4201`), Pendapatan Lain (`4202`) | Nominal | Kredit | Ditutup ke `3999` → `3103` |
| Kontra Pendapatan | `4103` | Diskon & Retur Penjualan | Nominal | Debit | Mengurangi pendapatan neto, ditutup ke `3999` → `3103` |
| HPP / Pokok | `5101`, `5108` | Harga Pokok Penjualan (`5101`), Beban Jasa / Subkontraktor (`5108`) | Nominal | Debit | Ditutup ke `3999` → `3103` |
| Produksi & Beban | `5102`–`5107`, `5109`–`5115`, `5199` | Kemasan, Listrik, Gas, Transport, Penyusutan, Selisih Persediaan, BTKL (`5109`), BOP (`5110`), Gaji, Sewa, Promosi, Adm, Pajak Bank, Lain-lain | Nominal | Debit | Ditutup ke `3999` → `3103` |

---

## 2. Dukungan Multi-Sektor Usaha

1. **Usaha Dagang**:
   - Pembelian & penjualan tunai/bank/kredit dengan HPP Perpetual Moving Average (`1105` → `5101`), faktur piutang (`1103`) dan utang (`2101`), serta stock opname (`4201` / `5107`).
2. **Usaha Jasa**:
   - Kategori item `service` (`trackInventory = false`) memetakan pendapatan otomatis ke `4102 Pendapatan Jasa` (atau akun pendapatan kustom item) tanpa pemotongan stok, serta mendukung pembelian subkontraktor/jasa ke `5108 Beban Jasa / Subkontraktor`, *Pendapatan Diterima Dimuka* (`2103`), dan *Sewa/Perlengkapan Dibayar Dimuka* (`1107`) via Jurnal Umum Manual.
3. **Usaha Manufaktur / Produksi**:
   - Pemisahan `1104 Persediaan Bahan Baku`, `1106 Persediaan Barang Dalam Proses (WIP)`, dan `1105 Persediaan Barang Jadi`.
   - `postProductionRun` mendukung pemakaian **multi-bahan baku / WIP** + **Biaya Tenaga Kerja Langsung (BTKL)** + **Biaya Overhead Pabrik (BOP)** yang dikapitalisasi menjadi harga pokok rata-rata bergerak baru pada `1106 WIP` atau `1105 Barang Jadi`, lengkap dengan rincian `costComponents` (`material`, `labor`, `overhead`).
4. **Jurnal Umum Manual (`postGeneralJournal`) & COA Kustom**:
   - Mendukung pencatatan transaksi fleksibel lintas akun (utang bank, pajak PPN masukan/keluaran, gaji, sewa dibayar dimuka, amortisasi) dengan validasi ketat `Total Debit === Total Kredit`.

---

## 3. Metode Persediaan & Integritas

- **Perpetual Moving Average + Stock Opname** berlaku pada seluruh item bertipe stok (`raw_material`, `wip`, `finished_good`) dengan pencegahan stok negatif (`CHECK_NEGATIVE_STOCK`).
- **Piutang & Utang**: terhubung ke pelanggan/pemasok serta faktur asal, mencegah pelunasan melebihi sisa tagihan (`CHECK_OVERPAYMENT`).
- **Void / Reversal & Audit Trail**: transaksi yang sudah diposting tidak pernah dihapus (`DELETE`); pembatalan selalu melalui jurnal pembalik (`voidJournalEntry`) dan tercatat di `audit_logs`.
