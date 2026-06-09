-- Migration 037: configurable hero accent color + merchant-supplied sample images
--
-- The hero popup's tint was driven only by the global accent_color, and its
-- "sample preview" tiles were auto-pulled from variant display_color (so they
-- silently vanished when no variant had a color set). This migration adds:
--
--   hero_accent_color   → optional override for the hero's tint + eyebrow.
--                         NULL = fall back to accent_color (existing behavior).
--   hero_sample_images  → up to 4 merchant-supplied image URLs. When present,
--                         the hero shows these instead of the color swatches,
--                         so merchants can guarantee a sample preview appears.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS hero_accent_color text,
  ADD COLUMN IF NOT EXISTS hero_sample_images jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN chat_assistant_config.hero_accent_color IS 'Optional hex override for the hero tint + eyebrow. NULL falls back to accent_color.';
COMMENT ON COLUMN chat_assistant_config.hero_sample_images IS 'Up to 4 image URLs shown as the hero sample tiles. When non-empty, used instead of the auto color swatches.';
