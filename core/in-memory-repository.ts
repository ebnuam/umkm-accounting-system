import type { AccountingRepository, CommitPostingBundle } from "./repository.ts";
import type {
  Account,
  AccountingPeriod,
  AuditLog,
  BusinessProfile,
  InventoryMovement,
  Invoice,
  InvoicePayment,
  Item,
  JournalEntry,
  Party,
  TenantWorkspace,
} from "./types.ts";
import { ConcurrencyError, NotFoundError } from "./types.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Deterministic in-memory AccountingRepository for framework-free core testing.
 * Strictly enforces tenantId isolation and optimistic concurrency checks on every commit.
 */
export class InMemoryAccountingRepository implements AccountingRepository {
  private readonly store = new Map<string, TenantWorkspace>();

  private requireStore(tenantId: string): TenantWorkspace {
    const ws = this.store.get(tenantId);
    if (!ws) {
      throw new NotFoundError(`Workspace tenant "${tenantId}" belum diinisialisasi.`);
    }
    return ws;
  }

  async hasWorkspace(tenantId: string): Promise<boolean> {
    return this.store.has(tenantId);
  }

  async initializeWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void> {
    if (this.store.has(tenantId)) return;
    this.store.set(tenantId, clone(workspace));
  }

  async resetWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void> {
    this.store.set(tenantId, clone(workspace));
  }

  async getWorkspace(tenantId: string): Promise<TenantWorkspace> {
    return clone(this.requireStore(tenantId));
  }

  async updateProfile(tenantId: string, profile: BusinessProfile): Promise<void> {
    const ws = this.requireStore(tenantId);
    ws.profile = clone(profile);
  }

  async getAccounts(tenantId: string): Promise<Account[]> {
    return clone(this.requireStore(tenantId).accounts);
  }

  async saveAccount(tenantId: string, account: Account): Promise<void> {
    const ws = this.requireStore(tenantId);
    const idx = ws.accounts.findIndex((a) => a.code === account.code);
    if (idx >= 0) ws.accounts[idx] = clone(account);
    else ws.accounts.push(clone(account));
    ws.accounts.sort((a, b) => a.code.localeCompare(b.code));
  }

  async listParties(tenantId: string): Promise<Party[]> {
    return clone(this.requireStore(tenantId).parties);
  }

  async getParty(tenantId: string, partyId: string): Promise<Party | null> {
    const found = this.requireStore(tenantId).parties.find(
      (p) => p.id === partyId && p.tenantId === tenantId,
    );
    return found ? clone(found) : null;
  }

  async saveParty(tenantId: string, party: Party): Promise<void> {
    const ws = this.requireStore(tenantId);
    const idx = ws.parties.findIndex((p) => p.id === party.id && p.tenantId === tenantId);
    if (idx >= 0) ws.parties[idx] = clone(party);
    else ws.parties.push(clone(party));
  }

  async listItems(tenantId: string): Promise<Item[]> {
    return clone(this.requireStore(tenantId).items);
  }

  async getItem(tenantId: string, itemId: string): Promise<Item | null> {
    const found = this.requireStore(tenantId).items.find(
      (item) => item.id === itemId && item.tenantId === tenantId,
    );
    return found ? clone(found) : null;
  }

  async saveItem(tenantId: string, item: Item): Promise<void> {
    const ws = this.requireStore(tenantId);
    const idx = ws.items.findIndex((i) => i.id === item.id && i.tenantId === tenantId);
    if (idx >= 0) ws.items[idx] = clone(item);
    else ws.items.push(clone(item));
  }

  async listInventoryMovements(tenantId: string, itemId?: string): Promise<InventoryMovement[]> {
    const ws = this.requireStore(tenantId);
    return clone(
      itemId
        ? ws.inventoryMovements.filter((m) => m.itemId === itemId && m.tenantId === tenantId)
        : ws.inventoryMovements,
    );
  }

  async listMovementsByJournalEntry(
    tenantId: string,
    journalEntryId: string,
  ): Promise<InventoryMovement[]> {
    const ws = this.requireStore(tenantId);
    return clone(
      ws.inventoryMovements.filter(
        (m) => m.journalEntryId === journalEntryId && m.tenantId === tenantId,
      ),
    );
  }

  async listInvoices(tenantId: string): Promise<Invoice[]> {
    return clone(this.requireStore(tenantId).invoices);
  }

  async getInvoice(tenantId: string, invoiceId: string): Promise<Invoice | null> {
    const found = this.requireStore(tenantId).invoices.find(
      (inv) => inv.id === invoiceId && inv.tenantId === tenantId,
    );
    return found ? clone(found) : null;
  }

  async listInvoicePayments(tenantId: string, invoiceId?: string): Promise<InvoicePayment[]> {
    const ws = this.requireStore(tenantId);
    return clone(
      invoiceId
        ? ws.invoicePayments.filter((p) => p.invoiceId === invoiceId && p.tenantId === tenantId)
        : ws.invoicePayments,
    );
  }

  async listJournalEntries(tenantId: string): Promise<JournalEntry[]> {
    return clone(this.requireStore(tenantId).journalEntries);
  }

  async getJournalEntry(tenantId: string, entryId: string): Promise<JournalEntry | null> {
    const found = this.requireStore(tenantId).journalEntries.find(
      (entry) => entry.id === entryId && entry.tenantId === tenantId,
    );
    return found ? clone(found) : null;
  }

  async listPeriods(tenantId: string): Promise<AccountingPeriod[]> {
    return clone(this.requireStore(tenantId).periods);
  }

  async getPeriod(tenantId: string, period: string): Promise<AccountingPeriod | null> {
    const found = this.requireStore(tenantId).periods.find(
      (p) => p.period === period && p.tenantId === tenantId,
    );
    return found ? clone(found) : null;
  }

  async savePeriod(tenantId: string, period: AccountingPeriod): Promise<void> {
    const ws = this.requireStore(tenantId);
    const idx = ws.periods.findIndex((p) => p.period === period.period && p.tenantId === tenantId);
    if (idx >= 0) ws.periods[idx] = clone(period);
    else ws.periods.push(clone(period));
  }

  async listAuditLogs(tenantId: string): Promise<AuditLog[]> {
    return clone(this.requireStore(tenantId).auditLogs);
  }

  async appendAuditLog(tenantId: string, log: AuditLog): Promise<void> {
    const ws = this.requireStore(tenantId);
    ws.auditLogs.push(clone(log));
  }

  async commitPosting(tenantId: string, bundle: CommitPostingBundle): Promise<void> {
    const ws = this.requireStore(tenantId);
    // Stage copy for atomic rollback if anything fails
    const staged = clone(ws);

    // Optimistic concurrency checks against latest committed state
    for (const check of bundle.concurrencyChecks?.items ?? []) {
      const current = staged.items.find((i) => i.id === check.id && i.tenantId === tenantId);
      if (!current) throw new NotFoundError(`Barang "${check.id}" tidak ditemukan.`);
      if (
        Math.abs(current.quantityOnHand - check.expectedQty) > 1e-6 ||
        current.totalInventoryValue !== check.expectedValue
      ) {
        throw new ConcurrencyError(
          `Stok "${current.name}" berubah oleh transaksi lain. Silakan ulangi transaksi.`,
        );
      }
    }

    for (const check of bundle.concurrencyChecks?.invoices ?? []) {
      const current = staged.invoices.find((i) => i.id === check.id && i.tenantId === tenantId);
      if (!current) throw new NotFoundError(`Faktur "${check.id}" tidak ditemukan.`);
      if (current.remainingAmount !== check.expectedRemaining) {
        throw new ConcurrencyError(
          `Saldo faktur "${current.invoiceNumber}" berubah oleh transaksi lain. Silakan ulangi.`,
        );
      }
    }

    for (const entryId of bundle.concurrencyChecks?.voidingEntryIds ?? []) {
      const current = staged.journalEntries.find((e) => e.id === entryId && e.tenantId === tenantId);
      if (!current) throw new NotFoundError(`Jurnal "${entryId}" tidak ditemukan.`);
      if (current.status !== "posted") {
        throw new ConcurrencyError(`Jurnal "${current.documentNumber}" sudah dibatalkan oleh permintaan lain.`);
      }
    }

    for (const entry of bundle.journalEntriesToInsert ?? []) {
      staged.journalEntries.push(clone(entry));
    }
    for (const entry of bundle.journalEntriesToUpdate ?? []) {
      const idx = staged.journalEntries.findIndex(
        (e) => e.id === entry.id && e.tenantId === tenantId,
      );
      if (idx < 0) throw new NotFoundError(`Jurnal "${entry.id}" tidak ditemukan.`);
      staged.journalEntries[idx] = clone(entry);
    }
    for (const item of bundle.itemsToUpdate ?? []) {
      const idx = staged.items.findIndex((i) => i.id === item.id && i.tenantId === tenantId);
      if (idx < 0) throw new NotFoundError(`Barang "${item.id}" tidak ditemukan.`);
      staged.items[idx] = clone(item);
    }
    for (const movement of bundle.movementsToInsert ?? []) {
      staged.inventoryMovements.push(clone(movement));
    }
    for (const invoice of bundle.invoicesToInsert ?? []) {
      staged.invoices.push(clone(invoice));
    }
    for (const invoice of bundle.invoicesToUpdate ?? []) {
      const idx = staged.invoices.findIndex(
        (i) => i.id === invoice.id && i.tenantId === tenantId,
      );
      if (idx < 0) throw new NotFoundError(`Faktur "${invoice.id}" tidak ditemukan.`);
      staged.invoices[idx] = clone(invoice);
    }
    for (const payment of bundle.invoicePaymentsToInsert ?? []) {
      staged.invoicePayments.push(clone(payment));
    }
    for (const payment of bundle.invoicePaymentsToUpdate ?? []) {
      const idx = staged.invoicePayments.findIndex(
        (p) => p.id === payment.id && p.tenantId === tenantId,
      );
      if (idx < 0) throw new NotFoundError(`Pembayaran faktur "${payment.id}" tidak ditemukan.`);
      staged.invoicePayments[idx] = clone(payment);
    }
    for (const period of bundle.periodsToUpsert ?? []) {
      const idx = staged.periods.findIndex(
        (p) => p.period === period.period && p.tenantId === tenantId,
      );
      if (idx >= 0) staged.periods[idx] = clone(period);
      else staged.periods.push(clone(period));
    }
    for (const log of bundle.auditLogsToInsert ?? []) {
      staged.auditLogs.push(clone(log));
    }

    this.store.set(tenantId, staged);
  }
}
