-- Rollback for 087: restores ORLY's pre-rebuild values (read from the
-- live storefront config on 2026-10-09).

DO $$
DECLARE
  v_shop uuid;
BEGIN
  SELECT id INTO v_shop FROM shops WHERE shop_domain = 'orlybeauty.myshopify.com';
  IF v_shop IS NULL THEN RAISE EXCEPTION 'orlybeauty.myshopify.com shop row not found'; END IF;

  UPDATE chat_assistant_config
     SET quiz_compact_layout = false,
         quiz_photo_note = NULL,
         quiz_trust_items = '[]'::jsonb,
         quiz_subtext = 'Four little questions between you and your next favorite shade - then try it on your hands before you buy.',
         quiz_visual_caption = 'Mia met her match — Kaleidoscope Eyes, and tried it on her own hand before she bought.',
         updated_at = now()
   WHERE shop_domain = 'orlybeauty.myshopify.com';

  UPDATE recommendation_questions q
     SET option_style = NULL, helper_text = 'Pick up to 3.', updated_at = now()
    FROM recommendation_axes ax
   WHERE q.axis_id = ax.id AND ax.shop_id = v_shop AND ax.key = 'colors';

  UPDATE recommendation_question_options o
     SET display_meta = (COALESCE(o.display_meta, '{}'::jsonb) - 'swatch2')
           || jsonb_build_object('swatch', m.swatch)
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
    JOIN recommendation_axis_values v ON v.axis_id = ax.id,
         (VALUES
           ('reds', '#c0392b'), ('oranges', '#e67e22'), ('yellows', '#f1c40f'),
           ('greens', '#27ae60'), ('blues', '#2980b9'), ('purples', '#8e44ad'),
           ('pinks', '#f48fb1'), ('nudes', '#d7b49e'), ('browns', '#8d6e63'),
           ('whites', '#f5f5f5'), ('greys', '#9e9e9e'), ('blacks', '#212121')
         ) AS m(value, swatch)
   WHERE o.question_id = q.id AND ax.shop_id = v_shop AND ax.key = 'colors'
     AND o.axis_value_id = v.id AND v.value = m.value
     AND NOT COALESCE(o.select_all, false);

  UPDATE recommendation_question_options o
     SET label = 'Surprise Me'
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
   WHERE o.question_id = q.id AND ax.shop_id = v_shop AND ax.key = 'colors'
     AND COALESCE(o.select_all, false);

  UPDATE recommendation_questions q
     SET helper_text = 'Pick up to 2.', updated_at = now()
    FROM recommendation_axes ax
   WHERE q.axis_id = ax.id AND ax.shop_id = v_shop AND ax.key = 'finishes';

  UPDATE recommendation_question_options o
     SET display_meta = NULLIF(COALESCE(o.display_meta, '{}'::jsonb) - 'texture' - 'sublabel', '{}'::jsonb)
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
   WHERE o.question_id = q.id AND ax.shop_id = v_shop AND ax.key = 'finishes'
     AND NOT COALESCE(o.select_all, false);

  UPDATE recommendation_question_options o
     SET label = 'No Preference'
    FROM recommendation_questions q
    JOIN recommendation_axes ax ON ax.id = q.axis_id
   WHERE o.question_id = q.id AND ax.shop_id = v_shop AND ax.key = 'finishes'
     AND COALESCE(o.select_all, false);
END $$;
