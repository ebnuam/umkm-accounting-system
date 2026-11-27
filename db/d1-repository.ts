import { and, asc, eq, sql } from "drizzle-orm";
import type {
  Account,
  AccountingPeriod,
  AccountingRepository,
  AuditLog,
  BusinessProfile,
  CommitPostingBundle,
  InventoryMovement,
  Invoice,
  InvoicePayment,
  Item,
  JournalEntry,
  JournalLine,
  Party,
  TenantWorkspace,
} from "../core/index.ts";
import {
  ClosedPeriodError,
  ConcurrencyError,
  InsufficientStockError,
  NotFoundError,
  OverpaymentError,
} from "../core/index.ts";
import {
  accountingPeriods,
  accounts,
  auditLogs,
  inventoryMovements,
  invoicePayments,
  invoices,
  items,
  journalEntries,
  journalLines,
  parties,
  tenants,
} from "./schema.ts";

// Minimal structural type compatible with Drizzle D1 and SQLite drivers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleSqliteClient = any;

export class DrizzleSqliteAccountingRepository implements AccountingRepository {
  protected readonly db: DrizzleSqliteClient;

  constructor(db: DrizzleSqliteClient) {
    this.db = db;
  }

  getDrizzleClient(): DrizzleSqliteClient {
    return this.db;
  }

  private async runStatements(statements: unknown[]): Promise<void> {
    if (!statements.length) return;
    try {
      if (typeof this.db.batch === "function") {
        // Cloudflare D1 executes batch statements atomically in one transaction
        await this.db.batch(statements);
        return;
      }
      if (typeof this.db.transaction === "function") {
        await this.db.transaction(async () => {
          for (const stmt of statements) {
            await stmt;
          }
        });
        return;
      }
      for (const stmt of statements) {
        await stmt;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("CHECK_NEGATIVE_STOCK")) {
        throw new InsufficientStockError("Stok barang tidak mencukupi akibat transaksi bersamaan.");
      }
      if (msg.includes("CHECK_OVERPAYMENT")) {
        throw new OverpaymentError("Pelunasan melebihi sisa tagihan faktur akibat transaksi bersamaan.");
      }
      if (msg.includes("CHECK_DOUBLE_PERIOD_CLOSE")) {
        throw new ClosedPeriodError("Periode sudah ditutup oleh permintaan lain.");
      }
      if (msg.includes("UNIQUE constraint failed") && msg.includes("reverses_entry_id")) {
        throw new ConcurrencyError("Jurnal ini sudah dibatalkan (void) oleh permintaan lain.");
      }
      throw error;
    }
  }

  private pushChunked<T>(
    statements: unknown[],
    rows: T[],
    colsPerRow: number,
    buildInsert: (chunk: T[]) => unknown,
  ): void {
    const chunkSize = Math.max(1, Math.floor(80 / colsPerRow));
    for (let i = 0; i < rows.length; i += chunkSize) {
      statements.push(buildInsert(rows.slice(i, i + chunkSize)));
    }
  }

  async hasWorkspace(tenantId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return rows.length > 0;
  }

  async initializeWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void> {
    if (await this.hasWorkspace(tenantId)) return;
    await this.insertFullWorkspace(tenantId, workspace);
  }

  async resetWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void> {
    const deletes = [
      this.db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)),
      this.db.delete(invoicePayments).where(eq(invoicePayments.tenantId, tenantId)),
      this.db.delete(invoices).where(eq(invoices.tenantId, tenantId)),
      this.db.delete(inventoryMovements).where(eq(inventoryMovements.tenantId, tenantId)),
      this.db.delete(journalLines).where(eq(journalLines.tenantId, tenantId)),
      this.db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId)),
      this.db.delete(accountingPeriods).where(eq(accountingPeriods.tenantId, tenantId)),
      this.db.delete(items).where(eq(items.tenantId, tenantId)),
      this.db.delete(parties).where(eq(parties.tenantId, tenantId)),
      this.db.delete(accounts).where(eq(accounts.tenantId, tenantId)),
      this.db.delete(tenants).where(eq(tenants.id, tenantId)),
    ];
    await this.runStatements(deletes);
    await this.insertFullWorkspace(tenantId, workspace);
  }

  private async insertFullWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void> {
    const statements: unknown[] = [];

    statements.push(
      this.db.insert(tenants).values({
        id: tenantId,
        businessName: workspace.profile.businessName,
        city: workspace.profile.city,
        businessSector: workspace.profile.businessSector ?? "general",
        activePeriod: workspace.profile.activePeriod,
        createdAt: workspace.profile.updatedAt,
        updatedAt: workspace.profile.updatedAt,
      }),
    );

    if (workspace.accounts.length) {
      this.pushChunked(statements, workspace.accounts, 9, (chunk) =>
        this.db.insert(accounts).values(
          chunk.map((a) => ({
            id: `${tenantId}-acc-${a.code}`,
            tenantId,
            code: a.code,
            name: a.name,
            category: a.category,
            group: a.group,
            nature: a.nature,
            normal: a.normal,
            active: a.active,
          })),
        ),
      );
    }

    if (workspace.parties.length) {
      this.pushChunked(statements, workspace.parties, 9, (chunk) =>
        this.db.insert(parties).values(
          chunk.map((p) => ({
            id: p.id,
            tenantId,
            name: p.name,
            type: p.type,
            phone: p.phone ?? null,
            address: p.address ?? null,
            active: p.active,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        ),
      );
    }

    if (workspace.items.length) {
      this.pushChunked(statements, workspace.items, 18, (chunk) =>
        this.db.insert(items).values(chunk.map((item) => this.itemRow(tenantId, item))),
      );
    }

    if (workspace.periods.length) {
      this.pushChunked(statements, workspace.periods, 9, (chunk) =>
        this.db.insert(accountingPeriods).values(
          chunk.map((p) => ({
            id: p.id,
            tenantId,
            period: p.period,
            status: p.status,
            closedAt: p.closedAt ?? null,
            closingEntryId: p.closingEntryId ?? null,
            reopenedAt: p.reopenedAt ?? null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        ),
      );
    }

    for (const entry of workspace.journalEntries) {
      statements.push(this.db.insert(journalEntries).values(this.entryRow(tenantId, entry)));
      if (entry.lines.length) {
        this.pushChunked(
          statements,
          entry.lines.map((line, idx) => this.lineRow(tenantId, entry.id, idx, line)),
          8,
          (chunk) => this.db.insert(journalLines).values(chunk),
        );
      }
    }

    if (workspace.inventoryMovements.length) {
      this.pushChunked(statements, workspace.inventoryMovements, 18, (chunk) =>
        this.db
          .insert(inventoryMovements)
          .values(chunk.map((m) => this.movementRow(tenantId, m))),
      );
    }

    if (workspace.invoices.length) {
      this.pushChunked(statements, workspace.invoices, 14, (chunk) =>
        this.db
          .insert(invoices)
          .values(chunk.map((inv) => this.invoiceRow(tenantId, inv))),
      );
    }

    if (workspace.invoicePayments.length) {
      this.pushChunked(statements, workspace.invoicePayments, 9, (chunk) =>
        this.db
          .insert(invoicePayments)
          .values(chunk.map((pay) => this.paymentRow(tenantId, pay))),
      );
    }

    if (workspace.auditLogs.length) {
      this.pushChunked(statements, workspace.auditLogs, 10, (chunk) =>
        this.db
          .insert(auditLogs)
          .values(chunk.map((log) => this.auditRow(tenantId, log))),
      );
    }

    await this.runStatements(statements);
  }

  async getWorkspace(tenantId: string): Promise<TenantWorkspace> {
    const [tenantRow] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenantRow) {
      throw new NotFoundError(`Workspace tenant "${tenantId}" tidak ditemukan.`);
    }

    const [
      accountRows,
      partyRows,
      itemRows,
      movementRows,
      invoiceRows,
      paymentRows,
      entryRows,
      lineRows,
      periodRows,
      auditRows,
    ] = await Promise.all([
      this.db.select().from(accounts).where(eq(accounts.tenantId, tenantId)).orderBy(asc(accounts.code)),
      this.db.select().from(parties).where(eq(parties.tenantId, tenantId)).orderBy(asc(parties.name)),
      this.db.select().from(items).where(eq(items.tenantId, tenantId)).orderBy(asc(items.name)),
      this.db.select().from(inventoryMovements).where(eq(inventoryMovements.tenantId, tenantId)).orderBy(asc(inventoryMovements.date), asc(inventoryMovements.createdAt)),
      this.db.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(asc(invoices.issueDate), asc(invoices.createdAt)),
      this.db.select().from(invoicePayments).where(eq(invoicePayments.tenantId, tenantId)).orderBy(asc(invoicePayments.paymentDate), asc(invoicePayments.createdAt)),
      this.db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId)).orderBy(asc(journalEntries.date), asc(journalEntries.createdAt)),
      this.db.select().from(journalLines).where(eq(journalLines.tenantId, tenantId)).orderBy(asc(journalLines.lineOrder)),
      this.db.select().from(accountingPeriods).where(eq(accountingPeriods.tenantId, tenantId)).orderBy(asc(accountingPeriods.period)),
      this.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(asc(auditLogs.createdAt)),
    ]);

    const linesByEntry = new Map<string, JournalLine[]>();
    for (const row of lineRows) {
      const list = linesByEntry.get(row.journalEntryId) ?? [];
      list.push({
        id: row.id,
        accountCode: row.accountCode,
        debit: row.debit,
        credit: row.credit,
        memo: row.memo,
      });
      linesByEntry.set(row.journalEntryId, list);
    }

    return {
      profile: {
        tenantId: tenantRow.id,
        businessName: tenantRow.businessName,
        city: tenantRow.city,
        businessSector: (tenantRow.businessSector as BusinessProfile["businessSector"]) ?? "general",
        activePeriod: tenantRow.activePeriod,
        updatedAt: tenantRow.updatedAt,
      },
      accounts: accountRows.map(this.mapAccount),
      parties: partyRows.map(this.mapParty),
      items: itemRows.map(this.mapItem),
      inventoryMovements: movementRows.map(this.mapMovement),
      invoices: invoiceRows.map(this.mapInvoice),
      invoicePayments: paymentRows.map(this.mapPayment),
      journalEntries: entryRows.map((row: DrizzleSqliteClient) =>
        this.mapEntry(row, linesByEntry.get(row.id) ?? []),
      ),
      periods: periodRows.map(this.mapPeriod),
      auditLogs: auditRows.map(this.mapAudit),
    };
  }

  async updateProfile(tenantId: string, profile: BusinessProfile): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        businessName: profile.businessName,
        city: profile.city,
        businessSector: profile.businessSector ?? "general",
        activePeriod: profile.activePeriod,
        updatedAt: profile.updatedAt,
      })
      .where(eq(tenants.id, tenantId));
  }

  async getAccounts(tenantId: string): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId))
      .orderBy(asc(accounts.code));
    return rows.map(this.mapAccount);
  }

  async saveAccount(tenantId: string, account: Account): Promise<void> {
    const id = `${tenantId}-acc-${account.code}`;
    await this.db
      .insert(accounts)
      .values({
        id,
        tenantId,
        code: account.code,
        name: account.name,
        category: account.category,
        group: account.group,
        nature: account.nature,
        normal: account.normal,
        active: account.active,
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: account.name,
          category: account.category,
          group: account.group,
          nature: account.nature,
          normal: account.normal,
          active: account.active,
        },
        where: eq(accounts.tenantId, tenantId),
      });
  }

  async listParties(tenantId: string): Promise<Party[]> {
    const rows = await this.db
      .select()
      .from(parties)
      .where(eq(parties.tenantId, tenantId))
      .orderBy(asc(parties.name));
    return rows.map(this.mapParty);
  }

  async getParty(tenantId: string, partyId: string): Promise<Party | null> {
    const [row] = await this.db
      .select()
      .from(parties)
      .where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId)))
      .limit(1);
    return row ? this.mapParty(row) : null;
  }

  async saveParty(tenantId: string, party: Party): Promise<void> {
    const row = {
      id: party.id,
      tenantId,
      name: party.name,
      type: party.type,
      phone: party.phone ?? null,
      address: party.address ?? null,
      active: party.active,
      createdAt: party.createdAt,
      updatedAt: party.updatedAt,
    };
    await this.db
      .insert(parties)
      .values(row)
      .onConflictDoUpdate({
        target: parties.id,
        set: {
          name: row.name,
          type: row.type,
          phone: row.phone,
          address: row.address,
          active: row.active,
          updatedAt: row.updatedAt,
        },
        where: eq(parties.tenantId, tenantId),
      });
  }

  async listItems(tenantId: string): Promise<Item[]> {
    const rows = await this.db
      .select()
      .from(items)
      .where(eq(items.tenantId, tenantId))
      .orderBy(asc(items.name));
    return rows.map(this.mapItem);
  }

  async getItem(tenantId: string, itemId: string): Promise<Item | null> {
    const [row] = await this.db
      .select()
      .from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.id, itemId)))
      .limit(1);
    return row ? this.mapItem(row) : null;
  }

  async saveItem(tenantId: string, item: Item): Promise<void> {
    const row = this.itemRow(tenantId, item);
    await this.db
      .insert(items)
      .values(row)
      .onConflictDoUpdate({
        target: items.id,
        set: {
          sku: row.sku,
          name: row.name,
          category: row.category,
          unit: row.unit,
          inventoryAccountCode: row.inventoryAccountCode,
          cogsAccountCode: row.cogsAccountCode,
          revenueAccountCode: row.revenueAccountCode,
          quantityOnHand: row.quantityOnHand,
          totalInventoryValue: row.totalInventoryValue,
          movingAverageCost: row.movingAverageCost,
          defaultSalePrice: row.defaultSalePrice,
          defaultPurchaseCost: row.defaultPurchaseCost,
          active: row.active,
          updatedAt: row.updatedAt,
        },
        where: eq(items.tenantId, tenantId),
      });
  }

  async listInventoryMovements(tenantId: string, itemId?: string): Promise<InventoryMovement[]> {
    const cond = itemId
      ? and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.itemId, itemId))
      : eq(inventoryMovements.tenantId, tenantId);
    const rows = await this.db
      .select()
      .from(inventoryMovements)
      .where(cond)
      .orderBy(asc(inventoryMovements.date), asc(inventoryMovements.createdAt));
    return rows.map(this.mapMovement);
  }

  async listMovementsByJournalEntry(
    tenantId: string,
    journalEntryId: string,
  ): Promise<InventoryMovement[]> {
    const rows = await this.db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.journalEntryId, journalEntryId),
        ),
      );
    return rows.map(this.mapMovement);
  }

  async listInvoices(tenantId: string): Promise<Invoice[]> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId))
      .orderBy(asc(invoices.issueDate), asc(invoices.createdAt));
    return rows.map(this.mapInvoice);
  }

  async getInvoice(tenantId: string, invoiceId: string): Promise<Invoice | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1);
    return row ? this.mapInvoice(row) : null;
  }

  async listInvoicePayments(tenantId: string, invoiceId?: string): Promise<InvoicePayment[]> {
    const cond = invoiceId
      ? and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, invoiceId))
      : eq(invoicePayments.tenantId, tenantId);
    const rows = await this.db
      .select()
      .from(invoicePayments)
      .where(cond)
      .orderBy(asc(invoicePayments.paymentDate), asc(invoicePayments.createdAt));
    return rows.map(this.mapPayment);
  }

  async listJournalEntries(tenantId: string): Promise<JournalEntry[]> {
    const [entryRows, lineRows] = await Promise.all([
      this.db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.tenantId, tenantId))
        .orderBy(asc(journalEntries.date), asc(journalEntries.createdAt)),
      this.db
        .select()
        .from(journalLines)
        .where(eq(journalLines.tenantId, tenantId))
        .orderBy(asc(journalLines.lineOrder)),
    ]);
    const linesByEntry = new Map<string, JournalLine[]>();
    for (const row of lineRows) {
      const list = linesByEntry.get(row.journalEntryId) ?? [];
      list.push({
        id: row.id,
        accountCode: row.accountCode,
        debit: row.debit,
        credit: row.credit,
        memo: row.memo,
      });
      linesByEntry.set(row.journalEntryId, list);
    }
    return entryRows.map((row: DrizzleSqliteClient) =>
      this.mapEntry(row, linesByEntry.get(row.id) ?? []),
    );
  }

  async getJournalEntry(tenantId: string, entryId: string): Promise<JournalEntry | null> {
    const [row] = await this.db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, entryId)))
      .limit(1);
    if (!row) return null;
    const lineRows = await this.db
      .select()
      .from(journalLines)
      .where(
        and(eq(journalLines.tenantId, tenantId), eq(journalLines.journalEntryId, entryId)),
      )
      .orderBy(asc(journalLines.lineOrder));
    return this.mapEntry(
      row,
      lineRows.map((l: DrizzleSqliteClient) => ({
        id: l.id,
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
    );
  }

  async listPeriods(tenantId: string): Promise<AccountingPeriod[]> {
    const rows = await this.db
      .select()
      .from(accountingPeriods)
      .where(eq(accountingPeriods.tenantId, tenantId))
      .orderBy(asc(accountingPeriods.period));
    return rows.map(this.mapPeriod);
  }

  async getPeriod(tenantId: string, period: string): Promise<AccountingPeriod | null> {
    const [row] = await this.db
      .select()
      .from(accountingPeriods)
      .where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.period, period)))
      .limit(1);
    return row ? this.mapPeriod(row) : null;
  }

  async savePeriod(tenantId: string, period: AccountingPeriod): Promise<void> {
    await this.db
      .insert(accountingPeriods)
      .values({
        id: period.id,
        tenantId,
        period: period.period,
        status: period.status,
        closedAt: period.closedAt ?? null,
        closingEntryId: period.closingEntryId ?? null,
        reopenedAt: period.reopenedAt ?? null,
        createdAt: period.createdAt,
        updatedAt: period.updatedAt,
      })
      .onConflictDoUpdate({
        target: accountingPeriods.id,
        set: {
          status: period.status,
          closedAt: period.closedAt ?? null,
          closingEntryId: period.closingEntryId ?? null,
          reopenedAt: period.reopenedAt ?? null,
          updatedAt: period.updatedAt,
        },
        where: eq(accountingPeriods.tenantId, tenantId),
      });
  }

  async listAuditLogs(tenantId: string): Promise<AuditLog[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId))
      .orderBy(asc(auditLogs.createdAt));
    return rows.map(this.mapAudit);
  }

  async appendAuditLog(tenantId: string, log: AuditLog): Promise<void> {
    await this.db.insert(auditLogs).values(this.auditRow(tenantId, log));
  }

  async commitPosting(tenantId: string, bundle: CommitPostingBundle): Promise<void> {
    const statements: unknown[] = [];
    const itemDeltaMap = new Map(
      (bundle.concurrencyChecks?.items ?? []).map((c) => [c.id, c]),
    );
    const invoiceDeltaMap = new Map(
      (bundle.concurrencyChecks?.invoices ?? []).map((c) => [c.id, c]),
    );

    for (const entry of bundle.journalEntriesToInsert ?? []) {
      statements.push(this.db.insert(journalEntries).values(this.entryRow(tenantId, entry)));
      if (entry.lines.length) {
        this.pushChunked(
          statements,
          entry.lines.map((line, idx) => this.lineRow(tenantId, entry.id, idx, line)),
          8,
          (chunk) => this.db.insert(journalLines).values(chunk),
        );
      }
    }

    for (const entry of bundle.journalEntriesToUpdate ?? []) {
      statements.push(
        this.db
          .update(journalEntries)
          .set({
            status: entry.status,
            reversedByEntryId: entry.reversedByEntryId ?? null,
            voidReason: entry.voidReason ?? null,
            voidedAt: entry.voidedAt ?? null,
            updatedAt: entry.updatedAt,
          })
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, entry.id))),
      );
    }

    for (const item of bundle.itemsToUpdate ?? []) {
      const delta = itemDeltaMap.get(item.id);
      if (delta) {
        // Relative delta update so SQLite BEFORE UPDATE trigger catches concurrent oversell/negative stock atomically
        statements.push(
          this.db
            .update(items)
            .set({
              quantityOnHand: sql`ROUND(${items.quantityOnHand} + ${delta.qtyDelta}, 6)`,
              totalInventoryValue: sql`${items.totalInventoryValue} + ${delta.valueDelta}`,
              movingAverageCost: sql`CASE WHEN ROUND(${items.quantityOnHand} + ${delta.qtyDelta}, 6) > 0 THEN CAST((${items.totalInventoryValue} + ${delta.valueDelta}) AS REAL) / ROUND(${items.quantityOnHand} + ${delta.qtyDelta}, 6) ELSE 0 END`,
              updatedAt: item.updatedAt,
            })
            .where(and(eq(items.tenantId, tenantId), eq(items.id, item.id))),
        );
      } else {
        statements.push(
          this.db
            .update(items)
            .set({
              quantityOnHand: item.quantityOnHand,
              totalInventoryValue: item.totalInventoryValue,
              movingAverageCost: item.movingAverageCost,
              updatedAt: item.updatedAt,
            })
            .where(and(eq(items.tenantId, tenantId), eq(items.id, item.id))),
        );
      }
    }

    if (bundle.movementsToInsert?.length) {
      this.pushChunked(statements, bundle.movementsToInsert, 18, (chunk) =>
        this.db
          .insert(inventoryMovements)
          .values(chunk.map((m) => this.movementRow(tenantId, m))),
      );
    }

    if (bundle.invoicesToInsert?.length) {
      this.pushChunked(statements, bundle.invoicesToInsert, 14, (chunk) =>
        this.db
          .insert(invoices)
          .values(chunk.map((inv) => this.invoiceRow(tenantId, inv))),
      );
    }

    for (const inv of bundle.invoicesToUpdate ?? []) {
      const delta = invoiceDeltaMap.get(inv.id);
      if (delta) {
        // Relative delta update so SQLite BEFORE UPDATE trigger catches concurrent overpayment atomically
        statements.push(
          this.db
            .update(invoices)
            .set({
              paidAmount: sql`${invoices.paidAmount} + ${delta.paidDelta}`,
              remainingAmount: sql`${invoices.remainingAmount} + ${delta.remainingDelta}`,
              status: sql`CASE WHEN (${invoices.remainingAmount} + ${delta.remainingDelta}) = 0 THEN 'paid' WHEN (${invoices.paidAmount} + ${delta.paidDelta}) > 0 THEN 'partial' ELSE 'open' END`,
              updatedAt: inv.updatedAt,
            })
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, inv.id))),
        );
      } else {
        statements.push(
          this.db
            .update(invoices)
            .set({
              paidAmount: inv.paidAmount,
              remainingAmount: inv.remainingAmount,
              status: inv.status,
              updatedAt: inv.updatedAt,
            })
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, inv.id))),
        );
      }
    }

    if (bundle.invoicePaymentsToInsert?.length) {
      this.pushChunked(statements, bundle.invoicePaymentsToInsert, 9, (chunk) =>
        this.db
          .insert(invoicePayments)
          .values(chunk.map((p) => this.paymentRow(tenantId, p))),
      );
    }

    for (const pay of bundle.invoicePaymentsToUpdate ?? []) {
      statements.push(
        this.db
          .update(invoicePayments)
          .set({
            status: pay.status,
            voidedAt: pay.voidedAt ?? null,
          })
          .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.id, pay.id))),
      );
    }

    for (const period of bundle.periodsToUpsert ?? []) {
      statements.push(
        this.db
          .insert(accountingPeriods)
          .values({
            id: period.id,
            tenantId,
            period: period.period,
            status: period.status,
            closedAt: period.closedAt ?? null,
            closingEntryId: period.closingEntryId ?? null,
            reopenedAt: period.reopenedAt ?? null,
            createdAt: period.createdAt,
            updatedAt: period.updatedAt,
          })
          .onConflictDoUpdate({
            target: accountingPeriods.id,
            set: {
              status: period.status,
              closedAt: period.closedAt ?? null,
              closingEntryId: period.closingEntryId ?? null,
              reopenedAt: period.reopenedAt ?? null,
              updatedAt: period.updatedAt,
            },
            where: eq(accountingPeriods.tenantId, tenantId),
          }),
      );
    }

    if (bundle.auditLogsToInsert?.length) {
      this.pushChunked(statements, bundle.auditLogsToInsert, 10, (chunk) =>
        this.db
          .insert(auditLogs)
          .values(chunk.map((log) => this.auditRow(tenantId, log))),
      );
    }

    await this.runStatements(statements);
  }

  private itemRow(tenantId: string, item: Item) {
    return {
      id: item.id,
      tenantId,
      sku: item.sku ?? null,
      name: item.name,
      category: item.category,
      unit: item.unit,
      trackInventory: item.trackInventory,
      inventoryAccountCode: item.inventoryAccountCode ?? null,
      cogsAccountCode: item.cogsAccountCode ?? null,
      revenueAccountCode: item.revenueAccountCode ?? null,
      quantityOnHand: item.quantityOnHand,
      totalInventoryValue: item.totalInventoryValue,
      movingAverageCost: item.movingAverageCost,
      defaultSalePrice: item.defaultSalePrice,
      defaultPurchaseCost: item.defaultPurchaseCost,
      active: item.active,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private entryRow(tenantId: string, entry: JournalEntry) {
    return {
      id: entry.id,
      tenantId,
      documentNumber: entry.documentNumber,
      source: entry.source,
      type: entry.type,
      date: entry.date,
      period: entry.period,
      description: entry.description,
      status: entry.status,
      amount: entry.amount,
      partyId: entry.partyId ?? null,
      partyName: entry.partyName ?? null,
      itemId: entry.itemId ?? null,
      itemName: entry.itemName ?? null,
      invoiceId: entry.invoiceId ?? null,
      paymentAccountCode: entry.paymentAccountCode ?? null,
      reversesEntryId: entry.reversesEntryId ?? null,
      reversedByEntryId: entry.reversedByEntryId ?? null,
      voidReason: entry.voidReason ?? null,
      voidedAt: entry.voidedAt ?? null,
      metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private lineRow(tenantId: string, journalEntryId: string, lineOrder: number, line: JournalLine) {
    return {
      id: line.id ?? `${journalEntryId}-ln-${lineOrder}`,
      tenantId,
      journalEntryId,
      lineOrder,
      accountCode: line.accountCode,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo ?? null,
    };
  }

  private movementRow(tenantId: string, m: InventoryMovement) {
    return {
      id: m.id,
      tenantId,
      itemId: m.itemId,
      journalEntryId: m.journalEntryId,
      date: m.date,
      type: m.type,
      quantityDelta: m.quantityDelta,
      unitCost: m.unitCost,
      totalCost: m.totalCost,
      balanceQtyAfter: m.balanceQtyAfter,
      balanceValueAfter: m.balanceValueAfter,
      movingAverageAfter: m.movingAverageAfter,
      referenceDoc: m.referenceDoc,
      notes: m.notes ?? null,
      reversesMovementId: m.reversesMovementId ?? null,
      batchRef: m.batchRef ?? null,
      costComponentsJson: m.costComponents ? JSON.stringify(m.costComponents) : null,
      createdAt: m.createdAt,
    };
  }

  private invoiceRow(tenantId: string, inv: Invoice) {
    return {
      id: inv.id,
      tenantId,
      kind: inv.kind,
      invoiceNumber: inv.invoiceNumber,
      partyId: inv.partyId,
      partyName: inv.partyName,
      journalEntryId: inv.journalEntryId,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate ?? null,
      totalAmount: inv.totalAmount,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      status: inv.status,
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
    };
  }

  private paymentRow(tenantId: string, p: InvoicePayment) {
    return {
      id: p.id,
      tenantId,
      invoiceId: p.invoiceId,
      partyId: p.partyId,
      journalEntryId: p.journalEntryId,
      paymentDate: p.paymentDate,
      amount: p.amount,
      status: p.status,
      voidedAt: p.voidedAt ?? null,
      createdAt: p.createdAt,
    };
  }

  private auditRow(tenantId: string, log: AuditLog) {
    return {
      id: log.id,
      tenantId,
      actorId: log.actorId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      summary: log.summary,
      beforeJson: log.beforeJson ?? null,
      afterJson: log.afterJson ?? null,
      createdAt: log.createdAt,
    };
  }

  private mapAccount = (row: DrizzleSqliteClient): Account => ({
    code: row.code,
    name: row.name,
    category: row.category,
    group: row.group,
    nature: row.nature,
    normal: row.normal,
    active: Boolean(row.active),
  });

  private mapParty = (row: DrizzleSqliteClient): Party => ({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type,
    phone: row.phone,
    address: row.address,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapItem = (row: DrizzleSqliteClient): Item => ({
    id: row.id,
    tenantId: row.tenantId,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    trackInventory: Boolean(row.trackInventory),
    inventoryAccountCode: row.inventoryAccountCode,
    cogsAccountCode: row.cogsAccountCode,
    revenueAccountCode: row.revenueAccountCode ?? null,
    quantityOnHand: Number(row.quantityOnHand),
    totalInventoryValue: Number(row.totalInventoryValue),
    movingAverageCost: Number(row.movingAverageCost),
    defaultSalePrice: Number(row.defaultSalePrice),
    defaultPurchaseCost: Number(row.defaultPurchaseCost),
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapMovement = (row: DrizzleSqliteClient): InventoryMovement => ({
    id: row.id,
    tenantId: row.tenantId,
    itemId: row.itemId,
    journalEntryId: row.journalEntryId,
    date: row.date,
    type: row.type,
    quantityDelta: Number(row.quantityDelta),
    unitCost: Number(row.unitCost),
    totalCost: Number(row.totalCost),
    balanceQtyAfter: Number(row.balanceQtyAfter),
    balanceValueAfter: Number(row.balanceValueAfter),
    movingAverageAfter: Number(row.movingAverageAfter),
    referenceDoc: row.referenceDoc,
    notes: row.notes,
    reversesMovementId: row.reversesMovementId,
    batchRef: row.batchRef,
    costComponents: row.costComponentsJson ? JSON.parse(row.costComponentsJson) : null,
    createdAt: row.createdAt,
  });

  private mapInvoice = (row: DrizzleSqliteClient): Invoice => ({
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    invoiceNumber: row.invoiceNumber,
    partyId: row.partyId,
    partyName: row.partyName,
    journalEntryId: row.journalEntryId,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    totalAmount: Number(row.totalAmount),
    paidAmount: Number(row.paidAmount),
    remainingAmount: Number(row.remainingAmount),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapPayment = (row: DrizzleSqliteClient): InvoicePayment => ({
    id: row.id,
    tenantId: row.tenantId,
    invoiceId: row.invoiceId,
    partyId: row.partyId,
    journalEntryId: row.journalEntryId,
    paymentDate: row.paymentDate,
    amount: Number(row.amount),
    status: row.status,
    voidedAt: row.voidedAt,
    createdAt: row.createdAt,
  });

  private mapEntry = (row: DrizzleSqliteClient, lines: JournalLine[]): JournalEntry => ({
    id: row.id,
    tenantId: row.tenantId,
    documentNumber: row.documentNumber,
    source: row.source,
    type: row.type,
    date: row.date,
    period: row.period,
    description: row.description,
    status: row.status,
    amount: Number(row.amount),
    partyId: row.partyId,
    partyName: row.partyName,
    itemId: row.itemId,
    itemName: row.itemName,
    invoiceId: row.invoiceId,
    paymentAccountCode: row.paymentAccountCode,
    reversesEntryId: row.reversesEntryId,
    reversedByEntryId: row.reversedByEntryId,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt,
    metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapPeriod = (row: DrizzleSqliteClient): AccountingPeriod => ({
    id: row.id,
    tenantId: row.tenantId,
    period: row.period,
    status: row.status,
    closedAt: row.closedAt,
    closingEntryId: row.closingEntryId,
    reopenedAt: row.reopenedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapAudit = (row: DrizzleSqliteClient): AuditLog => ({
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    createdAt: row.createdAt,
  });
}

export const D1AccountingRepository = DrizzleSqliteAccountingRepository;
