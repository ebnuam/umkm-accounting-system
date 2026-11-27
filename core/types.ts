/**
 * Core domain models and typed errors for the UMKM accounting engine.
 * Zero framework or database dependencies.
 */

export type AccountGroup =
  | "asset"
  | "contra_asset"
  | "liability"
  | "equity"
  | "drawing"
  | "revenue"
  | "expense"
  | "closing";

export type AccountNature = "real" | "nominal";
export type NormalBalance = "debit" | "credit";

export interface Account {
  code: string;
  name: string;
  category: string;
  group: AccountGroup;
  nature: AccountNature;
  normal: NormalBalance;
  active: boolean;
}

export type BusinessSector = "general" | "trading" | "service" | "manufacturing";
export type ItemCategory = "raw_material" | "finished_good" | "wip" | "equipment" | "service";

export interface CostComponentPlaceholder {
  kind: "material" | "labor" | "overhead";
  amount: number;
  note?: string;
}

export interface Item {
  id: string;
  tenantId: string;
  sku?: string | null;
  name: string;
  category: ItemCategory;
  unit: string;
  trackInventory: boolean;
  inventoryAccountCode: string | null;
  cogsAccountCode: string | null;
  revenueAccountCode?: string | null;
  quantityOnHand: number;
  totalInventoryValue: number;
  movingAverageCost: number;
  defaultSalePrice: number;
  defaultPurchaseCost: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementType =
  | "opening"
  | "purchase"
  | "sale"
  | "opname_in"
  | "opname_out"
  | "usage_out"
  | "production_in"
  | "void_reversal";

export interface InventoryMovement {
  id: string;
  tenantId: string;
  itemId: string;
  journalEntryId: string;
  date: string;
  type: InventoryMovementType;
  quantityDelta: number;
  unitCost: number;
  totalCost: number;
  balanceQtyAfter: number;
  balanceValueAfter: number;
  movingAverageAfter: number;
  referenceDoc: string;
  notes?: string | null;
  reversesMovementId?: string | null;
  batchRef?: string | null;
  costComponents?: CostComponentPlaceholder[] | null;
  createdAt: string;
}

export type PartyType = "customer" | "supplier" | "both";

export interface Party {
  id: string;
  tenantId: string;
  name: string;
  type: PartyType;
  phone?: string | null;
  address?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceKind = "receivable" | "payable";
export type InvoiceStatus = "open" | "partial" | "paid" | "voided";

export interface Invoice {
  id: string;
  tenantId: string;
  kind: InvoiceKind;
  invoiceNumber: string;
  partyId: string;
  partyName: string;
  journalEntryId: string;
  issueDate: string;
  dueDate?: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePayment {
  id: string;
  tenantId: string;
  invoiceId: string;
  partyId: string;
  journalEntryId: string;
  paymentDate: string;
  amount: number;
  status: "posted" | "voided";
  voidedAt?: string | null;
  createdAt: string;
}

export type JournalSource = "transaction" | "adjustment" | "opname" | "closing" | "reversal";
export type JournalStatus = "posted" | "voided";

export type TransactionKind =
  | "capital"
  | "cash_sale"
  | "credit_sale"
  | "inventory_cash"
  | "inventory_credit"
  | "equipment_cash"
  | "equipment_credit"
  | "collect_receivable"
  | "pay_payable"
  | "cash_expense"
  | "drawing"
  | "material_usage"
  | "production_transfer"
  | "production_run"
  | "general_journal"
  | "stock_opname"
  | "depreciation"
  | "accrued_expense"
  | "opening_balance"
  | "period_closing"
  | "reversal";

export interface JournalLine {
  id?: string;
  accountCode: string;
  debit: number;
  credit: number;
  memo?: string | null;
}

export interface JournalEntry {
  id: string;
  tenantId: string;
  documentNumber: string;
  source: JournalSource;
  type: TransactionKind;
  date: string;
  period: string;
  description: string;
  status: JournalStatus;
  amount: number;
  partyId?: string | null;
  partyName?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  invoiceId?: string | null;
  paymentAccountCode?: string | null;
  reversesEntryId?: string | null;
  reversedByEntryId?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  lines: JournalLine[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountingPeriod {
  id: string;
  tenantId: string;
  period: string; // YYYY-MM
  status: "open" | "closed";
  closedAt?: string | null;
  closingEntryId?: string | null;
  reopenedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  beforeJson?: string | null;
  afterJson?: string | null;
  createdAt: string;
}

export interface BusinessProfile {
  tenantId: string;
  businessName: string;
  city: string;
  businessSector?: BusinessSector;
  activePeriod: string; // YYYY-MM
  updatedAt: string;
}

export interface TenantWorkspace {
  profile: BusinessProfile;
  accounts: Account[];
  parties: Party[];
  items: Item[];
  inventoryMovements: InventoryMovement[];
  invoices: Invoice[];
  invoicePayments: InvoicePayment[];
  journalEntries: JournalEntry[];
  periods: AccountingPeriod[];
  auditLogs: AuditLog[];
}

export class AccountingError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AccountingError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AccountingError {
  constructor(message: string, code = "VALIDATION_ERROR") {
    super(code, message, 400);
    this.name = "ValidationError";
  }
}

export class InsufficientStockError extends AccountingError {
  constructor(message: string) {
    super("INSUFFICIENT_STOCK", message, 409);
    this.name = "InsufficientStockError";
  }
}

export class OverpaymentError extends AccountingError {
  constructor(message: string) {
    super("OVERPAYMENT", message, 409);
    this.name = "OverpaymentError";
  }
}

export class ClosedPeriodError extends AccountingError {
  constructor(message: string) {
    super("CLOSED_PERIOD", message, 409);
    this.name = "ClosedPeriodError";
  }
}

export class NotFoundError extends AccountingError {
  constructor(message: string) {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends AccountingError {
  constructor(message: string) {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class ConcurrencyError extends AccountingError {
  constructor(message = "Data berubah bersamaan oleh permintaan lain. Muat ulang lalu coba lagi.") {
    super("CONCURRENCY_CONFLICT", message, 409);
    this.name = "ConcurrencyError";
  }
}
