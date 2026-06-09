-- Migration 036: configurable bundle card + recommendation title font
--
-- The chat product cards gained a "Love all N?" bundle card and a serif
-- product/bundle title. Both were hardcoded in the widget; this migration
-- makes them merchant-editable like the rest of the assistant copy.
--
--   bundle_enabled  → show/hide the bundle card
--   bundle_title    → headline, supports {count}
--   bundle_subtext  → small line under the headline
--   bundle_button   → CTA label, supports {count} and {total}
--   title_font      → 'serif' (default, matches the hero) or 'sans'
--
-- All nullable-safe via defaults; existing rows pick up the defaults.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS bundle_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bundle_title text NOT NULL DEFAULT 'Love all {count}?',
  ADD COLUMN IF NOT EXISTS bundle_subtext text NOT NULL DEFAULT 'Add your full match set in one tap.',
  ADD COLUMN IF NOT EXISTS bundle_button text NOT NULL DEFAULT 'Add all {count} to bag · {total}',
  ADD COLUMN IF NOT EXISTS title_font text NOT NULL DEFAULT 'serif';

-- Restrict title_font to the two stacks the widget knows how to render.
ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_title_font_chk;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_title_font_chk CHECK (title_font IN ('serif', 'sans'));

COMMENT ON COLUMN chat_assistant_config.bundle_enabled IS 'Show the "Love all N?" bundle card after the recommendation cards.';
COMMENT ON COLUMN chat_assistant_config.bundle_title IS 'Bundle card headline. {count} is replaced with the number of bundled items.';
COMMENT ON COLUMN chat_assistant_config.bundle_button IS 'Bundle CTA label. {count} = item count, {total} = formatted sum of prices.';
COMMENT ON COLUMN chat_assistant_config.title_font IS 'Font family for product + bundle titles: serif (Georgia, matches hero) or sans.';
