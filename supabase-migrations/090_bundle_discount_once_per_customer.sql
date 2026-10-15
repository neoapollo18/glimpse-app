-- Migration 090: optional "one use per customer" on the managed bundle
-- discount.
--
-- Until now every Gleame-created bundle code was limited to one use per
-- customer, so a returning customer (or Shopify's app reviewer re-testing
-- with the same account) silently got no discount on a later bundle. The
-- limit is now a merchant option on Studio > Sell more > Bundle & discount,
-- off by default. Existing rows read as off; no managed discount exists in
-- Shopify yet, so nothing needs re-syncing.
--
-- Run BEFORE deploying app code: saving a Gleame-managed bundle discount
-- writes this column. Additive and safe to re-run.

ALTER TABLE quiz_offers
  ADD COLUMN IF NOT EXISTS bundle_discount_once_per_customer boolean NOT NULL DEFAULT false;
