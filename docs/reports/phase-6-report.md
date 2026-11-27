# Phase 6 Report — User Authentication, Business Membership & Access Control

**Branch**: `phase-2-accounting-core` (branch `main` tidak diubah)  
**Tanggal Verifikasi**: 2026-11-27

---

## 1. Ringkasan Implementasi

Phase 6 menggantikan sesi anonim berbasis signed tenant cookie / proxy header menjadi sistem autentikasi pengguna terverifikasi, keanggotaan bisnis *many-to-many*, kontrol akses berbasis peran (**Owner** vs **Staff**), serta mekanisme *bootstrap* Owner aman untuk instalasi self-hosted.

### A. Skema & Migrasi Non-Destruktif
- [`drizzle/0003_phase6_auth_membership.sql`](file:///drizzle/0003_phase6_auth_membership.sql), [`drizzle/meta/_journal.json`](file:///drizzle/meta/_journal.json), [`db/ddl.ts`](file:///db/ddl.ts), dan [`db/schema.ts`](file:///db/schema.ts) menambahkan 4 tabel:
  - `users`: `id`, `email` (unik), `full_name`, `password_hash`, `active`, `created_at`, `updated_at`.
  - `business_memberships`: relasi `user_id` ↔ `tenant_id` dengan `role` (`owner` | `staff`), `active`, serta unique constraint `(user_id, tenant_id)`.
  - `user_sessions`: sesi server-side menyimpan `token_hash` (SHA-256), `active_tenant_id`, `expires_at`, dan `revoked_at`.
  - `login_rate_limits`: pembatasan percobaan login berbasis database (kompatibel lintas Cloudflare Workers/D1 dan Node/SQLite).

### B. Auth Core & Kompatibilitas Dual Adapter
- [`core/auth.ts`](file:///core/auth.ts) (`AuthService`, `AuthRepository`, `ROLE_PERMISSIONS`, `assertPermission`): terisolasi murni di `core/` tanpa ketergantungan Next.js, React, Drizzle, atau runtime Cloudflare.
- **Hashing Password**: Web Crypto `PBKDF2-SHA256` 100.000 iterasi dengan salt acak 16 byte (`pbkdf2_sha256$100000$<salt>$<hash>`) dan pembandingan waktu konstan.
- **Sesi Opaque**: Token acak kriptografis 32-byte (`umkmsess_...`) disimpan ter-hash (`SHA-256`) di database, TTL 7 hari, rotasi otomatis setelah 12 jam atau saat `createBusinessForUser` / `switchBusiness`, serta pencabutan langsung pada logout atau saat keanggotaan dicabut.
- **Shared Repository**: [`db/auth-repository.ts`](file:///db/auth-repository.ts) (`DrizzleSqliteAuthRepository`) dipakai bersama oleh [`db/d1-runtime.ts`](file:///db/d1-runtime.ts) (`D1AccountingRepository`) dan [`db/local-sqlite-repository.ts`](file:///db/local-sqlite-repository.ts) (`LocalSqliteAccountingRepository`) melalui [`db/index.ts`](file:///db/index.ts).

### C. Endpoint API, Keamanan Sesi & RBAC
- [`app/request-session.ts`](file:///app/request-session.ts):
  - Menghapus kepercayaan pada header identitas eksternal yang tidak terverifikasi.
  - Menerapkan cookie `umkm_session` dengan `HttpOnly`, `SameSite=Lax`, serta `Secure` otomatis pada `https:`.
  - Validasi `Sec-Fetch-Site` (`same-origin` / `none`), `Origin`, dan `Referer` pada seluruh operasi mutasi.
- Endpoint Auth di [`app/api/auth/_handler.ts`](file:///app/api/auth/_handler.ts) & `app/api/auth/*/route.ts`:
  - `GET /api/auth/session`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/bootstrap`, `POST /api/auth/businesses`, `POST /api/auth/switch-business`, `GET /api/auth/members`, `POST /api/auth/members`.
  - Pesan gagal login identik (`"Email atau kata sandi salah."`) baik untuk email tidak terdaftar maupun password salah; penguncian `429 TOO_MANY_ATTEMPTS` setelah 5 kegagalan dalam 15 menit.
- Proteksi Endpoint Akuntansi & Export di [`app/api/accounting/_handler.ts`](file:///app/api/accounting/_handler.ts) dan `app/api/export/*/route.ts`:
  - Seluruh endpoint wajib melewati `authenticateRequest(...)` dan `assertPermission(ctx.role, ...)`.
  - **Staff** diizinkan melakukan operasi harian (posting transaksi, stock opname, jurnal penyesuaian, master barang/relasi, void, export), namun ditolak (`403`) untuk `update_profile`, `period:close`, `workspace:reset`, pengelolaan anggota, serta tidak menerima stream `auditLogs`.
- **UI Frontend** ([`app/page.tsx`](file:///app/page.tsx), [`app/legacy.css`](file:///app/legacy.css), [`public/app.js`](file:///public/app.js)):
  - Halaman Masuk / Daftar Bisnis Baru / Setup Owner Pertama saat belum login.
  - Dropdown pemindah bisnis aktif (`#businessSwitcher`), badge peran (`#roleBadge`), tombol keluar (`#logoutButton`), form **Buat Bisnis Baru**, serta panel **Anggota & Hak Akses Bisnis** khusus Owner.

### D. Self-Hosted Bootstrap Aman
- [`scripts/bootstrap-owner.mjs`](file:///scripts/bootstrap-owner.mjs) (`npm run auth:bootstrap-owner`) dan endpoint `POST /api/auth/bootstrap` yang dilindungi `BOOTSTRAP_SETUP_TOKEN` (minimal 16 karakter).
- Keduanya otomatis terkunci permanen (`403 BOOTSTRAP_LOCKED` / exit `1`) segera setelah 1 user ada di database. Tidak ada akun default atau password hardcoded.
- Dokumentasi lengkap tersedia pada [`docs/authentication.md`](file:///docs/authentication.md) dan [`docs/self-hosting.md`](file:///docs/self-hosting.md).

---

## 2. Hasil Verifikasi Setelah Edit Terakhir

| Pemeriksaan | Perintah | Hasil |
| --- | --- | --- |
| Automated Test Suite | `node --test tests/*.test.mjs` | **22/22 lulus** (0 gagal, 0 dilewati) — mencakup unit auth/RBAC pada **D1Adapter** dan **LocalSqliteAdapter**, isolasi multi-tenant, edge cases akuntansi, contract parity D1 vs SQLite, serta bootstrap CLI |
| Linter | `.\node_modules\.bin\eslint.cmd core db app scripts public/app.js` | **Lulus** (0 error, 0 warning) |
| TypeScript | `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | **Lulus** (0 error) |
| Build Self-Hosted (SQLite) | `node scripts/selfhosted-cli.mjs build` | **Lulus** (21 route ter-build ke `dist/`) |
| Build Hosted (Cloudflare D1) | `.\node_modules\.bin\vinext.cmd build` | **Lulus** (21 route ter-build ke `dist/`) |
| Live Self-Hosted HTTP Smoke Test | `selfhosted-cli.mjs start` pada SQLite terisolasi | **Lulus** (`LIVE_SELFHOSTED_AUTH_SMOKE_OK`): unauth `401` → bootstrap Owner `201` → bootstrap lock `403` → daftar & undang Staff → switch bisnis → Staff close period `403` → logout revokes session (`401`) |

---

## 3. Batasan, Risiko Tersisa & Kesiapan Demo Publik

1. **Verifikasi Email & Lupa Kata Sandi Belum Tersedia**: Registrasi publik langsung mengaktifkan akun tanpa verifikasi OTP/link email, dan belum ada alur reset password mandiri via email. Untuk demo publik terbatas hal ini dapat diterima atau pendaftaran publik dapat dimatikan via `DISABLE_PUBLIC_SIGNUP=true`, namun sebelum penggunaan produksi komersial penuh disarankan menambahkan email verification & password reset.
2. **Trust Header Rate-Limit di Self-Hosted**: [`app/request-session.ts`](file:///app/request-session.ts) membaca `cf-connecting-ip` lalu `x-forwarded-for`. Jika aplikasi self-hosted dipublikasikan di balik reverse proxy yang tidak menimpa `x-forwarded-for`, pembatasan berbasis IP dapat diakali oleh header palsu; proteksi rate-limit per email di tabel `login_rate_limits` tetap melindungi masing-masing akun.
3. **Verifikasi D1 Lokal vs Remote Cloudflare**: Pengujian adapter D1 di suite ini menggunakan Drizzle `sqlite-proxy` di atas `node:sqlite` in-memory (sesuai batasan untuk tidak menyentuh Cloudflare remote maupun men-deploy pada fase ini).
4. **Penilaian Kesiapan**: Sistem autentikasi berbasis DB session opaque, isolasi membership server-side, RBAC Owner vs Staff, CSRF/Origin check, dan bootstrapping aman telah memadai untuk **tahap demo terpublikasi secara terbatas atau uji coba self-hosted internal** (dengan `SESSION_SECRET` / `BOOTSTRAP_SETUP_TOKEN` terkonfigurasi dan `HTTPS` aktif), sambil melengkapi alur reset kata sandi dan audit dependensi sebelum pembukaan produksi skala luas.
