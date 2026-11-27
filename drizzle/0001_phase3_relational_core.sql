CREATE TABLE IF NOT EXISTS `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`business_name` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`active_period` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`group` text NOT NULL,
	`nature` text NOT NULL,
	`normal` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `accounts_tenant_code_idx` ON `accounts` (`tenant_id`,`code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`phone` text,
	`address` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `parties_tenant_idx` ON `parties` (`tenant_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sku` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`track_inventory` integer DEFAULT true NOT NULL,
	`inventory_account_code` text,
	`cogs_account_code` text,
	`quantity_on_hand` real DEFAULT 0 NOT NULL,
	`total_inventory_value` integer DEFAULT 0 NOT NULL,
	`moving_average_cost` real DEFAULT 0 NOT NULL,
	`default_sale_price` integer DEFAULT 0 NOT NULL,
	`default_purchase_cost` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `items_tenant_idx` ON `items` (`tenant_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_number` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`period` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`party_id` text,
	`party_name` text,
	`item_id` text,
	`item_name` text,
	`invoice_id` text,
	`payment_account_code` text,
	`reverses_entry_id` text,
	`reversed_by_entry_id` text,
	`void_reason` text,
	`voided_at` text,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `journal_entries_tenant_date_idx` ON `journal_entries` (`tenant_id`,`date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `journal_entries_tenant_period_idx` ON `journal_entries` (`tenant_id`,`period`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`line_order` integer NOT NULL,
	`account_code` text NOT NULL,
	`debit` integer DEFAULT 0 NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`memo` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `journal_lines_tenant_entry_idx` ON `journal_lines` (`tenant_id`,`journal_entry_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`quantity_delta` real NOT NULL,
	`unit_cost` real NOT NULL,
	`total_cost` integer NOT NULL,
	`balance_qty_after` real NOT NULL,
	`balance_value_after` integer NOT NULL,
	`moving_average_after` real NOT NULL,
	`reference_doc` text NOT NULL,
	`notes` text,
	`reverses_movement_id` text,
	`batch_ref` text,
	`cost_components_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inv_movements_tenant_item_idx` ON `inventory_movements` (`tenant_id`,`item_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inv_movements_tenant_entry_idx` ON `inventory_movements` (`tenant_id`,`journal_entry_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`invoice_number` text NOT NULL,
	`party_id` text NOT NULL,
	`party_name` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text,
	`total_amount` integer NOT NULL,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	`remaining_amount` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_tenant_party_idx` ON `invoices` (`tenant_id`,`party_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `invoice_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`party_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`payment_date` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`voided_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoice_payments_tenant_inv_idx` ON `invoice_payments` (`tenant_id`,`invoice_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounting_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`closed_at` text,
	`closing_entry_id` text,
	`reopened_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `periods_tenant_period_idx` ON `accounting_periods` (`tenant_id`,`period`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_tenant_idx` ON `audit_logs` (`tenant_id`,`created_at`);
