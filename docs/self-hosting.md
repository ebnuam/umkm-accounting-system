# Panduan Instalasi & Operasional Self-Hosted (SQLite Lokal)

Panduan ini menjelaskan cara menjalankan **UMKM Accounting Cycle** secara penuh di komputer atau server lokal (Linux/macOS/Windows) **tanpa akun Cloudflare** dan tanpa ketergantungan Cloudflare D1.

---

## 1. Prasyarat
- **Node.js `>= 22.13.0`** (direkomendasikan **Node.js 24.x** karena mendukung `node:sqlite` dan native TypeScript secara bawaan tanpa kompilasi C++ tambahan).
- `npm` (sudah termasuk dalam instalasi Node.js).

---

## 2. Instalasi dari Nol

```bash
# 1. Clone repository & masuk ke folder proyek
git clone <URL_REPOSITORY>
cd "UMKM Accounting Syclus"

# 2. Pasang dependensi
npm install

# 3. Salin file konfigurasi environment contoh
cp .env.example .env
```

Edit file `.env` dan isi nilai minimum berikut:
```env
DB_ADAPTER=sqlite
SQLITE_DB_PATH=./data/umkm-accounting.sqlite
SESSION_SECRET=<isi-minimal-32-karakter-acak-rahasia>
PORT=3000
HOST=127.0.0.1
```
*(Gunakan `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` untuk membuat `SESSION_SECRET` yang kuat.)*

---

## 3. Migrasi Database Lokal

Jalankan skrip migrasi lokal (non-destruktif, aman dijalankan ulang):

```bash
npm run db:migrate:local
```

Skrip ini menjalankan migrasi SQL di folder `drizzle/` (`0000`–`0003`) ke file `SQLITE_DB_PATH` dalam mode `WAL` (`PRAGMA journal_mode = WAL;`) beserta tabel autentikasi (`users`, `business_memberships`, `user_sessions`, `login_rate_limits`), index unik, dan trigger integritas stok/faktur/periode.

---

## 3.1. Membuat Akun Owner Pertama (Bootstrap Aman)

Aplikasi **tidak** menyediakan akun bawaan dengan password tetap. Untuk instalasi lokal baru, buat akun Owner pertama via CLI sebelum atau sesudah migrasi selesai:

```bash
npm run auth:bootstrap-owner -- --email owner@umkm.local --name "Pemilik Usaha" --business "UMKM Makmur"
```

Atau isi token acak minimal 16 karakter di `BOOTSTRAP_SETUP_TOKEN` pada `.env`, jalankan server, lalu selesaikan form **"Setup Owner Pertama"** di UI (atau `POST /api/auth/bootstrap`). Setelah 1 akun pengguna ada di database, endpoint dan CLI bootstrap otomatis terkunci permanen (`403`). Detail lengkap ada pada [`docs/authentication.md`](file:///docs/authentication.md).

---

## 4. Menjalankan Aplikasi

### Mode Produksi (Direkomendasikan)
```bash
npm run build:selfhosted
npm run start:selfhosted
```
Lalu buka `http://127.0.0.1:3000` (atau sesuai `HOST` dan `PORT` di `.env`).

### Mode Development
```bash
npm run dev:selfhosted
```

---

## 5. Pemilihan Adapter Database (Environment)

| `DB_ADAPTER` | Adapter Aktif | Lokasi Data |
| --- | --- | --- |
| `sqlite` *(atau `local`)* | `LocalSqliteAccountingRepository` | File lokal di `SQLITE_DB_PATH` (default `./data/umkm-accounting.sqlite`) |
| `d1` *(default jika kosong)* | `D1AccountingRepository` | Binding Cloudflare D1 (`DB`) |

Seluruh aturan akuntansi, validasi double-entry, moving average, subledger piutang/utang, void/reversal, dan penutupan periode berjalan identik di kedua adapter.

---

## 6. Prosedur Backup & Restore Lokal

### Backup Online Aman (SQLite WAL)
Jangan menyalin file `.sqlite` secara mentah saat aplikasi sedang menulis tanpa checkpoint atau `VACUUM INTO`. Gunakan perintah berikut:
```bash
npm run db:backup:local
```
Perintah ini menjalankan `VACUUM INTO` secara atomik ke folder `./backups/umkm-accounting-<timestamp>.sqlite` dan memverifikasi hasilnya dengan `PRAGMA integrity_check`.

### Restore dari Backup
1. Hentikan proses aplikasi (`vinext start` / `start:selfhosted`).
2. Cadangkan file saat ini (jika masih ada) beserta file `-wal` dan `-shm`:
   ```bash
   mv ./data/umkm-accounting.sqlite ./data/umkm-accounting.sqlite.broken
   rm -f ./data/umkm-accounting.sqlite-wal ./data/umkm-accounting.sqlite-shm
   ```
3. Salin file backup terverifikasi ke lokasi target:
   ```bash
   cp ./backups/umkm-accounting-YYYY-MM-DD.sqlite ./data/umkm-accounting.sqlite
   ```
4. Jalankan ulang `npm run db:migrate:local` (untuk memastikan skema terbaru) lalu nyalakan kembali `npm run start:selfhosted`.
