-- Rollback for migration 090. Deploy app code without the option first.
ALTER TABLE quiz_offers
  DROP COLUMN IF EXISTS bundle_discount_once_per_customer;
