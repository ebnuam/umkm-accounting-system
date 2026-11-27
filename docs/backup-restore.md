# Prosedur Backup & Restore Database (Cloudflare D1)

## 1. Backup Terjadwal Cloudflare D1
Gunakan Wrangler CLI untuk mengekspor snapshot SQL lengkap sebelum migrasi atau secara terjadwal (harian/mingguan):

```bash
npx wrangler d1 export <D1_DATABASE_NAME> --remote --output="./backups/d1-$(date +%Y%m%d-%H%M%S).sql"
```

Selain ekspor penuh, Cloudflare D1 menyediakan **Time Travel** (point-in-time recovery hingga 30 hari pada paket berbayar / 7 hari pada paket gratis):
```bash
npx wrangler d1 time-travel info <D1_DATABASE_NAME>
```

## 2. Verifikasi Backup (Dry-Run Lokal)
Sebelum mengandalkan file backup, uji restore pada database lokal sementara:
```bash
npx wrangler d1 execute <D1_DATABASE_NAME> --local --file="./backups/d1-YYYYMMDD-HHMMSS.sql"
```

## 3. Prosedur Restore Darurat
1. Hentikan sementara trafik tulis (atau aktifkan maintenance mode) agar tidak ada transaksi parsial selama restore.
2. Gunakan D1 Time Travel bila insiden baru terjadi:
   ```bash
   npx wrangler d1 time-travel restore <D1_DATABASE_NAME> --timestamp="<ISO_8601_UTC>"
   ```
3. Atau pulihkan dari file `.sql` ke database D1 baru, verifikasi integritas neraca (`SUM(debit) = SUM(credit)` pada `journal_lines`), lalu alihkan binding `DB`.

## 4. Verifikasi Integritas Pasca-Restore
Jalankan query verifikasi berikut pada database hasil restore:
```sql
-- Harus mengembalikan 0 baris (seluruh jurnal seimbang)
SELECT journal_entry_id, SUM(debit) AS d, SUM(credit) AS c
FROM journal_lines
GROUP BY journal_entry_id
HAVING d != c;

-- Harus mengembalikan 0 baris (tidak ada stok atau nilai persediaan negatif)
SELECT id, name, quantity_on_hand, total_inventory_value
FROM items
WHERE quantity_on_hand < -0.000001 OR total_inventory_value < 0;
```
