import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AuthService } from "../core/index.ts";
import { DrizzleSqliteAuthRepository } from "../db/auth-repository.ts";
import { createLocalSqliteRepository } from "../db/local-sqlite-repository.ts";

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

const dbPath = process.env.SQLITE_DB_PATH || "./data/umkm-accounting.sqlite";
const repo = createLocalSqliteRepository({ dbPath });
const authRepo = new DrizzleSqliteAuthRepository(repo.getDrizzleClient());
const authService = new AuthService(authRepo, repo);

try {
  if (!(await authService.needsBootstrap())) {
    console.error("[bootstrap-owner] Gagal: akun Owner awal sudah ada di database. Bootstrap ditutup.");
    process.exit(1);
  }

  let email = argValue("--email") || process.env.BOOTSTRAP_OWNER_EMAIL;
  let fullName = argValue("--name") || process.env.BOOTSTRAP_OWNER_NAME;
  let businessName = argValue("--business") || process.env.BOOTSTRAP_BUSINESS_NAME;
  let city = argValue("--city") || process.env.BOOTSTRAP_BUSINESS_CITY || "Indonesia";
  let password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const seedDemo = !process.argv.includes("--empty");

  const rl = !email || !fullName || !businessName || !password ? createInterface({ input, output }) : null;
  try {
    if (!email && rl) email = await rl.question("Email Owner pertama: ");
    if (!fullName && rl) fullName = await rl.question("Nama Lengkap Owner: ");
    if (!businessName && rl) businessName = await rl.question("Nama Usaha: ");
    if (!password && rl) {
      password = await rl.question("Kata Sandi (min. 8 karakter): ");
    }
  } finally {
    rl?.close();
  }

  if (!email || !fullName || !businessName || !password) {
    console.error("[bootstrap-owner] Email, nama lengkap, nama usaha, dan kata sandi wajib diisi.");
    process.exit(1);
  }

  const created = await authService.bootstrapFirstOwner({
    email,
    fullName,
    password,
    businessName,
    city,
    seedDemo,
  });

  console.log(
    `[bootstrap-owner] Sukses! Owner "${created.user.email}" dibuat untuk bisnis "${businessName}" (${created.tenantId}) di ${dbPath}.`,
  );
} finally {
  repo.close();
}
