-- Migration 031: add hero popup config to chat_assistant_config
--
-- Adds a configurable "hero" popup that appears on storefront pages as a
-- larger, value-preview entry point (desktop top-corner card, mobile bottom
-- sheet ~75dvh). When dismissed, the existing pill bubble takes over.
--
-- Sample-preview swatches are sourced automatically at runtime from the
-- shop's configured product_variants (display_color + variant_title), so no
-- new storage columns are needed for those.
--
-- All columns are additive with safe defaults so existing shops are
-- unaffected; hero_enabled defaults to false.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS hero_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hero_eyebrow text NOT NULL DEFAULT 'Personal consultation',
  ADD COLUMN IF NOT EXISTS hero_headline text NOT NULL DEFAULT 'Three shades, made for you.',
  ADD COLUMN IF NOT EXISTS hero_body text NOT NULL DEFAULT 'Take a photo and I''ll match shades to your skin tone — and show you exactly how each looks.',
  ADD COLUMN IF NOT EXISTS hero_cta_label text NOT NULL DEFAULT 'Start your consultation',
  ADD COLUMN IF NOT EXISTS hero_footer text NOT NULL DEFAULT '— {assistant_name}, your AI shade advisor —',
  ADD COLUMN IF NOT EXISTS hero_sample_label text NOT NULL DEFAULT 'Sample result preview',
  ADD COLUMN IF NOT EXISTS hero_position_desktop text NOT NULL DEFAULT 'top_right',
  ADD COLUMN IF NOT EXISTS hero_trust_items jsonb NOT NULL DEFAULT '["60 sec","Processed instantly","Never stored"]'::jsonb,
  ADD COLUMN IF NOT EXISTS hero_show_delay_seconds integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS hero_sample_count integer NOT NULL DEFAULT 3;

-- Constrain hero_position_desktop to known values; existing rows get the
-- default value above so this never rejects backfilled data.
ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_hero_position_desktop_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_hero_position_desktop_check
  CHECK (hero_position_desktop IN ('top_right', 'top_left', 'bottom_right', 'bottom_left'));

-- Keep sample count in a sensible range (matches the 2-up to 4-up grid the
-- hero CSS supports).
ALTER TABLE chat_assistant_config
  DROP CONSTRAINT IF EXISTS chat_assistant_config_hero_sample_count_check;
ALTER TABLE chat_assistant_config
  ADD CONSTRAINT chat_assistant_config_hero_sample_count_check
  CHECK (hero_sample_count BETWEEN 2 AND 4);

COMMENT ON COLUMN chat_assistant_config.hero_enabled IS 'Master switch for the value-preview hero popup entry point. When false, only the pill bubble appears.';
COMMENT ON COLUMN chat_assistant_config.hero_footer IS 'Token {assistant_name} is replaced at render time with the configured assistant name.';
COMMENT ON COLUMN chat_assistant_config.hero_trust_items IS 'Array of short strings shown as a dot-separated trust row (e.g. "60 sec","Processed instantly").';
COMMENT ON COLUMN chat_assistant_config.hero_sample_count IS 'How many auto-sourced variant swatches to show. Pulled at runtime from configured product_variants with a display_color set.';
