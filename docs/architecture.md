# Arsitektur Aplikasi & Repository Abstraction

## 1. Prinsip Pemisahan Layer (Decision B)

```text
+-------------------------------------------------------+
| UI & API Transport (Vinext / Next App Router / React) |
|  app/page.tsx, public/app.js, app/api/**              |
+---------------------------+---------------------------+
                            | memanggil
                            v
+-------------------------------------------------------+
| Accounting Core (Pure TypeScript, Zero Framework/DB)  |
|  core/engine.ts, core/inventory.ts, core/subledger.ts |
|  core/statements.ts, core/validation.ts, core/coa.ts  |
+---------------------------+---------------------------+
                            | bergantung pada interface
                            v
+-------------------------------------------------------+
| Repository Port (core/repository.ts)                  |
|  AccountingRepository (tenant-scoped, atomic commit)  |
+-------------+---------------------------+-------------+
              |                           |
              v                           v (Fase Lanjutan)
+---------------------------+   +-----------------------+
| D1AccountingRepository    |   | LocalSqliteRepository |
| (db/d1-repository.ts)     |   | (better-sqlite3/node) |
| Drizzle ORM + Cloudflare  |   | Self-hosted adapter   |
| D1 (Hosted Application)   |   | (setelah core stabil) |
+---------------------------+   +-----------------------+
```

## 2. Mengapa Desain Ini Dipilih?
1. **Zero Framework Coupling di `core/`**: Seluruh file di `core/` tidak mengimpor `next/*`, `react`, `cloudflare:workers`, atau `drizzle-orm`. Seluruh aturan akuntansi dapat dijalankan dan diuji langsung menggunakan `node --test` dan `InMemoryAccountingRepository`.
2. **Kompatibilitas Cloudflare D1**: Hosted application tetap berjalan di atas Vinext + Drizzle ORM + Cloudflare D1 (`db/schema.ts`, `db/d1-repository.ts`).
3. **Kesiapan Self-Hosted SQLite Adapter**: Karena kontrak `AccountingRepository` menggunakan skema relasional standar SQLite (`TEXT`, `INTEGER`, `REAL`), penambahan `LocalSqliteRepository` di masa depan cukup mengimplementasikan interface `AccountingRepository` tanpa mengubah satu baris pun business logic di `core/` atau API handlers.
4. **Isolasi Multi-Tenant**: Setiap metode `AccountingRepository` menerima `tenantId` secara eksplisit sebagai parameter pertama dan melakukan filter `tenant_id` pada level query database, bukan hanya di sisi klien.
