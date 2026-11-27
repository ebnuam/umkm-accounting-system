import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Legacy single-blob state table preserved for backward-compatible migration.
 */
export const accountingStates = sqliteTable("accounting_states", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  businessName: text("business_name").notNull(),
  city: text("city").notNull().default(""),
  businessSector: text("business_sector").notNull().default("general"),
  activePeriod: text("active_period").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    group: text("group").notNull(),
    nature: text("nature").notNull(),
    normal: text("normal").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("accounts_tenant_code_idx").on(table.tenantId, table.code),
  ],
);

export const parties = sqliteTable(
  "parties",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    phone: text("phone"),
    address: text("address"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("parties_tenant_idx").on(table.tenantId)],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sku: text("sku"),
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    trackInventory: integer("track_inventory", { mode: "boolean" }).notNull().default(true),
    inventoryAccountCode: text("inventory_account_code"),
    cogsAccountCode: text("cogs_account_code"),
    revenueAccountCode: text("revenue_account_code"),
    quantityOnHand: real("quantity_on_hand").notNull().default(0),
    totalInventoryValue: integer("total_inventory_value").notNull().default(0),
    movingAverageCost: real("moving_average_cost").notNull().default(0),
    defaultSalePrice: integer("default_sale_price").notNull().default(0),
    defaultPurchaseCost: integer("default_purchase_cost").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("items_tenant_idx").on(table.tenantId)],
);

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    documentNumber: text("document_number").notNull(),
    source: text("source").notNull(),
    type: text("type").notNull(),
    date: text("date").notNull(),
    period: text("period").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    amount: integer("amount").notNull(),
    partyId: text("party_id"),
    partyName: text("party_name"),
    itemId: text("item_id"),
    itemName: text("item_name"),
    invoiceId: text("invoice_id"),
    paymentAccountCode: text("payment_account_code"),
    reversesEntryId: text("reverses_entry_id"),
    reversedByEntryId: text("reversed_by_entry_id"),
    voidReason: text("void_reason"),
    voidedAt: text("voided_at"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("journal_entries_tenant_date_idx").on(table.tenantId, table.date),
    index("journal_entries_tenant_period_idx").on(table.tenantId, table.period),
  ],
);

export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    journalEntryId: text("journal_entry_id").notNull(),
    lineOrder: integer("line_order").notNull(),
    accountCode: text("account_code").notNull(),
    debit: integer("debit").notNull().default(0),
    credit: integer("credit").notNull().default(0),
    memo: text("memo"),
  },
  (table) => [
    index("journal_lines_tenant_entry_idx").on(table.tenantId, table.journalEntryId),
  ],
);

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    itemId: text("item_id").notNull(),
    journalEntryId: text("journal_entry_id").notNull(),
    date: text("date").notNull(),
    type: text("type").notNull(),
    quantityDelta: real("quantity_delta").notNull(),
    unitCost: real("unit_cost").notNull(),
    totalCost: integer("total_cost").notNull(),
    balanceQtyAfter: real("balance_qty_after").notNull(),
    balanceValueAfter: integer("balance_value_after").notNull(),
    movingAverageAfter: real("moving_average_after").notNull(),
    referenceDoc: text("reference_doc").notNull(),
    notes: text("notes"),
    reversesMovementId: text("reverses_movement_id"),
    batchRef: text("batch_ref"),
    costComponentsJson: text("cost_components_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("inv_movements_tenant_item_idx").on(table.tenantId, table.itemId),
    index("inv_movements_tenant_entry_idx").on(table.tenantId, table.journalEntryId),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    kind: text("kind").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    partyId: text("party_id").notNull(),
    partyName: text("party_name").notNull(),
    journalEntryId: text("journal_entry_id").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date"),
    totalAmount: integer("total_amount").notNull(),
    paidAmount: integer("paid_amount").notNull().default(0),
    remainingAmount: integer("remaining_amount").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("invoices_tenant_party_idx").on(table.tenantId, table.partyId)],
);

export const invoicePayments = sqliteTable(
  "invoice_payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    partyId: text("party_id").notNull(),
    journalEntryId: text("journal_entry_id").notNull(),
    paymentDate: text("payment_date").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull(),
    voidedAt: text("voided_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("invoice_payments_tenant_inv_idx").on(table.tenantId, table.invoiceId),
  ],
);

export const accountingPeriods = sqliteTable(
  "accounting_periods",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    period: text("period").notNull(),
    status: text("status").notNull(),
    closedAt: text("closed_at"),
    closingEntryId: text("closing_entry_id"),
    reopenedAt: text("reopened_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("periods_tenant_period_idx").on(table.tenantId, table.period),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_logs_tenant_idx").on(table.tenantId, table.createdAt)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_unique_idx").on(table.email)],
);

export const businessMemberships = sqliteTable(
  "business_memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    role: text("role").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("memberships_user_tenant_idx").on(table.userId, table.tenantId),
    index("memberships_tenant_idx").on(table.tenantId),
  ],
);

export const userSessions = sqliteTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    activeTenantId: text("active_tenant_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_sessions_token_hash_idx").on(table.tokenHash),
    index("user_sessions_user_idx").on(table.userId),
  ],
);

export const loginRateLimits = sqliteTable("login_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartMs: integer("window_start_ms").notNull(),
  lockedUntilMs: integer("locked_until_ms").notNull().default(0),
});
