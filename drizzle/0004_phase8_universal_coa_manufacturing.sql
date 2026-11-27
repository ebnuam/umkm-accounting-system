-- Phase 8: Universal multi-sector COA, business sector profile, and per-item revenue mapping.
ALTER TABLE `tenants` ADD COLUMN `business_sector` text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD COLUMN `revenue_account_code` text;
