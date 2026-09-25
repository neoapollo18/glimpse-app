-- Migration 077: discount code reveal on quiz lead capture
--
-- When a merchant sets quiz_lead_discount_code, submitting an email on the
-- lead step reveals the code on-page and the widget hits the storefront
-- /discount/{code} endpoint so Shopify applies it to the shopper's checkout
-- automatically. Copy default for the reveal message lives in code
-- (getChatAssistantConfig), matching every other quiz copy field.
--
-- The code itself must be an existing Shopify discount code — Gleame never
-- creates discounts, it only reveals/applies one the merchant made.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_lead_discount_code text,
  ADD COLUMN IF NOT EXISTS quiz_lead_discount_message text;

COMMENT ON COLUMN chat_assistant_config.quiz_lead_discount_code IS
  'Shopify discount code revealed after a shopper submits the lead step; auto-applied to checkout via /discount/{code}. NULL = no discount reveal.';
COMMENT ON COLUMN chat_assistant_config.quiz_lead_discount_message IS
  'Copy shown with the revealed code. NULL = code default in app code.';
