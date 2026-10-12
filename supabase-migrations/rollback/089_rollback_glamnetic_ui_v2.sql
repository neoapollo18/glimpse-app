-- Rollback for 089: Glamnetic's pre-UI-v2 values (read from the live row
-- on 2026-10-12). The "Glue or no glue?" removal is restored separately,
-- from Studio → Live → version history ("before dropping Glue or no glue").

DO $$
DECLARE
  v_shop uuid;
BEGIN
  SELECT id INTO v_shop FROM shops WHERE shop_domain = 'glamrco.myshopify.com';
  IF v_shop IS NULL THEN RAISE EXCEPTION 'glamrco.myshopify.com shop row not found'; END IF;

  UPDATE chat_assistant_config
     SET quiz_compact_layout = false,
         quiz_ui_style = NULL,
         quiz_results_layout = NULL,
         quiz_accent_color = '#B14A5B',
         quiz_ink_color = '#2D2D2C',
         quiz_card_bg_color = '#ECC0C5',
         quiz_line_color = '#2D2D2C',
         quiz_cta_color = '#2D2D2C',
         quiz_heading_font_override = 'Inter, system-ui, sans-serif',
         quiz_body_font_override = 'Inter, system-ui, sans-serif',
         quiz_heading_weight_override = '400',
         quiz_trust_items = jsonb_build_array(
           '"So pretty! My first set of glue on nails and so far so good. I love these!" - Angelica S.',
           '"The only nails I’ll wear I love these. These are the only nails that stay on even when I work hard they last for two weeks. I’m obsessed with the color and how they look on my hands. These are truly the best nails you’ll ever wear." - Laura H.'
         ),
         num_recommendations = 5,
         quiz_bundle_label = 'Select {count} and buy at a 20% discount',
         updated_at = now()
   WHERE shop_domain = 'glamrco.myshopify.com';

  UPDATE recommendation_questions q
     SET option_style = NULL, updated_at = now()
    FROM recommendation_axes ax
   WHERE q.axis_id = ax.id AND ax.shop_id = v_shop AND ax.key = 'color_family';

  -- The color options carried no display_meta before 089 (all NULL in the
  -- live config on 2026-10-12), so removing 089's keys restores them.
  UPDATE recommendation_question_options o
     SET display_meta = NULLIF(COALESCE(o.display_meta, '{}'::jsonb) - 'swatch' - 'swatch2' - 'texture', '{}'::jsonb)
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
   WHERE o.question_id = q.id AND ax.shop_id = v_shop AND ax.key = 'color_family'
     AND NOT COALESCE(o.select_all, false);

  -- 089 created this row's add-ons (none existed before): remove exactly
  -- those, leaving anything set in the Studio since.
  UPDATE quiz_offers
     SET cross_sell_enabled = false, cross_sell_items = '[]'::jsonb, updated_at = now()
   WHERE shop_id = v_shop
     AND cross_sell_items @> '[{"handle": "brush-on-nail-glue"}, {"handle": "press-on-nail-remover"}]'::jsonb
     AND jsonb_array_length(cross_sell_items) = 2;
END $$;
