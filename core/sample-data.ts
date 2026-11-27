import { DEFAULT_ACCOUNTS } from "./coa.ts";
import type { AccountingEngine } from "./engine.ts";
import type { AccountingRepository } from "./repository.ts";
import type { TenantWorkspace } from "./types.ts";

/**
 * Creates a clean empty workspace for a new tenant (with standard COA and active period).
 */
export function createEmptyWorkspace(
  tenantId: string,
  options?: {
    businessName?: string;
    city?: string;
    businessSector?: "general" | "trading" | "service" | "manufacturing";
    activePeriod?: string;
    nowIso?: string;
  },
): TenantWorkspace {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const activePeriod = options?.activePeriod ?? "2026-09";
  return {
    profile: {
      tenantId,
      businessName: options?.businessName ?? "UMKM Makanan Keluarga",
      city: options?.city ?? "Bantul, Yogyakarta",
      businessSector: options?.businessSector ?? "general",
      activePeriod,
      updatedAt: nowIso,
    },
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    parties: [
      {
        id: `${tenantId}-party-walkin`,
        tenantId,
        name: "Pelanggan Umum",
        type: "customer",
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: `${tenantId}-party-supplier`,
        tenantId,
        name: "Pemasok Bahan",
        type: "supplier",
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    items: [],
    inventoryMovements: [],
    invoices: [],
    invoicePayments: [],
    journalEntries: [],
    periods: [
      {
        id: `${tenantId}-period-${activePeriod}`,
        tenantId,
        period: activePeriod,
        status: "open",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    auditLogs: [],
  };
}

/**
 * Seeds a realistic, fully double-entry & perpetual moving-average sample dataset
 * for "UMKM Makanan Keluarga — Bantul" using the real AccountingEngine methods.
 */
export async function seedSampleWorkspace(
  repo: AccountingRepository,
  engine: AccountingEngine,
  tenantId: string,
  actorId = "system-seed",
): Promise<TenantWorkspace> {
  const base = createEmptyWorkspace(tenantId, {
    businessName: "UMKM Makanan Keluarga",
    city: "Bantul, Yogyakarta",
    activePeriod: "2026-09",
  });
  await repo.resetWorkspace(tenantId, base);

  // Master Parties
  const custKatering = await engine.createParty(tenantId, actorId, {
    name: "Katering Bu Sari",
    type: "customer",
  });
  const supTepung = await engine.createParty(tenantId, actorId, {
    name: "Toko Bahan Pangan Makmur",
    type: "supplier",
  });

  // Master Items (separated Raw Material vs Finished Good)
  const tepung = await engine.createItem(tenantId, actorId, {
    name: "Tepung Pati Garut",
    category: "raw_material",
    unit: "kg",
    defaultPurchaseCost: 20000,
  });
  const kemasan = await engine.createItem(tenantId, actorId, {
    name: "Plastik Kemasan Snack",
    category: "raw_material",
    unit: "pack",
    defaultPurchaseCost: 15000,
  });
  const keripik = await engine.createItem(tenantId, actorId, {
    name: "Keripik Kimpul",
    category: "finished_good",
    unit: "bungkus",
    defaultPurchaseCost: 6000,
    defaultSalePrice: 12000,
  });
  const jenang = await engine.createItem(tenantId, actorId, {
    name: "Jenang Pati Garut",
    category: "finished_good",
    unit: "porsi",
    defaultPurchaseCost: 8000,
    defaultSalePrice: 15000,
  });

  // 1. Setoran modal awal Rp8.000.000
  await engine.postCapitalOrDrawing(tenantId, actorId, {
    type: "capital",
    date: "2026-09-01",
    amount: 8000000,
    description: "Setoran modal awal pemilik",
  });

  // 2. Pembelian bahan baku tunai: 50 kg Tepung @ Rp20.000 = Rp1.000.000
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-02",
    paymentMethod: "cash",
    partyId: supTepung.id,
    itemId: tepung.id,
    quantity: 50,
    totalCost: 1000000,
    description: "Pembelian Tepung Pati Garut tunai",
  });

  // 3. Pembelian barang jadi tunai: 100 bungkus Keripik Kimpul @ Rp6.000 = Rp600.000
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-02",
    paymentMethod: "cash",
    partyId: supTepung.id,
    itemId: keripik.id,
    quantity: 100,
    totalCost: 600000,
    description: "Pembelian stok awal Keripik Kimpul",
  });

  // 4. Pembelian peralatan dapur tunai Rp3.000.000
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-03",
    paymentMethod: "cash",
    isEquipment: true,
    totalCost: 3000000,
    description: "Pembelian peralatan dapur",
  });

  // 5. Penjualan tunai 60 bungkus Keripik Kimpul @ Rp12.000 = Rp720.000 (HPP 60 * 6.000 = Rp360.000)
  await engine.postSale(tenantId, actorId, {
    date: "2026-09-05",
    paymentMethod: "cash",
    itemId: keripik.id,
    quantity: 60,
    totalAmount: 720000,
    description: "Penjualan tunai Keripik Kimpul",
  });

  // 6. Produksi sederhana: pakai 20 kg Tepung (Rp400.000) -> hasilkan 50 porsi Jenang (@ Rp8.000)
  await engine.postMaterialUsageOrTransfer(tenantId, actorId, {
    date: "2026-09-06",
    sourceItemId: tepung.id,
    sourceQuantity: 20,
    targetItemId: jenang.id,
    targetQuantity: 50,
    batchRef: "BATCH-202609-01",
    description: "Produksi Jenang Pati Garut batch 1",
  });

  // 7. Penjualan kredit ke Katering Bu Sari: 40 porsi Jenang @ Rp15.000 = Rp600.000 (HPP 40 * 8.000 = Rp320.000)
  const creditSale = await engine.postSale(tenantId, actorId, {
    date: "2026-09-08",
    paymentMethod: "credit",
    partyId: custKatering.id,
    itemId: jenang.id,
    quantity: 40,
    totalAmount: 600000,
    description: "Pesanan katering Jenang secara kredit",
  });

  // 8. Pembelian kredit kemasan & keripik: 100 bungkus Keripik Kimpul @ Rp7.000 = Rp700.000
  // Moving Avg Keripik becomes: (40 * 6.000 + 100 * 7.000) / 140 = 940.000 / 140 = Rp6.714,29
  const creditPurchase = await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-10",
    paymentMethod: "credit",
    partyId: supTepung.id,
    itemId: keripik.id,
    quantity: 100,
    totalCost: 700000,
    description: "Restock Keripik Kimpul kredit (harga naik)",
  });

  // 9. Pembelian bahan kemasan tunai Rp180.000 (12 pack @ Rp15.000)
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-11",
    paymentMethod: "cash",
    partyId: supTepung.id,
    itemId: kemasan.id,
    quantity: 12,
    totalCost: 180000,
    description: "Pembelian Plastik Kemasan Snack",
  });

  // 10. Penerimaan sebagian piutang dari Katering Bu Sari Rp400.000 (sisa Rp200.000)
  if (creditSale.invoice) {
    await engine.postInvoicePayment(tenantId, actorId, {
      kind: "receivable",
      date: "2026-09-15",
      partyId: custKatering.id,
      invoiceId: creditSale.invoice.id,
      amount: 400000,
    });
  }

  // 11. Pembayaran sebagian utang ke Toko Bahan Pangan Makmur Rp500.000 (sisa Rp200.000)
  if (creditPurchase.invoice) {
    await engine.postInvoicePayment(tenantId, actorId, {
      kind: "payable",
      date: "2026-09-18",
      partyId: supTepung.id,
      invoiceId: creditPurchase.invoice.id,
      amount: 500000,
    });
  }

  // 12. Beban gas & transportasi & pengambilan prive
  await engine.postCashExpense(tenantId, actorId, {
    date: "2026-09-20",
    amount: 150000,
    expenseAccountCode: "5104",
    description: "Pembelian gas produksi",
  });
  await engine.postCashExpense(tenantId, actorId, {
    date: "2026-09-23",
    amount: 120000,
    expenseAccountCode: "5105",
    description: "Biaya antar pesanan",
  });
  await engine.postCapitalOrDrawing(tenantId, actorId, {
    type: "drawing",
    date: "2026-09-28",
    amount: 300000,
    description: "Pengambilan kas pemilik",
  });

  // 13. Penyesuaian akhir bulan September
  await engine.postAdjustment(tenantId, actorId, {
    type: "depreciation",
    date: "2026-09-30",
    assetCost: 3000000,
    lifeMonths: 60,
    description: "Penyusutan peralatan bulan September",
  });
  await engine.postAdjustment(tenantId, actorId, {
    type: "accrued_expense",
    date: "2026-09-30",
    expenseAccountCode: "5103",
    amount: 220000,
    description: "Beban listrik September belum dibayar",
  });

  return repo.getWorkspace(tenantId);
}

/**
 * Seeds a complete, balanced double-entry simulation dataset for "Aneka Snack"
 * featuring raw materials, finished snacks, opening stock balances, purchases,
 * production transfer, cash/credit sales, AR/AP partial settlements, expenses,
 * and period-end depreciation adjustments.
 */
export async function seedAnekaSnackDemoWorkspace(
  repo: AccountingRepository,
  engine: AccountingEngine,
  tenantId: string,
  actorId = "demo-seed",
): Promise<TenantWorkspace> {
  const base = createEmptyWorkspace(tenantId, {
    businessName: "Aneka Snack",
    city: "Yogyakarta",
    activePeriod: "2026-09",
  });
  await repo.resetWorkspace(tenantId, base);

  const custTokoSari = await engine.createParty(tenantId, actorId, {
    name: "Toko Oleh-Oleh Sari",
    type: "customer",
    phone: "0812-0000-1101",
    address: "Jl. Malioboro No. 18 (Simulasi)",
  });
  const custMbakRina = await engine.createParty(tenantId, actorId, {
    name: "Reseller Mbak Rina",
    type: "customer",
    phone: "0813-0000-2202",
    address: "Sleman, DIY (Simulasi)",
  });
  const supSembako = await engine.createParty(tenantId, actorId, {
    name: "Agen Sembako Sejahtera",
    type: "supplier",
    phone: "0815-0000-3303",
    address: "Pasar Beringharjo (Simulasi)",
  });
  const supKemasan = await engine.createParty(tenantId, actorId, {
    name: "Pabrik Kemasan Jaya",
    type: "supplier",
    phone: "0816-0000-4404",
    address: "Bantul, DIY (Simulasi)",
  });

  // 1. Setoran modal awal pemilik Rp10.000.000
  await engine.postCapitalOrDrawing(tenantId, actorId, {
    type: "capital",
    date: "2026-09-01",
    amount: 10_000_000,
    description: "Modal awal pemilik Aneka Snack",
  });

  // 2. Master Bahan Baku & Barang Jadi dengan Saldo Awal Persediaan
  const singkong = await engine.createItem(tenantId, actorId, {
    name: "Singkong Kupas",
    sku: "BB-SKG-01",
    category: "raw_material",
    unit: "kg",
    openingQuantity: 20,
    openingTotalCost: 100_000,
    openingDate: "2026-09-01",
    defaultPurchaseCost: 6_000,
  });
  const minyakBumbu = await engine.createItem(tenantId, actorId, {
    name: "Minyak & Bumbu Balado",
    sku: "BB-BMB-02",
    category: "raw_material",
    unit: "paket",
    defaultPurchaseCost: 25_000,
  });
  const kemasan = await engine.createItem(tenantId, actorId, {
    name: "Kemasan Standing Pouch",
    sku: "BB-KMS-03",
    category: "raw_material",
    unit: "pack",
    defaultPurchaseCost: 15_000,
  });
  const keripikBalado = await engine.createItem(tenantId, actorId, {
    name: "Keripik Singkong Balado",
    sku: "BJ-KSB-01",
    category: "finished_good",
    unit: "bungkus",
    openingQuantity: 50,
    openingTotalCost: 350_000,
    openingDate: "2026-09-01",
    defaultPurchaseCost: 6_000,
    defaultSalePrice: 15_000,
  });
  const makaroni = await engine.createItem(tenantId, actorId, {
    name: "Makaroni Pedas Renyah",
    sku: "BJ-MPR-02",
    category: "finished_good",
    unit: "bungkus",
    defaultPurchaseCost: 5_000,
    defaultSalePrice: 12_000,
  });

  // 3. Pembelian peralatan pengemasan tunai Rp2.400.000
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-02",
    paymentMethod: "cash",
    isEquipment: true,
    totalCost: 2_400_000,
    description: "Mesin sealer & peralatan pengemasan",
  });

  // 4. Pembelian bahan baku kredit: 40 kg Singkong Kupas = Rp260.000 (Moving Avg jadi Rp6.000/kg)
  const apSingkong = await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-03",
    paymentMethod: "credit",
    partyId: supSembako.id,
    itemId: singkong.id,
    quantity: 40,
    totalCost: 260_000,
    dueDate: "2026-09-25",
    description: "Pembelian kredit Singkong Kupas 40 kg",
  });

  // 5. Pembelian bahan baku tunai: 10 pack Kemasan & 8 paket Minyak Bumbu
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-04",
    paymentMethod: "cash",
    partyId: supKemasan.id,
    itemId: kemasan.id,
    quantity: 10,
    totalCost: 150_000,
    description: "Pembelian tunai Kemasan Standing Pouch",
  });
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-04",
    paymentMethod: "cash",
    partyId: supSembako.id,
    itemId: minyakBumbu.id,
    quantity: 8,
    totalCost: 200_000,
    description: "Pembelian tunai Minyak & Bumbu Balado",
  });

  // 6. Produksi sederhana: 30 kg Singkong (Rp180.000) -> 40 bungkus Keripik Singkong Balado (@ Rp4.500)
  // Moving Avg Keripik Singkong Balado = (350.000 + 180.000) / 90 = Rp5.888,89/bungkus
  await engine.postMaterialUsageOrTransfer(tenantId, actorId, {
    date: "2026-09-06",
    sourceItemId: singkong.id,
    sourceQuantity: 30,
    targetItemId: keripikBalado.id,
    targetQuantity: 40,
    batchRef: "SNACK-202609-01",
    description: "Produksi Keripik Singkong Balado batch 1",
  });

  // 7. Pembelian barang jadi kredit: 100 bungkus Makaroni Pedas Renyah @ Rp5.000 = Rp500.000
  await engine.postPurchase(tenantId, actorId, {
    date: "2026-09-07",
    paymentMethod: "credit",
    partyId: supSembako.id,
    itemId: makaroni.id,
    quantity: 100,
    totalCost: 500_000,
    dueDate: "2026-09-30",
    description: "Pembelian kredit Makaroni Pedas Renyah",
  });

  // 8. Penjualan tunai 30 bungkus Keripik Singkong Balado = Rp450.000
  await engine.postSale(tenantId, actorId, {
    date: "2026-09-09",
    paymentMethod: "cash",
    itemId: keripikBalado.id,
    quantity: 30,
    totalAmount: 450_000,
    description: "Penjualan tunai Keripik Singkong Balado",
  });

  // 9. Penjualan kredit ke Toko Oleh-Oleh Sari: 50 bungkus Makaroni = Rp600.000 (HPP Rp250.000)
  const arTokoSari = await engine.postSale(tenantId, actorId, {
    date: "2026-09-12",
    paymentMethod: "credit",
    partyId: custTokoSari.id,
    itemId: makaroni.id,
    quantity: 50,
    totalAmount: 600_000,
    dueDate: "2026-09-28",
    description: "Penjualan kredit Makaroni ke Toko Oleh-Oleh Sari",
  });

  // 10. Penjualan kredit ke Reseller Mbak Rina: 20 bungkus Keripik Balado = Rp300.000
  await engine.postSale(tenantId, actorId, {
    date: "2026-09-14",
    paymentMethod: "credit",
    partyId: custMbakRina.id,
    itemId: keripikBalado.id,
    quantity: 20,
    totalAmount: 300_000,
    dueDate: "2026-09-29",
    description: "Penjualan kredit Keripik ke Reseller Mbak Rina",
  });

  // 11. Pelunasan sebagian piutang Rp400.000 (sisa Toko Sari Rp200.000 + Reseller Mbak Rina Rp300.000)
  if (arTokoSari.invoice) {
    await engine.postInvoicePayment(tenantId, actorId, {
      kind: "receivable",
      date: "2026-09-16",
      partyId: custTokoSari.id,
      invoiceId: arTokoSari.invoice.id,
      amount: 400_000,
    });
  }

  // 12. Pelunasan utang Singkong Rp260.000 (utang Makaroni Rp500.000 masih terbuka)
  if (apSingkong.invoice) {
    await engine.postInvoicePayment(tenantId, actorId, {
      kind: "payable",
      date: "2026-09-18",
      partyId: supSembako.id,
      invoiceId: apSingkong.invoice.id,
      amount: 260_000,
    });
  }

  // 13. Beban operasional & penyesuaian penyusutan September
  await engine.postCashExpense(tenantId, actorId, {
    date: "2026-09-20",
    amount: 180_000,
    expenseAccountCode: "5103",
    description: "Biaya listrik & gas dapur Aneka Snack",
  });
  await engine.postCashExpense(tenantId, actorId, {
    date: "2026-09-22",
    amount: 120_000,
    expenseAccountCode: "5105",
    description: "Biaya antar pesanan snack",
  });
  await engine.postAdjustment(tenantId, actorId, {
    type: "depreciation",
    date: "2026-09-30",
    assetCost: 2_400_000,
    lifeMonths: 60,
    description: "Penyusutan mesin sealer September",
  });

  return repo.getWorkspace(tenantId);
}
