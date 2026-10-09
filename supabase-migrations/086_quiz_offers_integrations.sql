-- Migration 086: quiz offers (bundle discount + upsell/cross-sell),
-- integrations (Klaviyo), and the compact quiz layout.
--
-- Four groups of changes, all additive:
--   1. chat_assistant_config: quiz_compact_layout + quiz_photo_note
--      (the ORLY mobile rebuild; off by default for every shop).
--   2. quiz_offers: one row per shop with the Studio "Offers" settings.
--      Its own table on purpose: offers are store commerce settings with an
--      external side effect (a Shopify discount Gleame may manage), so they
--      stay OUT of the quiz_* settings namespace that version snapshots,
--      restores and the AI copilot rewrite. A restore must never point the
--      widget at a discount that no longer matches Shopify.
--   3. shop_integrations: per-shop third-party connections (Klaviyo first).
--      Credentials are stored AES-256-GCM encrypted by the app
--      (INTEGRATIONS_ENCRYPTION_KEY); this table never holds a plain key.
--   4. quiz_leads.recommended_products: the matches a lead was shown, so
--      the merchant's CSV and the Klaviyo "Completed Gleame Quiz" event can
--      carry them.
--
-- Run BEFORE deploying app code: the Studio Style panel writes
-- quiz_compact_layout through the full-row settings save, so a missing
-- column would fail every Style save. The offers/integrations readers
-- degrade to "off" when their tables are missing, but run it first anyway.
-- Safe to re-run.

-- ==========================================================================
-- 1. Compact layout (classic quiz only; templates own their layout)
-- ==========================================================================
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_compact_layout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_photo_note text;

COMMENT ON COLUMN chat_assistant_config.quiz_compact_layout IS
  'Classic quiz only: tighter phone layout (proof above the first question, 2-up tiles, swatch chips, one-screen steps). Templates ignore it.';
COMMENT ON COLUMN chat_assistant_config.quiz_photo_note IS
  'Optional line under the first question telling shoppers a hand/face photo comes at the end. NULL/empty = hidden.';

-- ==========================================================================
-- 2. quiz_offers
-- ==========================================================================
CREATE TABLE IF NOT EXISTS quiz_offers (
  shop_id uuid PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,

  -- ---- Upsell / cross-sell ("complete the look" under the results) ----
  cross_sell_enabled boolean NOT NULL DEFAULT false,
  -- manual  = only the products the merchant picked
  -- shopify = Shopify's complementary products for the top match
  --           (Search & Discovery app), fetched on the storefront
  -- both    = merchant picks first, Shopify fills the rest
  cross_sell_source text NOT NULL DEFAULT 'manual'
    CHECK (cross_sell_source IN ('manual', 'shopify', 'both')),
  cross_sell_title text,
  cross_sell_subtext text,
  -- [{productId, handle, title, imageUrl, when: null | {axisKey, axisValue}}]
  -- productId = Shopify numeric product id (string). Title/image are a
  -- display snapshot for the Studio; the widget reads live price and stock.
  cross_sell_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  cross_sell_max integer NOT NULL DEFAULT 3 CHECK (cross_sell_max BETWEEN 1 AND 6),

  -- ---- Bundle discount (applies to the results "add all" bundle) ----
  -- off     = bundle button adds at full price (shipped behavior)
  -- code    = the merchant's own Shopify discount code, applied on add
  -- managed = Gleame creates and keeps one Shopify discount code in sync
  --           (needs the optional write_discounts scope)
  bundle_discount_mode text NOT NULL DEFAULT 'off'
    CHECK (bundle_discount_mode IN ('off', 'code', 'managed')),
  bundle_discount_type text NOT NULL DEFAULT 'percentage'
    CHECK (bundle_discount_type IN ('percentage', 'fixed_amount')),
  -- percentage: 1-90 (whole percent). fixed_amount: shop currency, > 0.
  bundle_discount_value numeric CHECK (bundle_discount_value IS NULL OR bundle_discount_value > 0),
  -- NULL = the bundle size (quiz_bundle_size, or 2 when that is 0).
  bundle_discount_min_qty integer CHECK (bundle_discount_min_qty IS NULL OR bundle_discount_min_qty BETWEEN 2 AND 20),
  -- 'code' mode: the merchant's code. 'managed' mode: the code Gleame
  -- created. Never served in the public quiz-config payload.
  bundle_discount_code text,
  -- managed mode only: gid://shopify/DiscountCodeNode/... and last sync.
  bundle_discount_shopify_id text,
  bundle_discount_synced_at timestamptz,
  -- Line under the bundle button, e.g. "Bundle savings applied at checkout".
  bundle_discount_note text,

  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE quiz_offers IS
  'Studio Offers: results cross-sell and the bundle discount. One row per shop; absent row = everything off.';

ALTER TABLE quiz_offers ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- 3. shop_integrations
-- ==========================================================================
CREATE TABLE IF NOT EXISTS shop_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('klaviyo')),
  enabled boolean NOT NULL DEFAULT false,
  -- AES-256-GCM ciphertext (iv:tag:data, base64) of the provider secret.
  credentials_encrypted text,
  -- Last 4 characters of the key, for "Connected (…a1b2)" display only.
  key_hint text,
  -- Klaviyo: {listId, listName, sendLeads, sendResults, smsConsent}
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_integrations_shop_provider_key UNIQUE (shop_id, provider)
);

COMMENT ON TABLE shop_integrations IS
  'Per-shop third-party connections (Klaviyo). Secrets are app-encrypted; credentials_encrypted must never reach a browser.';

ALTER TABLE shop_integrations ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- 4. quiz_leads: what the lead was recommended
-- ==========================================================================
ALTER TABLE quiz_leads
  ADD COLUMN IF NOT EXISTS recommended_products jsonb;

COMMENT ON COLUMN quiz_leads.recommended_products IS
  '[{productId, title, url, imageUrl, price}] the shopper was shown on results after leaving this lead. NULL = not reported (lead left before results, or results never loaded).';
