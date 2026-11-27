# Panduan Penggunaan Live Demo Publik ("Aneka Snack")

**URL Live Demo**: `https://umkm-accounting-demo.ebnunih.workers.dev`

> **Pemberitahuan Simulasi**: Seluruh data usaha **Aneka Snack** yang tampil pada halaman demo ini adalah **data simulasi/dummy** untuk keperluan pengujian dan pembaca artikel. Tidak ada data keuangan UMKM nyata atau data pribadi yang digunakan.

---

## 1. Model Keamanan Akses Demo (Sandbox Terisolasi per Pengunjung)

Alih-alih memakai satu akun bersama (*shared tenant*) yang rentan tabrakan data antar pembaca artikel maupun kebocoran mutasi lintas pengguna, demo ini menggunakan **Controlled Per-Visitor Sandbox**:
- Ketika pengunjung menekan tombol masuk demo **Owner** atau **Staff**, server (`POST /api/auth/demo-start`) membuat **tenant sandbox `demo-<uuid>` baru** berisi data awal bersih **"Aneka Snack"**, serta sepasang akun acak (`owner-...` dan `staff-...`) dengan kata sandi kriptografis acak dan sesi DB `umkm_session` (`HttpOnly; Secure; SameSite=Lax`).
- Setiap pengunjung **hanya** dapat melihat dan mengubah sandbox miliknya sendiri. Permintaan ke ID barang, faktur, atau tenant milik pengunjung lain ditolak oleh server (`403` / `404`).
- Pembuatan sandbox baru dibatasi rate-limiter berbasis IP di D1 (`login_rate_limits`, maks 12 sandbox per 15 menit per IP).

---

## 2. Dataset Simulasi "Aneka Snack"

Setiap sandbox baru langsung terisi siklus pembukuan lengkap periode **September 2026**:
- **Profil Usaha**: `Aneka Snack` — `Yogyakarta`, periode aktif `2026-09`.
- **Master Relasi**: Pelanggan (`Toko Oleh-Oleh Sari`, `Reseller Mbak Rina`) & Pemasok (`Agen Sembako Sejahtera`, `Pabrik Kemasan Jaya`).
- **Master Persediaan**:
  - *Bahan Baku (`1104`)*: `Singkong Kupas` (dengan saldo awal `20 kg`), `Minyak & Bumbu Balado`, `Kemasan Standing Pouch`.
  - *Barang Jadi (`1105`)*: `Keripik Singkong Balado` (dengan saldo awal `50 bungkus`), `Makaroni Pedas Renyah`.
- **Transaksi Awal Simulasi**:
  - Setoran modal awal & pembelian peralatan pengemasan (`1201`).
  - Pembelian bahan baku kredit & tunai + transfer produksi `Singkong Kupas` → `Keripik Singkong Balado`.
  - Pembelian barang jadi kredit → **Utang Usaha** terbuka ke pemasok.
  - Penjualan tunai & penjualan kredit → **Piutang Usaha** terbuka dari pelanggan & perhitungan **HPP Moving Average** otomatis.
  - Pelunasan sebagian piutang, pelunasan utang, beban operasional, dan jurnal penyesuaian penyusutan.

---

## 3. Cara Mencoba Demo (Panduan Singkat)

1. Buka `https://umkm-accounting-demo.ebnunih.workers.dev`.
2. Klik **"Masuk Demo: Owner Aneka Snack"** untuk mencoba seluruh fitur sebagai pemilik usaha, atau **"Masuk Demo: Staff Aneka Snack"** untuk mencoba peran staf kasir/operasional.
3. **Uji Alur Akuntansi**:
   - Buka **Pembelian** / **Penjualan**, catat pembelian stok baru lalu jual sebagian, dan amati perubahan **Moving Average** serta **HPP** pada menu **Persediaan**.
   - Buka **Kas & Bank**, lunasi sebagian sisa piutang `Toko Oleh-Oleh Sari` atau utang `Agen Sembako Sejahtera` (percobaan bayar melebihi sisa tagihan akan ditolak `409`).
   - Buka **Buku Besar** untuk memeriksa jurnal umum berimbang, kartu buku besar, neraca saldo, dan **Audit Trail** (khusus Owner), atau **Laporan Keuangan** untuk export **PDF / XLSX**.
4. **Uji RBAC (Owner vs Staff)**:
   - Klik tombol **"Uji sebagai Staff"** pada bar kanan atas (`POST /api/auth/demo-switch-role`). Server otomatis mencabut token Owner sebelumnya, menerbitkan token Staff, dan mengunci tombol **Tutup Periode**, **Pengaturan Profil**, **Manajemen Anggota**, **Audit Trail**, serta **Reset Data Demo** (`403` jika dipanggil langsung).
   - Klik **"Kembali ke Owner"** untuk mencoba penutupan periode (**Akhir Bulan**) atau mengembalikan data simulasi.
5. **Reset Data Demo**:
   - Sebagai **Owner**, klik **"Reset data demo Aneka Snack"** di bagian bawah sidebar untuk mengembalikan sandbox Anda ke kondisi simulasi awal yang bersih tanpa memengaruhi pengunjung lain.
6. **Logout**:
   - Klik **"Keluar (Logout)"** untuk mencabut sesi server-side di D1 (`revoked_at`) dan menghapus cookie sesi.
