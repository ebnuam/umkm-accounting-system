import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("uses backend accounting APIs, void/reversal, and exposes requested controls", async () => {
  const [app, page, manifest] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../config/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(app, /fetch\("\/api\/auth\/session"/);
  assert.match(app, /fetch\("\/api\/accounting\/workspace"/);
  assert.match(app, /\/api\/auth\/login/);
  assert.match(app, /\/api\/auth\/logout/);
  assert.doesNotMatch(app, /localStorage\.setItem/);
  assert.doesNotMatch(app, /deleteEntry/);
  assert.match(app, /\/api\/accounting\/entries\/.*\/void/);
  assert.match(app, /Export XLSX/);
  assert.match(app, /Export PDF/);
  assert.match(page, /Persiapan Usaha/);
  assert.match(page, /Master Barang/);
  assert.match(page, /Pengaturan/);
  assert.match(app, /renderSetupWizard/);
  assert.match(app, /defaultSalePrice/);
  assert.equal(JSON.parse(manifest).d1, "DB");
});

test("keeps the accounting report format", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /NERACA SALDO SETELAH PENYESUAIAN/);
  assert.match(app, /LAPORAN LABA RUGI/);
  assert.match(app, /LAPORAN PERUBAHAN MODAL/);
  assert.match(app, /LAPORAN POSISI KEUANGAN/);
});

test("accounting core remains strictly decoupled from framework, ORM, and Cloudflare runtime", async () => {
  const coreFiles = (await readdir(new URL("../core/", import.meta.url))).filter((f) => f.endsWith(".ts"));
  assert.ok(coreFiles.length >= 8);
  for (const file of coreFiles) {
    const content = await readFile(new URL(`../core/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /from\s+["'](?:next|react|drizzle-orm|cloudflare:)/, `${file} must not import framework/ORM/runtime`);
  }
});
