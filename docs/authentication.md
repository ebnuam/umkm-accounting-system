# Autentikasi Pengguna, Keanggotaan Bisnis & Kontrol Akses (Phase 6)

Dokumen ini menjelaskan arsitektur autentikasi pengguna, isolasi multi-tenant berbasis database, kontrol akses berbasis peran (**Owner** vs **Staff**), serta setup awal (*bootstrap*) Owner untuk instalasi self-hosted.

---

## 1. Alur Autentikasi & Penyimpanan Kredensial

Implementasi inti berada di [`core/auth.ts`](file:///core/auth.ts) (`AuthService`) dan dipakai oleh kedua adapter database melalui [`db/auth-repository.ts`](file:///db/auth-repository.ts) (`DrizzleSqliteAuthRepository`).

- **Registrasi (`POST /api/auth/register`)**:
  - Memvalidasi format email, nama lengkap, nama bisnis awal, dan panjang kata sandi minimum (`>= 8` karakter).
  - Menolak duplikasi email dengan `409 EMAIL_EXISTS`.
  - Dapat dinonaktifkan pada instalasi privat/self-hosted dengan `DISABLE_PUBLIC_SIGNUP=true`.
- **Hashing Kata Sandi (`PBKDF2-SHA256`)**:
  - Menggunakan Web Crypto API (`crypto.subtle.deriveBits`) dengan **100.000 iterasi**, garam (*salt*) acak **16 byte** per pengguna, dan output **32 byte** (`pbkdf2_sha256$100000$<saltB64Url>$<hashB64Url>`).
  - Perbandingan hash menggunakan pembandingan waktu konstan (`constantTimeEqual`). Kata sandi plaintext tidak pernah disimpan atau dicatat di log.
- **Login (`POST /api/auth/login`)**:
  - Baik email yang tidak terdaftar maupun kata sandi yang salah menghasilkan pesan respons identik: `"Email atau kata sandi salah."` (`401`) agar status pendaftaran email tidak bocor (*user enumeration prevention*).
- **Logout (`POST /api/auth/logout`)**:
  - Mencabut sesi secara langsung di database (`user_sessions.revoked_at`) dan menghapus cookie `umkm_session` (`Max-Age=0`).

---

## 2. Keamanan Sesi & Cookie

Mekanisme sesi dikelola pada [`app/request-session.ts`](file:///app/request-session.ts) dan [`core/auth.ts`](file:///core/auth.ts):

- **Token Sesi Opaque di Database**: Token dibuat dengan 32 byte acak kriptografis (`umkmsess_<base64url>`). Hanya hash `SHA-256` token yang disimpan pada tabel `user_sessions.token_hash`; cookie mentah tidak disimpan di database.
- **Masa Berlaku & Rotasi Otomatis**:
  - Masa berlaku sesi: **7 hari** (`SESSION_TTL_MS`).
  - Rotasi token otomatis terjadi setelah **12 jam** (`SESSION_ROTATE_AFTER_MS`), saat membuat bisnis baru, atau saat mengganti bisnis aktif (`POST /api/auth/switch-business`), sehingga token lama segera tidak berlaku ketika digantikan.
- **Cookie Flags**:
  - `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
  - Flag `Secure` otomatis ditambahkan pada permintaan `https:`.
- **Proteksi CSRF & Origin**:
  - Seluruh endpoint mutasi (`POST`) memeriksa `Sec-Fetch-Site` (`same-origin` / `none`) serta kecocokan `Origin` atau `Referer` dengan host permintaan (`verifySameOriginRequest`). Origin `null` dan lintas domain ditolak dengan `401`.
- **Penghapusan Header Identitas Tidak Terverifikasi**:
  - Header proxy lama tidak lagi dipakai; identitas pengguna selalu berasal dari token sesi terverifikasi di tabel `user_sessions`.
- **Rate Limiting Login**:
  - Tabel `login_rate_limits` membatasi kegagalan login per email dan per client key hingga **5 percobaan dalam jendela 15 menit** (`TooManyAttemptsError` / HTTP `429`), dengan penguncian sementara 15 menit.

---

## 3. Keanggotaan Multi-Bisnis (`business_memberships`)

Skema [`drizzle/0003_phase6_auth_membership.sql`](file:///drizzle/0003_phase6_auth_membership.sql) menambahkan:
- `users`: akun pengguna terverifikasi.
- `business_memberships`: relasi *many-to-many* antara `users` dan `tenants` dengan kolom `role` (`owner` | `staff`) dan `active`.
- `user_sessions`: sesi aktif pengguna beserta `active_tenant_id` yang dipilih di sisi server.
- `login_rate_limits`: pencatatan percobaan gagal berbasis database agar bekerja di Cloudflare Workers maupun Node.js lokal.

Aturan isolasi tenant:
1. Frontend **tidak dapat** menyuntikkan `tenantId` secara sepihak ke endpoint `/api/accounting/*` atau `/api/export/*`.
2. Pergantian bisnis aktif wajib melalui `POST /api/auth/switch-business`, yang memverifikasi keanggotaan aktif `(userId, tenantId)` di database, menolak non-anggota dengan `403`, dan merotasi token sesi.
3. Pencabutan keanggotaan (`removeMember`) langsung mencabut semua sesi pengguna tersebut pada tenant terkait (`revokeUserSessionsForTenant`) dan mencegah penghapusan **Owner terakhir** dalam bisnis.

---

## 4. Matriks Hak Akses (RBAC: Owner vs Staff)

| Kemampuan / Operasi | Owner | Staff | Enforcement Backend |
| --- | :---: | :---: | --- |
| Membaca workspace, laporan & master data (`workspace:read`) | Ya | Ya | `authenticateRequest` + `assertPermission` |
| Posting transaksi penjualan, pembelian, kas/bank (`transactions:post`) | Ya | Ya | `assertPermission(ctx.role, "transactions:post")` |
| Input Stock Opname & Jurnal Penyesuaian (`opname:post`, `adjustments:post`) | Ya | Ya | `assertPermission` |
| Kelola Master Barang & Pelanggan/Pemasok (`master:write`) | Ya | Ya | `assertPermission` |
| Void / Reversal jurnal (`entry:void`) | Ya | Ya | `assertPermission` |
| Export laporan XLSX & PDF (`reports:export`) | Ya | Ya | `assertPermission` |
| Mengubah Profil Usaha & Periode Aktif (`profile:update`) | Ya | **Ditolak (403)** | `handleMasterMutation` |
| Menutup Periode Akuntansi (`period:close`) | Ya | **Ditolak (403)** | `handleClosePeriod` |
| Reset Data Contoh Workspace (`workspace:reset`) | Ya | **Ditolak (403)** | `handleResetWorkspace` |
| Kelola Anggota & Role (`members:manage`) | Ya | **Ditolak (403)** | `handleListMembers`, `handleManageMembers` |
| Melihat Stream Audit Trail lengkap (`audit:read`) | Ya | Disembunyikan (`[]`) | `buildWorkspaceResponse` |

---

## 5. Self-Hosted Owner Bootstrap Aman

Pada instalasi lokal/self-hosted baru (`countUsers() === 0`):
- **Tidak ada akun default atau password hardcoded.**
- **Opsi A — CLI (Direkomendasikan)**:
  ```bash
  npm run auth:bootstrap-owner -- --email owner@umkm.local --name "Pemilik Usaha" --business "UMKM Makmur" --city "Yogyakarta"
  ```
- **Opsi B — Endpoint Web Sekali Pakai (`POST /api/auth/bootstrap`)**:
  1. Set `BOOTSTRAP_SETUP_TOKEN` (minimal 16 karakter acak) di `.env`.
  2. Buka halaman login; tab **"Setup Owner Pertama"** muncul hanya saat database belum memiliki pengguna.
  3. Setelah Owner pertama tersimpan (`countUsers() > 0`), baik CLI maupun `POST /api/auth/bootstrap` **otomatis terkunci permanen (`403 BOOTSTRAP_LOCKED`)**.

---

## 6. Kompatibilitas Dual Adapter (Cloudflare D1 & Local SQLite)

`AuthService` bergantung murni pada interface `AuthRepository` dan `AccountingRepository` di `core/`. Kedua runtime memakai `DrizzleSqliteAuthRepository` (`db/auth-repository.ts`) di atas Drizzle client masing-masing (`D1AccountingRepository.getDrizzleClient()` maupun `LocalSqliteAccountingRepository.getDrizzleClient()`), sehingga perilaku hashing, sesi, rate limit, RBAC, dan isolasi tenant konsisten 100% di Cloudflare D1 dan SQLite lokal.
