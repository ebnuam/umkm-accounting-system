-- Non-destructive hardening constraints & indexes for atomicity and concurrency safety.
CREATE UNIQUE INDEX IF NOT EXISTS `journal_entries_reverses_unique_idx`
  ON `journal_entries` (`tenant_id`, `reverses_entry_id`)
  WHERE `reverses_entry_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_items_no_negative_stock_update`
BEFORE UPDATE ON `items`
FOR EACH ROW
WHEN NEW.`quantity_on_hand` < -0.000001 OR NEW.`total_inventory_value` < 0
BEGIN
  SELECT RAISE(ABORT, 'CHECK_NEGATIVE_STOCK');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoices_no_overpayment_update`
BEFORE UPDATE ON `invoices`
FOR EACH ROW
WHEN NEW.`remaining_amount` < 0 OR NEW.`paid_amount` < 0 OR NEW.`paid_amount` > NEW.`total_amount`
BEGIN
  SELECT RAISE(ABORT, 'CHECK_OVERPAYMENT');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_periods_no_double_close_update`
BEFORE UPDATE ON `accounting_periods`
FOR EACH ROW
WHEN OLD.`status` = 'closed' AND NEW.`status` = 'closed' AND OLD.`closing_entry_id` IS NOT NULL AND NEW.`closing_entry_id` != OLD.`closing_entry_id`
BEGIN
  SELECT RAISE(ABORT, 'CHECK_DOUBLE_PERIOD_CLOSE');
END;
