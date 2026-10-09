-- Migration 087: ORLY "Find Your Vibe" mobile rebuild (data only).
--
-- Design: "ORLY Find Your Vibe — Mobile Rebuild" canvas (2026-10-06).
-- Structural changes only; ORLY's branding (white ground, pale-pink CTA,
-- light-pink accent, nail pips) is untouched. Everything here is ORLY
-- data; the layout itself is app code behind quiz_compact_layout
-- (migration 086), so no other shop changes.
--
--   * compact layout on, photo-expectation line, trust line, one-line
--     subtitle, tighter proof caption
--   * Q3 colors: explicit chip style + light→deep swatch pairs (every
--     endpoint sampled from real ORLY shades), "Surprise me" wording,
--     opt-out in the subtitle
--   * Q4 finishes: texture previews + one-line descriptions, "No
--     Preference" → "Surprise me", opt-out in the subtitle
--
-- Option swatches are display-only: the recommender's color gates read
-- photo-axis swatches, never question-option display_meta
-- (llm-recommender.server.ts targetShadeLabs), so none of this changes
-- which products ORLY recommends.
--
-- Run AFTER 086 and AFTER the app + theme extension deploy (the old
-- widget would render the new swatch pairs as solid light dots, harmless
-- but off-design). Previous values: rollback/087_rollback_orly_mobile_rebuild.sql.
-- Every statement asserts its row count, so a renamed axis or option
-- aborts the whole migration instead of half-applying.

DO $$
DECLARE
  v_shop uuid;
  n integer;
BEGIN
  SELECT id INTO v_shop FROM shops WHERE shop_domain = 'orlybeauty.myshopify.com';
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'orlybeauty.myshopify.com shop row not found';
  END IF;

  -- ---- Landing copy + layout -------------------------------------------
  UPDATE chat_assistant_config
     SET quiz_compact_layout = true,
         quiz_photo_note = 'You''ll add a pic of your hand at the end — that''s how we show your matches on you.',
         quiz_trust_items = '["Vegan", "Cruelty-free", "Made in the USA"]'::jsonb,
         quiz_subtext = 'Four little questions, one pic — then try your matches on before you buy.',
         quiz_visual_caption = 'Mia''s match — Kaleidoscope Eyes, on her own hand',
         updated_at = now()
   WHERE shop_domain = 'orlybeauty.myshopify.com';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 ORLY config row, updated %', n; END IF;

  -- ---- Q3 colors ---------------------------------------------------------
  -- Explicit chip style: with swatch2 present the auto style would pick
  -- two-tone cards instead of chips.
  UPDATE recommendation_questions q
     SET option_style = 'chips',
         helper_text = 'Pick up to 3 — or let us surprise you.',
         updated_at = now()
    FROM recommendation_axes ax
   WHERE q.axis_id = ax.id AND ax.shop_id = v_shop AND ax.key = 'colors';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 ORLY colors question, updated %', n; END IF;

  -- Merge, never replace: keeps any sublabel/tag/emoji set in the Studio.
  UPDATE recommendation_question_options o
     SET display_meta = COALESCE(o.display_meta, '{}'::jsonb)
           || jsonb_build_object('swatch', m.swatch, 'swatch2', m.swatch2)
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
    JOIN recommendation_axis_values v ON v.axis_id = ax.id,
         (VALUES
           ('reds',    '#E8442E', '#7A1220'),
           ('oranges', '#FFB37A', '#E85D1F'),
           ('yellows', '#FFF3B0', '#F5C518'),
           ('greens',  '#B8D8B0', '#1F4D2E'),
           ('blues',   '#AFCBE8', '#1E3A6E'),
           ('purples', '#C9A8E0', '#4B2160'),
           ('pinks',   '#F9D5DC', '#E0407A'),
           ('nudes',   '#EFD9C4', '#B98A65'),
           ('browns',  '#A9744F', '#4A2C1D'),
           ('whites',  '#FFFFFF', '#EDE6DD'),
           ('greys',   '#C9CBC8', '#5E625F'),
           ('blacks',  '#3A3A3E', '#0A0A0C')
         ) AS m(value, swatch, swatch2)
   WHERE o.question_id = q.id
     AND ax.shop_id = v_shop AND ax.key = 'colors'
     AND o.axis_value_id = v.id AND v.value = m.value
     AND NOT COALESCE(o.select_all, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 12 THEN RAISE EXCEPTION 'expected 12 ORLY color options, updated %', n; END IF;

  UPDATE recommendation_question_options o
     SET label = 'Surprise me'
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
   WHERE o.question_id = q.id
     AND ax.shop_id = v_shop AND ax.key = 'colors'
     AND COALESCE(o.select_all, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 ORLY colors opt-out option, updated %', n; END IF;

  -- ---- Q4 finishes -------------------------------------------------------
  UPDATE recommendation_questions q
     SET helper_text = 'Pick up to 2 — or let us surprise you.',
         updated_at = now()
    FROM recommendation_axes ax
   WHERE q.axis_id = ax.id AND ax.shop_id = v_shop AND ax.key = 'finishes';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 ORLY finishes question, updated %', n; END IF;

  UPDATE recommendation_question_options o
     SET display_meta = COALESCE(o.display_meta, '{}'::jsonb)
           || jsonb_build_object('texture', m.texture, 'sublabel', m.sublabel)
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
    JOIN recommendation_axis_values v ON v.axis_id = ax.id,
         (VALUES
           ('classic_creme',   'creme',   'smooth, solid color'),
           ('soft_shimmer',    'shimmer', 'pearl, subtle glow'),
           ('full_sparkle',    'sparkle', 'glitter, holographic'),
           ('chrome_metallic', 'chrome',  'mirror, foil shine'),
           ('sheer_glossy',    'sheer',   'jelly, glazed, translucent')
         ) AS m(value, texture, sublabel)
   WHERE o.question_id = q.id
     AND ax.shop_id = v_shop AND ax.key = 'finishes'
     AND o.axis_value_id = v.id AND v.value = m.value
     AND NOT COALESCE(o.select_all, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 ORLY finish options, updated %', n; END IF;

  UPDATE recommendation_question_options o
     SET label = 'Surprise me'
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
   WHERE o.question_id = q.id
     AND ax.shop_id = v_shop AND ax.key = 'finishes'
     AND COALESCE(o.select_all, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 ORLY finishes opt-out option, updated %', n; END IF;
END $$;
