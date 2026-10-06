-- Migration 084: remember each shop's currency (Shopify shop.currencyCode).
--
-- Prices were formatted as USD wherever Shopify's storefront currency
-- object isn't available (Studio preview, generated budget answers like
-- "Under $40", catalog text given to the AI). Filled lazily from the Admin
-- API by the Studio and the generator (rememberShopCurrency); NULL = not
-- known yet (callers fall back to the previous USD behaviour).
--
-- Run BEFORE deploying app code (reads tolerate the column missing). Safe
-- to re-run.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS currency_code TEXT;

COMMENT ON COLUMN shops.currency_code IS
  'ISO 4217 store currency from Shopify shop.currencyCode. NULL = unknown (USD formatting fallback).';
