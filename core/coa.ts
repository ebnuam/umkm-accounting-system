import type { Account, AccountGroup, AccountNature, ItemCategory, NormalBalance } from "./types.ts";

/**
 * Universal Chart of Accounts aligned with Indonesian SAK EMKM / SAK ETAP,
 * covering Trading (Dagang), Service (Jasa), Manufacturing (Produksi/Manufaktur),
 * and Mixed/General businesses.
 * Explicitly separates Real Accounts (carried forward across periods)
 * from Nominal Accounts (closed at period end).
 */
export const DEFAULT_ACCOUNTS: Account[] = [
  // Real Accounts — Current Assets (11xx)
  { code: "1101", name: "Kas", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1102", name: "Bank", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1103", name: "Piutang Usaha", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1104", name: "Persediaan Bahan Baku", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1105", name: "Persediaan Barang Jadi", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1106", name: "Persediaan Barang Dalam Proses (WIP)", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1107", name: "Perlengkapan & Sewa Dibayar Dimuka", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1108", name: "PPN Masukan", category: "Aset Lancar", group: "asset", nature: "real", normal: "debit", active: true },

  // Real Accounts — Fixed & Contra Assets (12xx)
  { code: "1201", name: "Peralatan & Mesin", category: "Aset Tetap", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1202", name: "Akumulasi Penyusutan", category: "Kontra Aset", group: "contra_asset", nature: "real", normal: "credit", active: true },
  { code: "1203", name: "Kendaraan & Inventaris", category: "Aset Tetap", group: "asset", nature: "real", normal: "debit", active: true },
  { code: "1204", name: "Bangunan & Tanah", category: "Aset Tetap", group: "asset", nature: "real", normal: "debit", active: true },

  // Real Accounts — Liabilities (2xxx)
  { code: "2101", name: "Utang Usaha", category: "Liabilitas Lancar", group: "liability", nature: "real", normal: "credit", active: true },
  { code: "2102", name: "Utang Beban", category: "Liabilitas Lancar", group: "liability", nature: "real", normal: "credit", active: true },
  { code: "2103", name: "Pendapatan Diterima Dimuka", category: "Liabilitas Lancar", group: "liability", nature: "real", normal: "credit", active: true },
  { code: "2104", name: "PPN Keluaran", category: "Liabilitas Lancar", group: "liability", nature: "real", normal: "credit", active: true },
  { code: "2105", name: "Utang Gaji & Pajak (PPh)", category: "Liabilitas Lancar", group: "liability", nature: "real", normal: "credit", active: true },
  { code: "2201", name: "Utang Bank / Jangka Panjang", category: "Liabilitas Jangka Panjang", group: "liability", nature: "real", normal: "credit", active: true },

  // Real Accounts — Equity (3101, 3103)
  { code: "3101", name: "Modal Pemilik", category: "Ekuitas", group: "equity", nature: "real", normal: "credit", active: true },
  { code: "3103", name: "Laba Ditahan", category: "Ekuitas", group: "equity", nature: "real", normal: "credit", active: true },

  // Nominal / Temporary Accounts — Drawing & Closing
  { code: "3102", name: "Prive", category: "Kontra Ekuitas", group: "drawing", nature: "nominal", normal: "debit", active: true },
  { code: "3999", name: "Ikhtisar Laba Rugi", category: "Penutup", group: "closing", nature: "nominal", normal: "credit", active: true },

  // Nominal Accounts — Revenue & Contra Revenue (4xxx)
  { code: "4101", name: "Penjualan Barang", category: "Pendapatan", group: "revenue", nature: "nominal", normal: "credit", active: true },
  { code: "4102", name: "Pendapatan Jasa", category: "Pendapatan", group: "revenue", nature: "nominal", normal: "credit", active: true },
  { code: "4103", name: "Diskon & Retur Penjualan", category: "Kontra Pendapatan", group: "revenue", nature: "nominal", normal: "debit", active: true },
  { code: "4201", name: "Pendapatan Selisih Persediaan", category: "Pendapatan Lain", group: "revenue", nature: "nominal", normal: "credit", active: true },
  { code: "4202", name: "Pendapatan Lain-lain", category: "Pendapatan Lain", group: "revenue", nature: "nominal", normal: "credit", active: true },

  // Nominal Accounts — COGS, Production Costs & Operating Expenses (5xxx)
  { code: "5101", name: "Harga Pokok Penjualan (HPP)", category: "HPP / Beban Pokok", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5102", name: "Beban Kemasan", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5103", name: "Beban Listrik & Air", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5104", name: "Beban Gas & Bahan Bakar", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5105", name: "Beban Transportasi & Pengiriman", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5106", name: "Beban Penyusutan", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5107", name: "Beban Selisih Persediaan", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5108", name: "Beban Jasa / Subkontraktor", category: "HPP / Beban Pokok", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5109", name: "Biaya Tenaga Kerja Langsung (BTKL)", category: "Biaya Produksi", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5110", name: "Biaya Overhead Pabrik (BOP)", category: "Biaya Produksi", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5111", name: "Beban Gaji & Upah Karyawan", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5112", name: "Beban Sewa Tempat", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5113", name: "Beban Pemasaran & Promosi", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5114", name: "Beban Administrasi & Umum", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5115", name: "Beban Pajak & Administrasi Bank", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
  { code: "5199", name: "Beban Lain-lain", category: "Beban Operasional", group: "expense", nature: "nominal", normal: "debit", active: true },
];

export const ACCOUNT_MAP: Record<string, Account> = Object.fromEntries(
  DEFAULT_ACCOUNTS.map((account) => [account.code, account]),
);

export const INVENTORY_ACCOUNT_BY_CATEGORY: Record<ItemCategory, string | null> = {
  raw_material: "1104",
  finished_good: "1105",
  wip: "1106",
  equipment: null,
  service: null,
};

export const DEFAULT_REVENUE_ACCOUNT_BY_CATEGORY: Record<ItemCategory, string> = {
  raw_material: "4101",
  finished_good: "4101",
  wip: "4101",
  equipment: "4101",
  service: "4102",
};

export const PROTECTED_SYSTEM_ACCOUNT_CODES = new Set<string>([
  "1101",
  "1102",
  "1103",
  "1104",
  "1105",
  "1106",
  "1201",
  "1202",
  "2101",
  "2102",
  "3101",
  "3102",
  "3103",
  "3999",
  "4101",
  "4102",
  "5101",
  "5106",
  "5107",
  "5108",
  "5109",
  "5110",
]);

export function deriveAccountDefaults(group: AccountGroup): {
  nature: AccountNature;
  normal: NormalBalance;
  defaultCategory: string;
} {
  switch (group) {
    case "asset":
      return { nature: "real", normal: "debit", defaultCategory: "Aset" };
    case "contra_asset":
      return { nature: "real", normal: "credit", defaultCategory: "Kontra Aset" };
    case "liability":
      return { nature: "real", normal: "credit", defaultCategory: "Liabilitas" };
    case "equity":
      return { nature: "real", normal: "credit", defaultCategory: "Ekuitas" };
    case "drawing":
      return { nature: "nominal", normal: "debit", defaultCategory: "Kontra Ekuitas" };
    case "revenue":
      return { nature: "nominal", normal: "credit", defaultCategory: "Pendapatan" };
    case "expense":
      return { nature: "nominal", normal: "debit", defaultCategory: "Beban" };
    case "closing":
      return { nature: "nominal", normal: "credit", defaultCategory: "Penutup" };
  }
}

export function getAccountMap(accounts: Account[]): Record<string, Account> {
  return Object.fromEntries(accounts.map((account) => [account.code, account]));
}

export function isRealAccount(account: Account): boolean {
  return account.nature === "real";
}

export function isNominalAccount(account: Account): boolean {
  return account.nature === "nominal";
}
