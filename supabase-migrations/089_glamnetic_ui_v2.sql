-- Migration 089: Glamnetic "Find My Match — UI v2" (data only).
--
-- Design: Glamnetic Find My Match UI v2 canvas (build spec v2.3). The
-- layout itself is app code behind settings migration 088 added; this
-- turns them on for glamrco.myshopify.com only and applies the spec's
-- palette. Decisions (Charles, 2026-10-12): keep Glamnetic's live copy,
-- swap the two review quotes for the short trust line, add Nail Glue +
-- Press-On Nail Remover as add-ons (Adhesive Tabs held for Lisa).
-- The "Glue or no glue?" removal and the Length fix already shipped via
-- scripts/glamnetic-drop-application.mts (snapshotted in version history).
--
--   * Boutique style + grid results + compact phone layout
--   * Palette: accent #9A4458, ink #1A1718, white cards, hairline #E3DADD;
--     Poppins (the theme's font) set explicitly rather than detected, 600
--     headings
--   * 6 results (3 x 2 / 2 x 3 grid)
--   * Bundle bar copy for mix & match. It only shows once a bundle
--     discount is live (Studio → Sell more → Bundle & discount); the old
--     "buy at a 20% discount" label promised a saving checkout never gave
--   * Color question → nail swatches with light→deep pairs from the design
--   * "Finish the look" add-ons
--
-- Run AFTER 088, the app deploy and `shopify app deploy` (the old widget
-- would draw the color swatches as two-tone cards). Previous values:
-- rollback/089_rollback_glamnetic_ui_v2.sql. Row counts are asserted.

DO $$
DECLARE
  v_shop uuid;
  n integer;
BEGIN
  SELECT id INTO v_shop FROM shops WHERE shop_domain = 'glamrco.myshopify.com';
  IF v_shop IS NULL THEN RAISE EXCEPTION 'glamrco.myshopify.com shop row not found'; END IF;

  UPDATE chat_assistant_config
     SET quiz_compact_layout = true,
         quiz_ui_style = 'boutique',
         quiz_results_layout = 'grid',
         quiz_accent_color = '#9A4458',
         quiz_ink_color = '#1A1718',
         quiz_card_bg_color = '#FFFFFF',
         quiz_line_color = '#E3DADD',
         quiz_cta_color = '#9A4458',
         quiz_heading_font_override = 'Poppins, system-ui, sans-serif',
         quiz_body_font_override = 'Poppins, system-ui, sans-serif',
         quiz_heading_weight_override = '600',
         quiz_trust_items = '["Photo optional", "15 sizes in every box", "Vegan & cruelty-free"]'::jsonb,
         num_recommendations = 6,
         quiz_bundle_label = '**Mix & match:** add any {range} sets and save {discount}',
         updated_at = now()
   WHERE shop_domain = 'glamrco.myshopify.com';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 Glamnetic config row, updated %', n; END IF;

  -- ---- Color question: nail swatches --------------------------------------
  UPDATE recommendation_questions q
     SET option_style = 'nails', updated_at = now()
    FROM recommendation_axes ax
   WHERE q.axis_id = ax.id AND ax.shop_id = v_shop AND ax.key = 'color_family';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 Glamnetic color question, updated %', n; END IF;

  -- Merge, never replace: keeps anything set on these options in the Studio.
  UPDATE recommendation_question_options o
     SET display_meta = COALESCE(o.display_meta, '{}'::jsonb) || m.meta
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
    JOIN recommendation_axis_values v ON v.axis_id = ax.id,
         (VALUES
           ('nudes_neutrals',    '{"swatch": "#F8E6E0", "swatch2": "#D6A899"}'::jsonb),
           ('pinks_pastels',     '{"swatch": "#FCE7EC", "swatch2": "#E28FAA"}'::jsonb),
           ('reds_berries',      '{"swatch": "#E85468", "swatch2": "#601222"}'::jsonb),
           ('bold_bright',       '{"swatch": "#FF7A59", "swatch2": "#3E7DE0", "texture": "rainbow"}'::jsonb),
           ('dark_moody',        '{"swatch": "#5E3C53", "swatch2": "#121014"}'::jsonb),
           ('metallics_shimmer', '{"swatch": "#F7E8BC", "swatch2": "#B9BFCF", "texture": "sparkle"}'::jsonb),
           ('french_white',      '{"swatch": "#F2D3D9", "texture": "french"}'::jsonb)
         ) AS m(value, meta)
   WHERE o.question_id = q.id
     AND ax.shop_id = v_shop AND ax.key = 'color_family'
     AND o.axis_value_id = v.id AND v.value = m.value
     AND NOT COALESCE(o.select_all, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 7 THEN RAISE EXCEPTION 'expected 7 Glamnetic color options, updated %', n; END IF;

  -- ---- "Finish the look" add-ons --------------------------------------------
  -- Only the cross-sell columns, and only while no add-ons are set: add-ons
  -- or a bundle discount someone set up in the Studio are never replaced.
  -- (No quiz_offers row existed for Glamnetic on 2026-10-12.)
  INSERT INTO quiz_offers (shop_id, cross_sell_enabled, cross_sell_source, cross_sell_title, cross_sell_subtext, cross_sell_items, cross_sell_max)
  VALUES (
    v_shop, true, 'manual', 'Finish the look', 'Everything your sets need to last',
    '[{"productId": "6535189102635", "handle": "brush-on-nail-glue", "title": "Brush-On Nail Glue", "imageUrl": "https://cdn.shopify.com/s/files/1/0139/2302/4944/files/2023_03_brush-on-nail-glue_highres_1_jpg.png?v=1784135931", "when": null},
      {"productId": "7130235797547", "handle": "press-on-nail-remover", "title": "Press-On Nail Remover", "imageUrl": "https://cdn.shopify.com/s/files/1/0139/2302/4944/files/2026_03_PressOnNailRemover_New.webp?v=1774394347", "when": null}]'::jsonb,
    3
  )
  ON CONFLICT (shop_id) DO UPDATE
     SET cross_sell_enabled = EXCLUDED.cross_sell_enabled,
         cross_sell_source = EXCLUDED.cross_sell_source,
         cross_sell_title = EXCLUDED.cross_sell_title,
         cross_sell_subtext = EXCLUDED.cross_sell_subtext,
         cross_sell_items = EXCLUDED.cross_sell_items,
         cross_sell_max = EXCLUDED.cross_sell_max,
         updated_at = now()
   WHERE quiz_offers.cross_sell_items = '[]'::jsonb;
END $$;
