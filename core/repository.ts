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

export interface CommitConcurrencyChecks {
  items?: Array<{
    id: string;
    expectedQty: number;
    expectedValue: number;
    qtyDelta: number;
    valueDelta: number;
  }>;
  invoices?: Array<{
    id: string;
    expectedRemaining: number;
    paidDelta: number;
    remainingDelta: number;
  }>;
  voidingEntryIds?: string[];
}

export interface CommitPostingBundle {
  journalEntriesToInsert?: JournalEntry[];
  journalEntriesToUpdate?: JournalEntry[];
  itemsToUpdate?: Item[];
  movementsToInsert?: InventoryMovement[];
  invoicesToInsert?: Invoice[];
  invoicesToUpdate?: Invoice[];
  invoicePaymentsToInsert?: InvoicePayment[];
  invoicePaymentsToUpdate?: InvoicePayment[];
  periodsToUpsert?: AccountingPeriod[];
  auditLogsToInsert?: AuditLog[];
  concurrencyChecks?: CommitConcurrencyChecks;
}

/**
 * Storage-agnostic repository contract for tenant-scoped accounting persistence.
 * Implemented by InMemoryAccountingRepository (tests) and D1AccountingRepository (Cloudflare D1).
 * Designed so a future LocalSqliteRepository can implement the exact same interface.
 */
export interface AccountingRepository {
  hasWorkspace(tenantId: string): Promise<boolean>;
  initializeWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void>;
  resetWorkspace(tenantId: string, workspace: TenantWorkspace): Promise<void>;
  getWorkspace(tenantId: string): Promise<TenantWorkspace>;

  updateProfile(tenantId: string, profile: BusinessProfile): Promise<void>;

  getAccounts(tenantId: string): Promise<Account[]>;
  saveAccount(tenantId: string, account: Account): Promise<void>;

  listParties(tenantId: string): Promise<Party[]>;
  getParty(tenantId: string, partyId: string): Promise<Party | null>;
  saveParty(tenantId: string, party: Party): Promise<void>;

  listItems(tenantId: string): Promise<Item[]>;
  getItem(tenantId: string, itemId: string): Promise<Item | null>;
  saveItem(tenantId: string, item: Item): Promise<void>;

  listInventoryMovements(tenantId: string, itemId?: string): Promise<InventoryMovement[]>;
  listMovementsByJournalEntry(tenantId: string, journalEntryId: string): Promise<InventoryMovement[]>;

  listInvoices(tenantId: string): Promise<Invoice[]>;
  getInvoice(tenantId: string, invoiceId: string): Promise<Invoice | null>;
  listInvoicePayments(tenantId: string, invoiceId?: string): Promise<InvoicePayment[]>;

  listJournalEntries(tenantId: string): Promise<JournalEntry[]>;
  getJournalEntry(tenantId: string, entryId: string): Promise<JournalEntry | null>;

  listPeriods(tenantId: string): Promise<AccountingPeriod[]>;
  getPeriod(tenantId: string, period: string): Promise<AccountingPeriod | null>;
  savePeriod(tenantId: string, period: AccountingPeriod): Promise<void>;

  listAuditLogs(tenantId: string): Promise<AuditLog[]>;
  appendAuditLog(tenantId: string, log: AuditLog): Promise<void>;

  /**
   * Atomically persists a full posting bundle (journal entries, item updates, movements,
   * invoices/payments, period updates, and audit logs) for a single tenant.
   */
  commitPosting(tenantId: string, bundle: CommitPostingBundle): Promise<void>;
}
