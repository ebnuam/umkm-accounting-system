import {
  DEFAULT_REVENUE_ACCOUNT_BY_CATEGORY,
  deriveAccountDefaults,
  getAccountMap,
  INVENTORY_ACCOUNT_BY_CATEGORY,
  PROTECTED_SYSTEM_ACCOUNT_CODES,
} from "./coa.ts";
import {
  buildMovementRecord,
  calculateMovingAverageIssue,
  calculateMovingAverageReceipt,
  reverseInventoryState,
} from "./inventory.ts";
import { assertValidDate, assertValidPeriod, parsePeriod, periodFromDate } from "./period.ts";
import type { AccountingRepository } from "./repository.ts";
import {
  buildFinancialStatements,
  buildGeneralLedger,
  buildTrialBalance,
  type FinancialStatementsResult,
  type GeneralLedgerResult,
  type TrialBalanceResult,
} from "./statements.ts";
import {
  applyPaymentToInvoice,
  assertInvoiceCanBeVoided,
  createInvoiceRecord,
  requireParty,
  reversePaymentOnInvoice,
} from "./subledger.ts";
import type {
  Account,
  AccountGroup,
  AccountingPeriod,
  AuditLog,
  BusinessSector,
  CostComponentPlaceholder,
  InventoryMovement,
  Invoice,
  Item,
  ItemCategory,
  JournalEntry,
  JournalLine,
  Party,
  PartyType,
  TenantWorkspace,
  TransactionKind,
} from "./types.ts";
import {
  ClosedPeriodError,
  NotFoundError,
  ValidationError,
} from "./types.ts";
import {
  assertNonEmptyText,
  assertNonNegativeNumber,
  assertPeriodOpen,
  assertPositiveInteger,
  assertPositiveNumber,
  validateJournalLines,
} from "./validation.ts";

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeDocNumber(prefix: string, date: string, seq: number): string {
  const ym = date.slice(2, 4) + date.slice(5, 7);
  return `${prefix}-${ym}-${String(seq).padStart(4, "0")}`;
}

export class AccountingEngine {
  private readonly repo: AccountingRepository;

  constructor(repo: AccountingRepository) {
    this.repo = repo;
  }

  async getWorkspace(tenantId: string): Promise<TenantWorkspace> {
    return this.repo.getWorkspace(tenantId);
  }

  async createItem(
    tenantId: string,
    actorId: string,
    input: {
      name: string;
      category: ItemCategory;
      unit: string;
      sku?: string | null;
      defaultSalePrice?: number;
      defaultPurchaseCost?: number;
      revenueAccountCode?: string | null;
      cogsAccountCode?: string | null;
      openingQuantity?: number;
      openingTotalCost?: number;
      openingDate?: string;
    },
  ): Promise<Item> {
    const ws = await this.repo.getWorkspace(tenantId);
    const name = assertNonEmptyText(input.name, "Nama barang");
    const unit = assertNonEmptyText(input.unit, "Satuan");

    if (ws.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      throw new ValidationError(`Barang dengan nama "${name}" sudah terdaftar.`);
    }

    const accountMap = getAccountMap(ws.accounts);
    const trackInventory =
      input.category === "raw_material" ||
      input.category === "finished_good" ||
      input.category === "wip";
    const inventoryAccountCode = INVENTORY_ACCOUNT_BY_CATEGORY[input.category];

    const revenueAccountCode =
      input.revenueAccountCode?.trim() ||
      DEFAULT_REVENUE_ACCOUNT_BY_CATEGORY[input.category] ||
      "4101";
    const revAcc = accountMap[revenueAccountCode];
    if (!revAcc || !revAcc.active || revAcc.group !== "revenue") {
      throw new ValidationError(`Akun pendapatan "${revenueAccountCode}" tidak valid atau nonaktif.`);
    }

    const defaultCogs = trackInventory
      ? "5101"
      : input.category === "service"
        ? "5108"
        : null;
    const cogsAccountCode =
      input.cogsAccountCode !== undefined
        ? input.cogsAccountCode?.trim() || null
        : defaultCogs;
    if (cogsAccountCode) {
      const cogsAcc = accountMap[cogsAccountCode];
      if (!cogsAcc || !cogsAcc.active || cogsAcc.group !== "expense") {
        throw new ValidationError(`Akun HPP/beban "${cogsAccountCode}" tidak valid atau nonaktif.`);
      }
    }

    const nowIso = new Date().toISOString();

    let item: Item = {
      id: makeId("item"),
      tenantId,
      sku: input.sku?.trim() || null,
      name,
      category: input.category,
      unit,
      trackInventory,
      inventoryAccountCode,
      cogsAccountCode,
      revenueAccountCode,
      quantityOnHand: 0,
      totalInventoryValue: 0,
      movingAverageCost: 0,
      defaultSalePrice: Math.max(0, Math.round(Number(input.defaultSalePrice) || 0)),
      defaultPurchaseCost: Math.max(0, Math.round(Number(input.defaultPurchaseCost) || 0)),
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const openingQty = Number(input.openingQuantity ?? 0);
    const openingTotal = Number(input.openingTotalCost ?? 0);

    if (openingQty > 0 || openingTotal > 0) {
      if (!trackInventory || !inventoryAccountCode) {
        throw new ValidationError("Saldo awal kuantitas hanya berlaku untuk Bahan Baku, WIP, atau Barang Jadi.");
      }
      assertPositiveNumber(openingQty, "Kuantitas saldo awal");
      assertPositiveInteger(openingTotal, "Nilai total saldo awal");
      const openingDate = assertValidDate(
        input.openingDate ?? parsePeriod(ws.profile.activePeriod).start,
      );
      const period = assertPeriodOpen(openingDate, ws.periods);

      const receipt = calculateMovingAverageReceipt(item, openingQty, openingTotal, nowIso);
      item = receipt.updatedItem;

      const entryId = makeId("jrn");
      const docNo = makeDocNumber("OPN", openingDate, ws.journalEntries.length + 1);
      const lines: JournalLine[] = [
        { accountCode: inventoryAccountCode, debit: openingTotal, credit: 0 },
        { accountCode: "3101", debit: 0, credit: openingTotal },
      ];
      validateJournalLines(lines, getAccountMap(ws.accounts));

      const entry: JournalEntry = {
        id: entryId,
        tenantId,
        documentNumber: docNo,
        source: "transaction",
        type: "opening_balance",
        date: openingDate,
        period,
        description: `Saldo awal persediaan ${item.name} (${openingQty} ${item.unit})`,
        status: "posted",
        amount: openingTotal,
        itemId: item.id,
        itemName: item.name,
        lines,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const movement = buildMovementRecord({
        id: makeId("mov"),
        tenantId,
        itemId: item.id,
        journalEntryId: entryId,
        date: openingDate,
        type: "opening",
        result: receipt,
        referenceDoc: docNo,
        notes: "Saldo awal barang",
        nowIso,
      });

      await this.repo.saveItem(tenantId, item);
      await this.repo.commitPosting(tenantId, {
        journalEntriesToInsert: [entry],
        movementsToInsert: [movement],
        periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
        auditLogsToInsert: [
          this.buildAudit(tenantId, actorId, "CREATE_ITEM_WITH_OPENING", "item", item.id, `Menambah barang ${item.name} dengan stok awal ${openingQty} ${item.unit}`, null, item, nowIso),
        ],
      });
      return item;
    }

    await this.repo.saveItem(tenantId, item);
    await this.repo.appendAuditLog(
      tenantId,
      this.buildAudit(tenantId, actorId, "CREATE_ITEM", "item", item.id, `Menambah barang ${item.name}`, null, item, nowIso),
    );
    return item;
  }

  async toggleItemActive(tenantId: string, actorId: string, itemId: string): Promise<Item> {
    const item = await this.repo.getItem(tenantId, itemId);
    if (!item) throw new NotFoundError("Barang tidak ditemukan.");
    const nowIso = new Date().toISOString();
    const updated: Item = { ...item, active: !item.active, updatedAt: nowIso };
    await this.repo.saveItem(tenantId, updated);
    await this.repo.appendAuditLog(
      tenantId,
      this.buildAudit(tenantId, actorId, "TOGGLE_ITEM", "item", item.id, `${updated.active ? "Mengaktifkan" : "Menonaktifkan"} barang ${item.name}`, item, updated, nowIso),
    );
    return updated;
  }

  async createParty(
    tenantId: string,
    actorId: string,
    input: { name: string; type: PartyType; phone?: string | null; address?: string | null },
  ): Promise<Party> {
    const ws = await this.repo.getWorkspace(tenantId);
    const name = assertNonEmptyText(input.name, "Nama pelanggan/pemasok");
    if (ws.parties.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.type === input.type)) {
      throw new ValidationError(`"${name}" sudah terdaftar.`);
    }
    const nowIso = new Date().toISOString();
    const party: Party = {
      id: makeId("party"),
      tenantId,
      name,
      type: input.type,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.repo.saveParty(tenantId, party);
    await this.repo.appendAuditLog(
      tenantId,
      this.buildAudit(tenantId, actorId, "CREATE_PARTY", "party", party.id, `Menambah ${party.type}: ${party.name}`, null, party, nowIso),
    );
    return party;
  }

  async updateProfile(
    tenantId: string,
    actorId: string,
    input: {
      businessName?: string;
      city?: string;
      businessSector?: BusinessSector;
      activePeriod?: string;
    },
  ) {
    const ws = await this.repo.getWorkspace(tenantId);
    const nowIso = new Date().toISOString();
    const nextPeriod = input.activePeriod
      ? assertValidPeriod(input.activePeriod)
      : ws.profile.activePeriod;
    const allowedSectors: BusinessSector[] = ["general", "trading", "service", "manufacturing"];
    const nextSector = input.businessSector
      ? allowedSectors.includes(input.businessSector)
        ? input.businessSector
        : (() => {
            throw new ValidationError(`Sektor usaha "${input.businessSector}" tidak valid.`);
          })()
      : ws.profile.businessSector ?? "general";

    const updated = {
      ...ws.profile,
      businessName: input.businessName !== undefined ? assertNonEmptyText(input.businessName, "Nama usaha") : ws.profile.businessName,
      city: input.city !== undefined ? String(input.city).trim() : ws.profile.city,
      businessSector: nextSector,
      activePeriod: nextPeriod,
      updatedAt: nowIso,
    };
    await this.repo.updateProfile(tenantId, updated);
    if (!ws.periods.some((p) => p.period === nextPeriod)) {
      await this.repo.savePeriod(tenantId, this.ensurePeriodRecord(ws, nextPeriod, nowIso));
    }
    await this.repo.appendAuditLog(
      tenantId,
      this.buildAudit(tenantId, actorId, "UPDATE_PROFILE", "profile", tenantId, `Memperbarui profil / sektor (${nextSector}) / periode aktif ke ${nextPeriod}`, ws.profile, updated, nowIso),
    );
    return updated;
  }

  async createAccount(
    tenantId: string,
    actorId: string,
    input: {
      code: string;
      name: string;
      group: AccountGroup;
      category?: string;
    },
  ): Promise<Account> {
    const ws = await this.repo.getWorkspace(tenantId);
    const code = String(input.code ?? "").trim();
    if (!/^[1-9][0-9]{3,5}$/.test(code)) {
      throw new ValidationError("Kode akun harus berupa 4–6 digit angka (contoh: 1205, 4105, 5120).");
    }
    const name = assertNonEmptyText(input.name, "Nama akun");
    if (ws.accounts.some((a) => a.code === code)) {
      throw new ValidationError(`Kode akun "${code}" sudah terdaftar.`);
    }
    const allowedGroups: AccountGroup[] = [
      "asset",
      "contra_asset",
      "liability",
      "equity",
      "drawing",
      "revenue",
      "expense",
    ];
    if (!allowedGroups.includes(input.group)) {
      throw new ValidationError(`Kelompok akun "${input.group}" tidak valid atau dicadangkan oleh sistem.`);
    }

    const derived = deriveAccountDefaults(input.group);
    const account: Account = {
      code,
      name,
      category: input.category?.trim() || derived.defaultCategory,
      group: input.group,
      nature: derived.nature,
      normal: derived.normal,
      active: true,
    };

    const nowIso = new Date().toISOString();
    await this.repo.saveAccount(tenantId, account);
    await this.repo.appendAuditLog(
      tenantId,
      this.buildAudit(tenantId, actorId, "CREATE_ACCOUNT", "account", code, `Menambah akun ${code} ${name} (${input.group})`, null, account, nowIso),
    );
    return account;
  }

  async toggleAccountActive(tenantId: string, actorId: string, code: string): Promise<Account> {
    const ws = await this.repo.getWorkspace(tenantId);
    const existing = ws.accounts.find((a) => a.code === code.trim());
    if (!existing) {
      throw new NotFoundError(`Akun "${code}" tidak ditemukan.`);
    }
    if (existing.active && PROTECTED_SYSTEM_ACCOUNT_CODES.has(existing.code)) {
      throw new ValidationError(`Akun sistem "${existing.code} ${existing.name}" tidak dapat dinonaktifkan.`);
    }
    const updated: Account = { ...existing, active: !existing.active };
    const nowIso = new Date().toISOString();
    await this.repo.saveAccount(tenantId, updated);
    await this.repo.appendAuditLog(
      tenantId,
      this.buildAudit(tenantId, actorId, "TOGGLE_ACCOUNT", "account", existing.code, `${updated.active ? "Mengaktifkan" : "Menonaktifkan"} akun ${existing.code} ${existing.name}`, existing, updated, nowIso),
    );
    return updated;
  }

  async postCapitalOrDrawing(
    tenantId: string,
    actorId: string,
    input: {
      type: "capital" | "drawing";
      date: string;
      amount: number;
      cashAccountCode?: "1101" | "1102";
      description?: string;
    },
  ): Promise<JournalEntry> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const amount = assertPositiveInteger(input.amount, "Nilai transaksi");
    const cashCode = input.cashAccountCode ?? "1101";
    const nowIso = new Date().toISOString();
    const entryId = makeId("jrn");
    const prefix = input.type === "capital" ? "CAP" : "DRW";
    const docNo = makeDocNumber(prefix, input.date, ws.journalEntries.length + 1);
    const desc =
      input.description?.trim() ||
      (input.type === "capital" ? "Setoran modal pemilik" : "Pengambilan kas oleh pemilik");

    const lines: JournalLine[] =
      input.type === "capital"
        ? [
            { accountCode: cashCode, debit: amount, credit: 0 },
            { accountCode: "3101", debit: 0, credit: amount },
          ]
        : [
            { accountCode: "3102", debit: amount, credit: 0 },
            { accountCode: cashCode, debit: 0, credit: amount },
          ];

    validateJournalLines(lines, getAccountMap(ws.accounts));

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: input.type,
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount,
      paymentAccountCode: cashCode,
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_TRANSACTION", "journal_entry", entryId, `Posting ${docNo}: ${desc}`, null, entry, nowIso),
      ],
    });
    return entry;
  }

  async postCashExpense(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      amount: number;
      expenseAccountCode: string;
      cashAccountCode?: "1101" | "1102";
      partyName?: string;
      description?: string;
    },
  ): Promise<JournalEntry> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const amount = assertPositiveInteger(input.amount, "Nilai beban");
    const accountMap = getAccountMap(ws.accounts);
    const expAccount = accountMap[input.expenseAccountCode];
    if (!expAccount || expAccount.group !== "expense" || ["5101", "5106", "5107"].includes(expAccount.code)) {
      throw new ValidationError(`Akun "${input.expenseAccountCode}" tidak valid untuk beban kas operasional.`);
    }
    const cashCode = input.cashAccountCode ?? "1101";
    const nowIso = new Date().toISOString();
    const entryId = makeId("jrn");
    const docNo = makeDocNumber("EXP", input.date, ws.journalEntries.length + 1);
    const desc = input.description?.trim() || `Pembayaran ${expAccount.name}`;

    const lines: JournalLine[] = [
      { accountCode: expAccount.code, debit: amount, credit: 0 },
      { accountCode: cashCode, debit: 0, credit: amount },
    ];
    validateJournalLines(lines, accountMap);

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: "cash_expense",
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount,
      partyName: input.partyName?.trim() || null,
      paymentAccountCode: cashCode,
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_EXPENSE", "journal_entry", entryId, `Posting ${docNo}: ${desc}`, null, entry, nowIso),
      ],
    });
    return entry;
  }

  async postPurchase(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      paymentMethod: "cash" | "bank" | "credit";
      partyId?: string | null;
      itemId?: string | null;
      quantity?: number;
      totalCost: number;
      description?: string;
      dueDate?: string | null;
      isEquipment?: boolean;
      assetAccountCode?: string | null;
    },
  ): Promise<{ entry: JournalEntry; invoice: Invoice | null; movement: InventoryMovement | null }> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const totalCost = assertPositiveInteger(input.totalCost, "Nilai pembelian");
    const accountMap = getAccountMap(ws.accounts);
    const nowIso = new Date().toISOString();

    let party: Party | null = null;
    if (input.paymentMethod === "credit") {
      if (!input.partyId) {
        throw new ValidationError("Pembelian kredit wajib memilih pemasok.");
      }
      party = requireParty(ws.parties, input.partyId);
    } else if (input.partyId) {
      party = requireParty(ws.parties, input.partyId);
    }

    const creditAccountCode =
      input.paymentMethod === "credit"
        ? "2101"
        : input.paymentMethod === "bank"
          ? "1102"
          : "1101";

    const entryId = makeId("jrn");
    const docNo = makeDocNumber("PUR", input.date, ws.journalEntries.length + 1);

    let item: Item | null = null;
    if (input.itemId) {
      item = ws.items.find((i) => i.id === input.itemId) ?? null;
      if (!item) throw new NotFoundError("Barang/jasa tidak ditemukan.");
      if (!item.active) throw new ValidationError(`Item "${item.name}" sedang nonaktif.`);
    }

    const isServicePurchase = item?.category === "service";
    const isEquipment = Boolean(input.isEquipment) || item?.category === "equipment";
    let debitAccountCode = input.assetAccountCode?.trim() || "1201";
    let trxType: TransactionKind =
      input.paymentMethod === "credit" ? "equipment_credit" : "equipment_cash";
    let updatedItem: Item | null = null;
    let movement: InventoryMovement | null = null;

    if (isServicePurchase && item) {
      debitAccountCode = item.cogsAccountCode || "5108";
      const serviceAcc = accountMap[debitAccountCode];
      if (!serviceAcc || !serviceAcc.active || serviceAcc.group !== "expense") {
        throw new ValidationError(`Akun beban jasa "${debitAccountCode}" tidak valid atau nonaktif.`);
      }
      trxType = input.paymentMethod === "credit" ? "inventory_credit" : "inventory_cash";
    } else if (isEquipment) {
      const assetAcc = accountMap[debitAccountCode];
      if (!assetAcc || !assetAcc.active || assetAcc.group !== "asset") {
        throw new ValidationError(`Akun aset "${debitAccountCode}" tidak valid atau nonaktif.`);
      }
    } else {
      if (!item || !item.trackInventory || !item.inventoryAccountCode) {
        throw new ValidationError(
          "Pembelian persediaan wajib memilih item kategori Bahan Baku, WIP, atau Barang Jadi.",
        );
      }
      const qty = assertPositiveNumber(Number(input.quantity), "Kuantitas pembelian");
      const receipt = calculateMovingAverageReceipt(item, qty, totalCost, nowIso);
      updatedItem = receipt.updatedItem;
      debitAccountCode = item.inventoryAccountCode;
      trxType = input.paymentMethod === "credit" ? "inventory_credit" : "inventory_cash";

      movement = buildMovementRecord({
        id: makeId("mov"),
        tenantId,
        itemId: item.id,
        journalEntryId: entryId,
        date: input.date,
        type: "purchase",
        result: receipt,
        referenceDoc: docNo,
        notes: input.description?.trim() || `Pembelian ${item.name} (${qty} ${item.unit})`,
        nowIso,
      });
    }

    const lines: JournalLine[] = [
      { accountCode: debitAccountCode, debit: totalCost, credit: 0 },
      { accountCode: creditAccountCode, debit: 0, credit: totalCost },
    ];
    validateJournalLines(lines, accountMap);

    let invoice: Invoice | null = null;
    if (input.paymentMethod === "credit" && party) {
      invoice = createInvoiceRecord({
        id: makeId("inv"),
        tenantId,
        kind: "payable",
        invoiceNumber: docNo,
        party,
        journalEntryId: entryId,
        issueDate: input.date,
        dueDate: input.dueDate ?? null,
        totalAmount: totalCost,
        nowIso,
      });
    }

    const desc =
      input.description?.trim() ||
      (item
        ? `Pembelian ${item.name}${input.quantity ? ` (${input.quantity} ${item.unit})` : ""}`
        : "Pembelian peralatan usaha");

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: trxType,
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount: totalCost,
      partyId: party?.id ?? null,
      partyName: party?.name ?? null,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      invoiceId: invoice?.id ?? null,
      paymentAccountCode: creditAccountCode,
      metadata: {
        quantity: input.quantity ?? null,
        unitCost: input.quantity ? totalCost / input.quantity : null,
      },
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      itemsToUpdate: updatedItem ? [updatedItem] : [],
      movementsToInsert: movement ? [movement] : [],
      invoicesToInsert: invoice ? [invoice] : [],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_PURCHASE", "journal_entry", entryId, `Posting pembelian ${docNo} sebesar ${totalCost}`, null, entry, nowIso),
      ],
      concurrencyChecks: updatedItem && item && movement
        ? {
            items: [
              {
                id: item.id,
                expectedQty: item.quantityOnHand,
                expectedValue: item.totalInventoryValue,
                qtyDelta: movement.quantityDelta,
                valueDelta: movement.totalCost,
              },
            ],
          }
        : undefined,
    });

    return { entry, invoice, movement };
  }

  async postSale(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      paymentMethod: "cash" | "bank" | "credit";
      partyId?: string | null;
      itemId?: string | null;
      quantity?: number;
      totalAmount: number;
      revenueAccountCode?: string | null;
      description?: string;
      dueDate?: string | null;
    },
  ): Promise<{ entry: JournalEntry; invoice: Invoice | null; movement: InventoryMovement | null; cogsAmount: number }> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const totalAmount = assertPositiveInteger(input.totalAmount, "Nilai penjualan");
    const accountMap = getAccountMap(ws.accounts);
    const nowIso = new Date().toISOString();

    let party: Party | null = null;
    if (input.paymentMethod === "credit") {
      if (!input.partyId) {
        throw new ValidationError("Penjualan kredit wajib memilih pelanggan.");
      }
      party = requireParty(ws.parties, input.partyId);
    } else if (input.partyId) {
      party = requireParty(ws.parties, input.partyId);
    }

    const debitAccountCode =
      input.paymentMethod === "credit"
        ? "1103"
        : input.paymentMethod === "bank"
          ? "1102"
          : "1101";

    const entryId = makeId("jrn");
    const docNo = makeDocNumber("SAL", input.date, ws.journalEntries.length + 1);

    let item: Item | null = null;
    let updatedItem: Item | null = null;
    let movement: InventoryMovement | null = null;
    let cogsAmount = 0;

    if (input.itemId) {
      item = ws.items.find((i) => i.id === input.itemId) ?? null;
      if (!item) throw new NotFoundError("Barang/jasa tidak ditemukan.");
      if (!item.active) throw new ValidationError(`Item "${item.name}" sedang nonaktif.`);
    }

    const resolvedRevenueCode =
      input.revenueAccountCode?.trim() ||
      item?.revenueAccountCode ||
      (item ? DEFAULT_REVENUE_ACCOUNT_BY_CATEGORY[item.category] : "4101");
    const revAcc = accountMap[resolvedRevenueCode];
    if (!revAcc || !revAcc.active || revAcc.group !== "revenue") {
      throw new ValidationError(`Akun pendapatan "${resolvedRevenueCode}" tidak valid atau nonaktif.`);
    }

    const lines: JournalLine[] = [
      { accountCode: debitAccountCode, debit: totalAmount, credit: 0 },
      { accountCode: resolvedRevenueCode, debit: 0, credit: totalAmount },
    ];

    if (item && item.trackInventory && item.inventoryAccountCode) {
      const qty = assertPositiveNumber(Number(input.quantity), "Kuantitas penjualan");
      const issue = calculateMovingAverageIssue(item, qty, nowIso);
      updatedItem = issue.updatedItem;
      cogsAmount = issue.totalCost;
      const cogsCode = item.cogsAccountCode || "5101";

      if (cogsAmount > 0) {
        lines.push(
          { accountCode: cogsCode, debit: cogsAmount, credit: 0, memo: `HPP ${item.name}` },
          {
            accountCode: item.inventoryAccountCode,
            debit: 0,
            credit: cogsAmount,
            memo: `Keluar stok ${item.name}`,
          },
        );
      }

      movement = buildMovementRecord({
        id: makeId("mov"),
        tenantId,
        itemId: item.id,
        journalEntryId: entryId,
        date: input.date,
        type: "sale",
        result: issue,
        referenceDoc: docNo,
        notes: input.description?.trim() || `Penjualan ${item.name} (${qty} ${item.unit})`,
        nowIso,
      });
    }

    validateJournalLines(lines, accountMap);

    let invoice: Invoice | null = null;
    if (input.paymentMethod === "credit" && party) {
      invoice = createInvoiceRecord({
        id: makeId("inv"),
        tenantId,
        kind: "receivable",
        invoiceNumber: docNo,
        party,
        journalEntryId: entryId,
        issueDate: input.date,
        dueDate: input.dueDate ?? null,
        totalAmount,
        nowIso,
      });
    }

    const desc =
      input.description?.trim() ||
      (item
        ? `Penjualan ${item.name}${input.quantity ? ` (${input.quantity} ${item.unit})` : ""}`
        : "Penjualan produk");

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: input.paymentMethod === "credit" ? "credit_sale" : "cash_sale",
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount: totalAmount,
      partyId: party?.id ?? null,
      partyName: party?.name ?? null,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      invoiceId: invoice?.id ?? null,
      paymentAccountCode: debitAccountCode,
      metadata: {
        quantity: input.quantity ?? null,
        cogsAmount,
      },
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      itemsToUpdate: updatedItem ? [updatedItem] : [],
      movementsToInsert: movement ? [movement] : [],
      invoicesToInsert: invoice ? [invoice] : [],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_SALE", "journal_entry", entryId, `Posting penjualan ${docNo} sebesar ${totalAmount} (HPP ${cogsAmount})`, null, entry, nowIso),
      ],
      concurrencyChecks: updatedItem && item && movement
        ? {
            items: [
              {
                id: item.id,
                expectedQty: item.quantityOnHand,
                expectedValue: item.totalInventoryValue,
                qtyDelta: movement.quantityDelta,
                valueDelta: -movement.totalCost,
              },
            ],
          }
        : undefined,
    });

    return { entry, invoice, movement, cogsAmount };
  }

  /**
   * Lightweight raw material usage or raw-to-finished conversion without BOM/labor/overhead.
   * - If targetItemId is omitted: Dr 5101 HPP, Cr 1104 Persediaan Bahan Baku.
   * - If targetItemId (finished_good) & targetQuantity are provided: Dr 1105 Persediaan Barang Jadi, Cr 1104 Persediaan Bahan Baku.
   */
  async postMaterialUsageOrTransfer(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      sourceItemId: string;
      sourceQuantity: number;
      targetItemId?: string | null;
      targetQuantity?: number;
      batchRef?: string | null;
      description?: string;
    },
  ): Promise<{ entry: JournalEntry; movements: InventoryMovement[] }> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const nowIso = new Date().toISOString();

    const sourceItem = ws.items.find((i) => i.id === input.sourceItemId);
    if (!sourceItem) throw new NotFoundError("Bahan baku tidak ditemukan.");
    if (sourceItem.category !== "raw_material") {
      throw new ValidationError("Item sumber pemakaian/produksi harus berkategori Bahan Baku.");
    }

    const issue = calculateMovingAverageIssue(sourceItem, input.sourceQuantity, nowIso);
    const entryId = makeId("jrn");
    const isTransfer = Boolean(input.targetItemId);
    const docNo = makeDocNumber(isTransfer ? "PRD" : "USE", input.date, ws.journalEntries.length + 1);

    const movements: InventoryMovement[] = [
      buildMovementRecord({
        id: makeId("mov"),
        tenantId,
        itemId: sourceItem.id,
        journalEntryId: entryId,
        date: input.date,
        type: "usage_out",
        result: issue,
        referenceDoc: docNo,
        notes: input.description?.trim() || `Pemakaian bahan ${sourceItem.name}`,
        batchRef: input.batchRef ?? null,
        nowIso,
      }),
    ];

    const itemsToUpdate: Item[] = [issue.updatedItem];
    let debitAccount = "5101";
    let targetItem: Item | null = null;

    if (isTransfer && input.targetItemId) {
      targetItem = ws.items.find((i) => i.id === input.targetItemId) ?? null;
      if (!targetItem) throw new NotFoundError("Barang jadi tujuan tidak ditemukan.");
      if (targetItem.category !== "finished_good" || !targetItem.inventoryAccountCode) {
        throw new ValidationError("Item tujuan konversi harus berkategori Barang Jadi.");
      }
      const targetQty = assertPositiveNumber(Number(input.targetQuantity), "Kuantitas barang jadi hasil produksi");
      if (issue.totalCost <= 0) {
        throw new ValidationError("Nilai biaya bahan baku yang dipindahkan harus lebih dari 0.");
      }
      const receipt = calculateMovingAverageReceipt(targetItem, targetQty, issue.totalCost, nowIso);
      itemsToUpdate.push(receipt.updatedItem);
      debitAccount = targetItem.inventoryAccountCode;

      movements.push(
        buildMovementRecord({
          id: makeId("mov"),
          tenantId,
          itemId: targetItem.id,
          journalEntryId: entryId,
          date: input.date,
          type: "production_in",
          result: receipt,
          referenceDoc: docNo,
          notes: input.description?.trim() || `Hasil produksi ${targetItem.name} dari ${sourceItem.name}`,
          batchRef: input.batchRef ?? null,
          nowIso,
        }),
      );
    }

    const lines: JournalLine[] = [
      { accountCode: debitAccount, debit: issue.totalCost, credit: 0 },
      { accountCode: sourceItem.inventoryAccountCode!, debit: 0, credit: issue.totalCost },
    ];
    validateJournalLines(lines, getAccountMap(ws.accounts));

    const desc =
      input.description?.trim() ||
      (targetItem
        ? `Produksi sederhana: ${input.sourceQuantity} ${sourceItem.unit} ${sourceItem.name} -> ${input.targetQuantity} ${targetItem.unit} ${targetItem.name}`
        : `Pemakaian bahan baku ${sourceItem.name} (${input.sourceQuantity} ${sourceItem.unit})`);

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: isTransfer ? "production_transfer" : "material_usage",
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount: issue.totalCost,
      itemId: (targetItem ?? sourceItem).id,
      itemName: (targetItem ?? sourceItem).name,
      metadata: {
        sourceItemId: sourceItem.id,
        sourceQuantity: input.sourceQuantity,
        targetItemId: targetItem?.id ?? null,
        targetQuantity: input.targetQuantity ?? null,
        batchRef: input.batchRef ?? null,
      },
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const itemConcurrencyChecks = [
      {
        id: sourceItem.id,
        expectedQty: sourceItem.quantityOnHand,
        expectedValue: sourceItem.totalInventoryValue,
        qtyDelta: issue.quantityDelta,
        valueDelta: -issue.totalCost,
      },
    ];
    if (targetItem && itemsToUpdate.length > 1) {
      const targetUpdated = itemsToUpdate[1];
      itemConcurrencyChecks.push({
        id: targetItem.id,
        expectedQty: targetItem.quantityOnHand,
        expectedValue: targetItem.totalInventoryValue,
        qtyDelta: targetUpdated.quantityOnHand - targetItem.quantityOnHand,
        valueDelta: targetUpdated.totalInventoryValue - targetItem.totalInventoryValue,
      });
    }

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      itemsToUpdate,
      movementsToInsert: movements,
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, isTransfer ? "POST_PRODUCTION_TRANSFER" : "POST_MATERIAL_USAGE", "journal_entry", entryId, desc, null, entry, nowIso),
      ],
      concurrencyChecks: { items: itemConcurrencyChecks },
    });

    return { entry, movements };
  }

  /**
   * Full manufacturing production run (BOM multi-material + Direct Labor + Factory Overhead)
   * producing either a Work-In-Process (WIP / 1106) or Finished Good (1105) item.
   */
  async postProductionRun(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      materials: Array<{ itemId: string; quantity: number }>;
      targetItemId: string;
      targetQuantity: number;
      directLaborCost?: number;
      overheadCost?: number;
      costCreditAccountCode?: string;
      batchRef?: string | null;
      description?: string;
    },
  ): Promise<{ entry: JournalEntry; movements: InventoryMovement[]; totalProductionCost: number }> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const accountMap = getAccountMap(ws.accounts);
    const nowIso = new Date().toISOString();

    if (!Array.isArray(input.materials) || input.materials.length === 0) {
      throw new ValidationError("Produksi manufaktur minimal membutuhkan 1 bahan baku / WIP.");
    }

    const targetItemBase = ws.items.find((i) => i.id === input.targetItemId);
    if (!targetItemBase) throw new NotFoundError("Item hasil produksi tidak ditemukan.");
    if (!targetItemBase.active) throw new ValidationError(`Item "${targetItemBase.name}" sedang nonaktif.`);
    if (
      (targetItemBase.category !== "finished_good" && targetItemBase.category !== "wip") ||
      !targetItemBase.inventoryAccountCode
    ) {
      throw new ValidationError("Item hasil produksi harus berkategori Barang Jadi atau WIP.");
    }

    const targetQty = assertPositiveNumber(Number(input.targetQuantity), "Kuantitas hasil produksi");
    const laborCost = Math.max(0, Math.round(Number(input.directLaborCost ?? 0)));
    const overheadCost = Math.max(0, Math.round(Number(input.overheadCost ?? 0)));
    if (laborCost < 0 || overheadCost < 0 || !Number.isFinite(laborCost) || !Number.isFinite(overheadCost)) {
      throw new ValidationError("Biaya tenaga kerja dan overhead tidak boleh negatif.");
    }

    const costCreditCode = (input.costCreditAccountCode ?? "2102").trim();
    if (laborCost > 0 || overheadCost > 0) {
      const creditAcc = accountMap[costCreditCode];
      if (!creditAcc || !creditAcc.active || creditAcc.code === "3999") {
        throw new ValidationError(`Akun kredit biaya produksi "${costCreditCode}" tidak valid atau nonaktif.`);
      }
    }

    const entryId = makeId("jrn");
    const docNo = makeDocNumber("MFG", input.date, ws.journalEntries.length + 1);
    const itemsMap = new Map<string, Item>(ws.items.map((i) => [i.id, i]));
    const workingItems = new Map<string, Item>();
    const movements: InventoryMovement[] = [];
    const lines: JournalLine[] = [];

    let totalMaterialCost = 0;
    const creditByInventoryAccount = new Map<string, number>();

    for (const mat of input.materials) {
      const current = workingItems.get(mat.itemId) ?? itemsMap.get(mat.itemId);
      if (!current) throw new NotFoundError(`Bahan "${mat.itemId}" tidak ditemukan.`);
      if (!current.active) throw new ValidationError(`Bahan "${current.name}" sedang nonaktif.`);
      if (
        (current.category !== "raw_material" && current.category !== "wip") ||
        !current.inventoryAccountCode
      ) {
        throw new ValidationError(`"${current.name}" harus berkategori Bahan Baku atau WIP.`);
      }
      if (current.id === targetItemBase.id) {
        throw new ValidationError("Item sumber dan item hasil produksi tidak boleh sama.");
      }

      const qty = assertPositiveNumber(Number(mat.quantity), `Kuantitas bahan ${current.name}`);
      const issue = calculateMovingAverageIssue(current, qty, nowIso);
      workingItems.set(current.id, issue.updatedItem);
      totalMaterialCost += issue.totalCost;
      creditByInventoryAccount.set(
        current.inventoryAccountCode,
        (creditByInventoryAccount.get(current.inventoryAccountCode) ?? 0) + issue.totalCost,
      );

      movements.push(
        buildMovementRecord({
          id: makeId("mov"),
          tenantId,
          itemId: current.id,
          journalEntryId: entryId,
          date: input.date,
          type: "usage_out",
          result: issue,
          referenceDoc: docNo,
          notes: `Pemakaian produksi ${targetItemBase.name}`,
          batchRef: input.batchRef ?? null,
          nowIso,
        }),
      );
    }

    const totalProductionCost = totalMaterialCost + laborCost + overheadCost;
    if (totalProductionCost <= 0) {
      throw new ValidationError("Total biaya produksi harus lebih dari 0.");
    }

    const targetLatest = workingItems.get(targetItemBase.id) ?? targetItemBase;
    const receipt = calculateMovingAverageReceipt(targetLatest, targetQty, totalProductionCost, nowIso);
    workingItems.set(targetLatest.id, receipt.updatedItem);

    const costComponents: CostComponentPlaceholder[] = [
      { kind: "material", amount: totalMaterialCost, note: "Pemakaian bahan baku/WIP" },
    ];
    if (laborCost > 0) costComponents.push({ kind: "labor", amount: laborCost, note: "BTKL" });
    if (overheadCost > 0) costComponents.push({ kind: "overhead", amount: overheadCost, note: "BOP" });

    movements.push(
      buildMovementRecord({
        id: makeId("mov"),
        tenantId,
        itemId: targetLatest.id,
        journalEntryId: entryId,
        date: input.date,
        type: "production_in",
        result: receipt,
        referenceDoc: docNo,
        notes: input.description?.trim() || `Hasil produksi ${targetQty} ${targetLatest.unit} ${targetLatest.name}`,
        batchRef: input.batchRef ?? null,
        costComponents,
        nowIso,
      }),
    );

    lines.push({
      accountCode: targetItemBase.inventoryAccountCode,
      debit: totalProductionCost,
      credit: 0,
      memo: `Produksi ${targetQty} ${targetItemBase.unit} ${targetItemBase.name}`,
    });
    for (const [accCode, creditAmt] of creditByInventoryAccount.entries()) {
      if (creditAmt > 0) {
        lines.push({ accountCode: accCode, debit: 0, credit: creditAmt, memo: "Pemakaian bahan produksi" });
      }
    }
    if (laborCost > 0) {
      lines.push({ accountCode: costCreditCode, debit: 0, credit: laborCost, memo: "Biaya Tenaga Kerja Langsung (BTKL)" });
    }
    if (overheadCost > 0) {
      lines.push({ accountCode: costCreditCode, debit: 0, credit: overheadCost, memo: "Biaya Overhead Pabrik (BOP)" });
    }

    validateJournalLines(lines, accountMap);

    const desc =
      input.description?.trim() ||
      `Produksi ${targetQty} ${targetItemBase.unit} ${targetItemBase.name} (Bahan ${totalMaterialCost}, BTKL ${laborCost}, BOP ${overheadCost})`;

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: "production_run",
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount: totalProductionCost,
      itemId: targetItemBase.id,
      itemName: targetItemBase.name,
      metadata: {
        materials: input.materials,
        targetQuantity: targetQty,
        totalMaterialCost,
        directLaborCost: laborCost,
        overheadCost,
        costCreditAccountCode: costCreditCode,
        batchRef: input.batchRef ?? null,
      },
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedItems = Array.from(workingItems.values());
    const concurrencyChecks = {
      items: updatedItems.map((upd) => {
        const orig = itemsMap.get(upd.id)!;
        return {
          id: upd.id,
          expectedQty: orig.quantityOnHand,
          expectedValue: orig.totalInventoryValue,
          qtyDelta: upd.quantityOnHand - orig.quantityOnHand,
          valueDelta: upd.totalInventoryValue - orig.totalInventoryValue,
        };
      }),
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      itemsToUpdate: updatedItems,
      movementsToInsert: movements,
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_PRODUCTION_RUN", "journal_entry", entryId, desc, null, entry, nowIso),
      ],
      concurrencyChecks,
    });

    return { entry, movements, totalProductionCost };
  }

  /**
   * Standard double-entry General Journal (Jurnal Umum Manual) supporting
   * multi-line balanced postings across Assets, Liabilities, Equity, Revenue, and Expenses.
   */
  async postGeneralJournal(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      description: string;
      lines: Array<{ accountCode: string; debit?: number; credit?: number; memo?: string | null }>;
    },
  ): Promise<JournalEntry> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const description = assertNonEmptyText(input.description, "Keterangan jurnal umum");
    const accountMap = getAccountMap(ws.accounts);

    if (!Array.isArray(input.lines) || input.lines.length < 2) {
      throw new ValidationError("Jurnal umum minimal memiliki 2 baris akun (Debit dan Kredit).");
    }

    const cleanLines: JournalLine[] = input.lines.map((line) => {
      const code = String(line.accountCode ?? "").trim();
      const acc = accountMap[code];
      if (!acc) throw new ValidationError(`Akun "${code}" tidak terdaftar.`);
      if (!acc.active) throw new ValidationError(`Akun "${code} ${acc.name}" sedang nonaktif.`);
      if (code === "3999") {
        throw new ValidationError("Akun 3999 Ikhtisar Laba Rugi hanya digunakan oleh proses Tutup Periode.");
      }
      return {
        accountCode: code,
        debit: Math.max(0, Math.round(Number(line.debit ?? 0))),
        credit: Math.max(0, Math.round(Number(line.credit ?? 0))),
        memo: line.memo?.trim() || null,
      };
    });

    const { totalDebit } = validateJournalLines(cleanLines, accountMap);
    const nowIso = new Date().toISOString();
    const entryId = makeId("jrn");
    const docNo = makeDocNumber("JRN", input.date, ws.journalEntries.length + 1);

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: "general_journal",
      date: input.date,
      period,
      description,
      status: "posted",
      amount: totalDebit,
      lines: cleanLines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_GENERAL_JOURNAL", "journal_entry", entryId, `Posting ${docNo}: ${description}`, null, entry, nowIso),
      ],
    });

    return entry;
  }

  async postInvoicePayment(
    tenantId: string,
    actorId: string,
    input: {
      kind: "receivable" | "payable";
      date: string;
      partyId: string;
      invoiceId: string;
      amount: number;
      cashAccountCode?: "1101" | "1102";
      description?: string;
    },
  ) {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const party = requireParty(ws.parties, input.partyId);
    const invoice = ws.invoices.find((inv) => inv.id === input.invoiceId);
    if (!invoice) {
      throw new NotFoundError("Faktur asal tidak ditemukan.");
    }

    const nowIso = new Date().toISOString();
    const entryId = makeId("jrn");
    const paymentId = makeId("pay");
    const cashCode = input.cashAccountCode ?? "1101";
    const docNo = makeDocNumber(
      input.kind === "receivable" ? "RCV" : "PAY",
      input.date,
      ws.journalEntries.length + 1,
    );

    const { updatedInvoice, payment } = applyPaymentToInvoice({
      invoice,
      expectedKind: input.kind,
      partyId: party.id,
      paymentAmount: input.amount,
      paymentId,
      journalEntryId: entryId,
      paymentDate: input.date,
      nowIso,
    });

    const lines: JournalLine[] =
      input.kind === "receivable"
        ? [
            { accountCode: cashCode, debit: payment.amount, credit: 0 },
            { accountCode: "1103", debit: 0, credit: payment.amount },
          ]
        : [
            { accountCode: "2101", debit: payment.amount, credit: 0 },
            { accountCode: cashCode, debit: 0, credit: payment.amount },
          ];

    validateJournalLines(lines, getAccountMap(ws.accounts));

    const desc =
      input.description?.trim() ||
      (input.kind === "receivable"
        ? `Penerimaan piutang ${invoice.invoiceNumber} (${party.name})`
        : `Pembayaran utang ${invoice.invoiceNumber} (${party.name})`);

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "transaction",
      type: input.kind === "receivable" ? "collect_receivable" : "pay_payable",
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount: payment.amount,
      partyId: party.id,
      partyName: party.name,
      invoiceId: invoice.id,
      paymentAccountCode: cashCode,
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      invoicesToUpdate: [updatedInvoice],
      invoicePaymentsToInsert: [payment],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_INVOICE_PAYMENT", "invoice", invoice.id, `${desc} sebesar ${payment.amount}`, invoice, updatedInvoice, nowIso),
      ],
      concurrencyChecks: {
        invoices: [
          {
            id: invoice.id,
            expectedRemaining: invoice.remainingAmount,
            paidDelta: payment.amount,
            remainingDelta: -payment.amount,
          },
        ],
      },
    });

    return { entry, invoice: updatedInvoice, payment };
  }

  async postStockOpname(
    tenantId: string,
    actorId: string,
    input: {
      date: string;
      itemId: string;
      physicalQuantity: number;
      unitCostIfZero?: number;
      notes?: string;
    },
  ): Promise<{
    differenceQty: number;
    differenceValue: number;
    entry: JournalEntry | null;
    movement: InventoryMovement | null;
    item: Item;
  }> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const physicalQty = assertNonNegativeNumber(input.physicalQuantity, "Kuantitas fisik stock opname");
    const item = ws.items.find((i) => i.id === input.itemId);
    if (!item) throw new NotFoundError("Barang tidak ditemukan.");
    if (!item.trackInventory || !item.inventoryAccountCode) {
      throw new ValidationError(`Barang "${item.name}" bukan persediaan yang dilacak secara kuantitatif.`);
    }

    const nowIso = new Date().toISOString();
    const diffQty = Math.round((physicalQty - item.quantityOnHand) * 1_000_000) / 1_000_000;

    if (Math.abs(diffQty) < 1e-9) {
      await this.repo.appendAuditLog(
        tenantId,
        this.buildAudit(tenantId, actorId, "STOCK_OPNAME_MATCH", "item", item.id, `Stock opname ${item.name}: fisik (${physicalQty}) sesuai buku (${item.quantityOnHand})`, null, null, nowIso),
      );
      return { differenceQty: 0, differenceValue: 0, entry: null, movement: null, item };
    }

    const entryId = makeId("jrn");
    const docNo = makeDocNumber("OPM", input.date, ws.journalEntries.length + 1);
    let result;
    let lines: JournalLine[];
    let movementType: "opname_in" | "opname_out";
    let desc: string;

    if (diffQty > 0) {
      // Positive stock variance: Dr Persediaan, Cr 4201 Pendapatan Selisih Persediaan
      const unitCost =
        item.movingAverageCost > 0
          ? item.movingAverageCost
          : Number(input.unitCostIfZero ?? item.defaultPurchaseCost ?? 0);
      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new ValidationError(
          `Harga pokok satuan untuk selisih lebih "${item.name}" wajib diisi karena rata-rata bergerak saat ini 0.`,
        );
      }
      const diffValue = Math.max(1, Math.round(diffQty * unitCost));
      result = calculateMovingAverageReceipt(item, diffQty, diffValue, nowIso);
      movementType = "opname_in";
      lines = [
        { accountCode: item.inventoryAccountCode, debit: diffValue, credit: 0 },
        { accountCode: "4201", debit: 0, credit: diffValue },
      ];
      desc = input.notes?.trim() || `Stock opname lebih (+${diffQty} ${item.unit}) ${item.name}`;
    } else {
      // Negative stock variance: Dr 5107 Beban Selisih Persediaan, Cr Persediaan
      const lossQty = Math.abs(diffQty);
      result = calculateMovingAverageIssue(item, lossQty, nowIso);
      movementType = "opname_out";
      lines = [
        { accountCode: "5107", debit: result.totalCost, credit: 0 },
        { accountCode: item.inventoryAccountCode, debit: 0, credit: result.totalCost },
      ];
      desc = input.notes?.trim() || `Stock opname kurang (-${lossQty} ${item.unit}) ${item.name}`;
    }

    validateJournalLines(lines, getAccountMap(ws.accounts));

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "opname",
      type: "stock_opname",
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount: result.totalCost,
      itemId: item.id,
      itemName: item.name,
      metadata: {
        bookQtyBefore: item.quantityOnHand,
        physicalQty,
        differenceQty: diffQty,
      },
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const movement = buildMovementRecord({
      id: makeId("mov"),
      tenantId,
      itemId: item.id,
      journalEntryId: entryId,
      date: input.date,
      type: movementType,
      result,
      referenceDoc: docNo,
      notes: desc,
      nowIso,
    });

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      itemsToUpdate: [result.updatedItem],
      movementsToInsert: [movement],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "STOCK_OPNAME_ADJUST", "journal_entry", entryId, desc, { qty: item.quantityOnHand, value: item.totalInventoryValue }, { qty: result.balanceQtyAfter, value: result.balanceValueAfter }, nowIso),
      ],
      concurrencyChecks: {
        items: [
          {
            id: item.id,
            expectedQty: item.quantityOnHand,
            expectedValue: item.totalInventoryValue,
            qtyDelta: result.quantityDelta,
            valueDelta: result.quantityDelta > 0 ? result.totalCost : -result.totalCost,
          },
        ],
      },
    });

    return {
      differenceQty: diffQty,
      differenceValue: result.totalCost,
      entry,
      movement,
      item: result.updatedItem,
    };
  }

  async postAdjustment(
    tenantId: string,
    actorId: string,
    input:
      | { type: "depreciation"; date: string; assetCost: number; lifeMonths: number; description?: string }
      | { type: "accrued_expense"; date: string; expenseAccountCode: string; amount: number; description?: string },
  ): Promise<JournalEntry> {
    const ws = await this.repo.getWorkspace(tenantId);
    const period = assertPeriodOpen(input.date, ws.periods);
    const accountMap = getAccountMap(ws.accounts);
    const nowIso = new Date().toISOString();
    const entryId = makeId("jrn");
    const docNo = makeDocNumber("ADJ", input.date, ws.journalEntries.length + 1);

    let amount: number;
    let lines: JournalLine[];
    let desc: string;
    let metadata: Record<string, unknown>;

    if (input.type === "depreciation") {
      const cost = assertPositiveInteger(input.assetCost, "Nilai peralatan");
      const lifeMonths = assertPositiveInteger(input.lifeMonths, "Umur manfaat (bulan)");
      amount = assertPositiveInteger(Math.round(cost / lifeMonths), "Nilai penyusutan");
      lines = [
        { accountCode: "5106", debit: amount, credit: 0 },
        { accountCode: "1202", debit: 0, credit: amount },
      ];
      desc = input.description?.trim() || `Penyusutan peralatan periode ${period}`;
      metadata = { assetCost: cost, lifeMonths };
    } else {
      amount = assertPositiveInteger(input.amount, "Nilai beban akrual");
      const exp = accountMap[input.expenseAccountCode];
      if (!exp || exp.group !== "expense" || ["5101", "5106", "5107"].includes(exp.code)) {
        throw new ValidationError(`Akun beban "${input.expenseAccountCode}" tidak valid untuk akrual.`);
      }
      lines = [
        { accountCode: exp.code, debit: amount, credit: 0 },
        { accountCode: "2102", debit: 0, credit: amount },
      ];
      desc = input.description?.trim() || `${exp.name} periode ${period} belum dibayar`;
      metadata = { expenseAccountCode: exp.code };
    }

    validateJournalLines(lines, accountMap);

    const entry: JournalEntry = {
      id: entryId,
      tenantId,
      documentNumber: docNo,
      source: "adjustment",
      type: input.type,
      date: input.date,
      period,
      description: desc,
      status: "posted",
      amount,
      metadata,
      lines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: [entry],
      periodsToUpsert: [this.ensurePeriodRecord(ws, period, nowIso)],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "POST_ADJUSTMENT", "journal_entry", entryId, `Penyesuaian ${docNo}: ${desc}`, null, entry, nowIso),
      ],
    });

    return entry;
  }

  /**
   * Voids a posted journal entry via immutable Reversal Journal Entry + Stock/Invoice Reversal + Audit Log.
   * Never deletes posted records.
   */
  async voidJournalEntry(
    tenantId: string,
    actorId: string,
    input: { entryId: string; reason: string; reversalDate?: string },
  ): Promise<{ voidedEntry: JournalEntry; reversalEntry: JournalEntry }> {
    const ws = await this.repo.getWorkspace(tenantId);
    const original = ws.journalEntries.find((e) => e.id === input.entryId);
    if (!original) {
      throw new NotFoundError("Jurnal tidak ditemukan.");
    }
    if (original.status === "voided") {
      throw new ValidationError(`Dokumen "${original.documentNumber}" sudah dibatalkan (void) sebelumnya.`);
    }
    if (original.source === "reversal") {
      throw new ValidationError("Jurnal pembalik (reversal) tidak dapat dibatalkan ulang.");
    }

    const reason = assertNonEmptyText(input.reason, "Alasan pembatalan (void)");
    assertPeriodOpen(original.date, ws.periods);

    const reversalDate = input.reversalDate ? assertValidDate(input.reversalDate) : original.date;
    const reversalPeriod = assertPeriodOpen(reversalDate, ws.periods);
    if (reversalDate < original.date) {
      throw new ValidationError("Tanggal pembalikan tidak boleh lebih awal dari tanggal transaksi asli.");
    }

    const nowIso = new Date().toISOString();
    const reversalId = makeId("rev");
    const reversalDocNo = makeDocNumber("REV", reversalDate, ws.journalEntries.length + 1);

    const reversalLines: JournalLine[] = original.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: line.credit,
      credit: line.debit,
      memo: `Pembalik ${original.documentNumber}`,
    }));
    validateJournalLines(reversalLines, getAccountMap(ws.accounts));

    // 1. Handle AR/AP Invoices or Payments
    const invoicesToUpdate: Invoice[] = [];
    const invoicePaymentsToUpdate = [];

    if (original.invoiceId && ["credit_sale", "inventory_credit", "equipment_credit"].includes(original.type)) {
      const inv = ws.invoices.find((i) => i.id === original.invoiceId);
      if (inv) {
        assertInvoiceCanBeVoided(inv, ws.invoicePayments);
        invoicesToUpdate.push({
          ...inv,
          status: "voided",
          remainingAmount: 0,
          updatedAt: nowIso,
        });
      }
    }

    if (original.type === "collect_receivable" || original.type === "pay_payable") {
      const payment = ws.invoicePayments.find((p) => p.journalEntryId === original.id);
      if (payment) {
        const inv = ws.invoices.find((i) => i.id === payment.invoiceId);
        if (inv) {
          const reversed = reversePaymentOnInvoice(inv, payment, nowIso);
          invoicesToUpdate.push(reversed.updatedInvoice);
          invoicePaymentsToUpdate.push(reversed.updatedPayment);
        }
      }
    }

    // 2. Handle Inventory Movements linked to original entry
    const linkedMovements = ws.inventoryMovements.filter((m) => m.journalEntryId === original.id);
    const itemsMap = new Map(ws.items.map((item) => [item.id, item]));
    const updatedItemsMap = new Map<string, Item>();
    const reversalMovements: InventoryMovement[] = [];

    for (const mov of linkedMovements) {
      const currentItem = updatedItemsMap.get(mov.itemId) ?? itemsMap.get(mov.itemId);
      if (!currentItem) throw new NotFoundError(`Barang terkait mutasi "${mov.id}" tidak ditemukan.`);
      const revResult = reverseInventoryState(currentItem, mov, nowIso);
      updatedItemsMap.set(currentItem.id, revResult.updatedItem);
      reversalMovements.push(
        buildMovementRecord({
          id: makeId("mov"),
          tenantId,
          itemId: currentItem.id,
          journalEntryId: reversalId,
          date: reversalDate,
          type: "void_reversal",
          result: revResult,
          referenceDoc: reversalDocNo,
          notes: `Void ${original.documentNumber}: ${reason}`,
          reversesMovementId: mov.id,
          nowIso,
        }),
      );
    }

    // 3. Handle Period Closing Void (Reopen Period)
    const periodsToUpsert: AccountingPeriod[] = [this.ensurePeriodRecord(ws, reversalPeriod, nowIso)];
    if (original.source === "closing") {
      const closedPeriod = ws.periods.find((p) => p.closingEntryId === original.id);
      if (closedPeriod) {
        periodsToUpsert.push({
          ...closedPeriod,
          status: "open",
          closingEntryId: null,
          reopenedAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    const voidedEntry: JournalEntry = {
      ...original,
      status: "voided",
      reversedByEntryId: reversalId,
      voidReason: reason,
      voidedAt: nowIso,
      updatedAt: nowIso,
    };

    const reversalEntry: JournalEntry = {
      id: reversalId,
      tenantId,
      documentNumber: reversalDocNo,
      source: "reversal",
      type: "reversal",
      date: reversalDate,
      period: reversalPeriod,
      description: `PEMBALIK (${original.documentNumber}): ${original.description} — ${reason}`,
      status: "posted",
      amount: original.amount,
      partyId: original.partyId ?? null,
      partyName: original.partyName ?? null,
      itemId: original.itemId ?? null,
      itemName: original.itemName ?? null,
      invoiceId: original.invoiceId ?? null,
      reversesEntryId: original.id,
      lines: reversalLines,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updatedItems = Array.from(updatedItemsMap.values());
    await this.repo.commitPosting(tenantId, {
      journalEntriesToUpdate: [voidedEntry],
      journalEntriesToInsert: [reversalEntry],
      itemsToUpdate: updatedItems,
      movementsToInsert: reversalMovements,
      invoicesToUpdate,
      invoicePaymentsToUpdate,
      periodsToUpsert,
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "VOID_ENTRY", "journal_entry", original.id, `Void ${original.documentNumber} (${reason}) -> ${reversalDocNo}`, original, reversalEntry, nowIso),
      ],
      concurrencyChecks: {
        voidingEntryIds: [original.id],
        items: updatedItems.map((upd) => {
          const origItem = itemsMap.get(upd.id)!;
          return {
            id: upd.id,
            expectedQty: origItem.quantityOnHand,
            expectedValue: origItem.totalInventoryValue,
            qtyDelta: upd.quantityOnHand - origItem.quantityOnHand,
            valueDelta: upd.totalInventoryValue - origItem.totalInventoryValue,
          };
        }),
      },
    });

    return { voidedEntry, reversalEntry };
  }

  /**
   * Formal Period Closing:
   * Closes nominal Revenue (4xxx), Expense (5xxx), and Drawing (3102) accounts
   * into 3999 Ikhtisar Laba Rugi and 3103 Laba Ditahan, then locks the period.
   * Real accounts (Assets, Liabilities, Paid-in Capital, Retained Earnings) carry forward automatically.
   */
  async closePeriod(
    tenantId: string,
    actorId: string,
    period: string,
  ): Promise<{ periodRecord: AccountingPeriod; closingEntry: JournalEntry | null }> {
    const safePeriod = assertValidPeriod(period);
    const ws = await this.repo.getWorkspace(tenantId);
    const existing = ws.periods.find((p) => p.period === safePeriod);
    if (existing?.status === "closed") {
      throw new ClosedPeriodError(`Periode ${safePeriod} sudah ditutup sebelumnya.`);
    }

    // Ensure no earlier periods with operating entries remain unclosed
    const earlierOpenPeriods = new Set<string>();
    for (const entry of ws.journalEntries) {
      if (entry.period < safePeriod && entry.source !== "closing") {
        const pRec = ws.periods.find((p) => p.period === entry.period);
        if (!pRec || pRec.status === "open") {
          earlierOpenPeriods.add(entry.period);
        }
      }
    }
    if (earlierOpenPeriods.size > 0) {
      const earliest = Array.from(earlierOpenPeriods).sort()[0];
      throw new ValidationError(
        `Periode sebelumnya (${earliest}) belum ditutup. Tutup periode secara berurutan.`,
      );
    }

    const info = parsePeriod(safePeriod);
    const statements = buildFinancialStatements({
      accounts: ws.accounts,
      entries: ws.journalEntries,
      period: safePeriod,
      isPeriodClosed: false,
    });

    const lines: JournalLine[] = [];
    // 1. Close Revenue accounts (credit normal -> debit to zero out)
    let totalRevenueClosed = 0;
    for (const account of ws.accounts.filter((a) => a.group === "revenue")) {
      const raw = statements.periodActivityBalances[account.code] ?? 0;
      const creditBal = -raw;
      if (creditBal > 0) {
        lines.push({ accountCode: account.code, debit: creditBal, credit: 0 });
        totalRevenueClosed += creditBal;
      } else if (creditBal < 0) {
        lines.push({ accountCode: account.code, debit: 0, credit: -creditBal });
        totalRevenueClosed += creditBal;
      }
    }
    if (totalRevenueClosed > 0) {
      lines.push({ accountCode: "3999", debit: 0, credit: totalRevenueClosed });
    } else if (totalRevenueClosed < 0) {
      lines.push({ accountCode: "3999", debit: -totalRevenueClosed, credit: 0 });
    }

    // 2. Close Expense accounts (debit normal -> credit to zero out)
    let totalExpenseClosed = 0;
    for (const account of ws.accounts.filter((a) => a.group === "expense")) {
      const debitBal = statements.periodActivityBalances[account.code] ?? 0;
      if (debitBal > 0) {
        lines.push({ accountCode: account.code, debit: 0, credit: debitBal });
        totalExpenseClosed += debitBal;
      } else if (debitBal < 0) {
        lines.push({ accountCode: account.code, debit: -debitBal, credit: 0 });
        totalExpenseClosed += debitBal;
      }
    }
    if (totalExpenseClosed > 0) {
      lines.push({ accountCode: "3999", debit: totalExpenseClosed, credit: 0 });
    } else if (totalExpenseClosed < 0) {
      lines.push({ accountCode: "3999", debit: 0, credit: -totalExpenseClosed });
    }

    // 3. Close Ikhtisar Laba Rugi (3999) into Laba Ditahan (3103)
    const netIncome = totalRevenueClosed - totalExpenseClosed;
    if (netIncome > 0) {
      lines.push(
        { accountCode: "3999", debit: netIncome, credit: 0 },
        { accountCode: "3103", debit: 0, credit: netIncome },
      );
    } else if (netIncome < 0) {
      lines.push(
        { accountCode: "3103", debit: -netIncome, credit: 0 },
        { accountCode: "3999", debit: 0, credit: -netIncome },
      );
    }

    // 4. Close Drawing / Prive (3102) into Laba Ditahan (3103)
    const drawings = statements.periodActivityBalances["3102"] ?? 0;
    if (drawings > 0) {
      lines.push(
        { accountCode: "3103", debit: drawings, credit: 0 },
        { accountCode: "3102", debit: 0, credit: drawings },
      );
    } else if (drawings < 0) {
      lines.push(
        { accountCode: "3102", debit: -drawings, credit: 0 },
        { accountCode: "3103", debit: 0, credit: -drawings },
      );
    }

    const nowIso = new Date().toISOString();
    let closingEntry: JournalEntry | null = null;

    if (lines.length >= 2) {
      validateJournalLines(lines, getAccountMap(ws.accounts));
      const entryId = makeId("cls");
      const docNo = makeDocNumber("CLS", info.end, ws.journalEntries.length + 1);
      closingEntry = {
        id: entryId,
        tenantId,
        documentNumber: docNo,
        source: "closing",
        type: "period_closing",
        date: info.end,
        period: safePeriod,
        description: `Jurnal penutup periode ${info.label}`,
        status: "posted",
        amount: Math.abs(netIncome) + Math.abs(drawings),
        lines,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

    const periodRecord: AccountingPeriod = {
      id: existing?.id ?? `${tenantId}-period-${safePeriod}`,
      tenantId,
      period: safePeriod,
      status: "closed",
      closedAt: nowIso,
      closingEntryId: closingEntry?.id ?? null,
      reopenedAt: existing?.reopenedAt ?? null,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    await this.repo.commitPosting(tenantId, {
      journalEntriesToInsert: closingEntry ? [closingEntry] : [],
      periodsToUpsert: [periodRecord],
      auditLogsToInsert: [
        this.buildAudit(tenantId, actorId, "CLOSE_PERIOD", "accounting_period", safePeriod, `Menutup periode ${info.label} (Laba Bersih ${netIncome}, Prive ${drawings})`, existing ?? null, periodRecord, nowIso),
      ],
    });

    return { periodRecord, closingEntry };
  }

  async getTrialBalance(
    tenantId: string,
    period?: string,
    includeAdjustments = true,
    includeClosing = false,
  ): Promise<TrialBalanceResult> {
    const ws = await this.repo.getWorkspace(tenantId);
    const targetPeriod = period ? assertValidPeriod(period) : ws.profile.activePeriod;
    return buildTrialBalance({
      accounts: ws.accounts,
      entries: ws.journalEntries,
      period: targetPeriod,
      includeAdjustments,
      includeClosing,
    });
  }

  async getGeneralLedger(
    tenantId: string,
    accountCode: string,
    period?: string,
  ): Promise<GeneralLedgerResult> {
    const ws = await this.repo.getWorkspace(tenantId);
    const targetPeriod = period ? assertValidPeriod(period) : ws.profile.activePeriod;
    return buildGeneralLedger({
      accounts: ws.accounts,
      entries: ws.journalEntries,
      accountCode,
      period: targetPeriod,
    });
  }

  async getFinancialStatements(
    tenantId: string,
    period?: string,
  ): Promise<FinancialStatementsResult> {
    const ws = await this.repo.getWorkspace(tenantId);
    const targetPeriod = period ? assertValidPeriod(period) : ws.profile.activePeriod;
    const pRec = ws.periods.find((p) => p.period === targetPeriod);
    return buildFinancialStatements({
      accounts: ws.accounts,
      entries: ws.journalEntries,
      period: targetPeriod,
      isPeriodClosed: pRec?.status === "closed",
    });
  }

  private ensurePeriodRecord(
    ws: TenantWorkspace,
    period: string,
    nowIso: string,
  ): AccountingPeriod {
    const existing = ws.periods.find((p) => p.period === period);
    if (existing) return existing;
    return {
      id: `${ws.profile.tenantId}-period-${period}`,
      tenantId: ws.profile.tenantId,
      period,
      status: "open",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  private buildAudit(
    tenantId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    beforeObj: unknown,
    afterObj: unknown,
    createdAt: string,
  ): AuditLog {
    return {
      id: makeId("aud"),
      tenantId,
      actorId,
      action,
      entityType,
      entityId,
      summary,
      beforeJson: beforeObj ? JSON.stringify(beforeObj) : null,
      afterJson: afterObj ? JSON.stringify(afterObj) : null,
      createdAt,
    };
  }
}

export { periodFromDate };
