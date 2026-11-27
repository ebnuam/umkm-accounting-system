CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique_idx` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `business_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `memberships_user_tenant_idx` ON `business_memberships` (`user_id`,`tenant_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memberships_tenant_idx` ON `business_memberships` (`tenant_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`active_tenant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_sessions_token_hash_idx` ON `user_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_sessions_user_idx` ON `user_sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `login_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_start_ms` integer NOT NULL,
	`locked_until_ms` integer DEFAULT 0 NOT NULL
);
