-- Migration 046: quiz design richness for the Glamnetic-style redesign.
--
-- 1. Per-option display metadata — sublabels ("Everyday sweet spot"), tag
--    chips ("NO GLUE"), wear-time meters ("UP TO 5 DAYS" + fill %), and
--    swatch colors for chip/vibe rendering. One flexible jsonb instead of a
--    column per idea; the widget picks a card variant from what's present.
-- 2. Results-page copy: subtitle, personalized headline token support,
--    last-question CTA, and the post-results photo upsell banner.
--
-- ⚠ Run BEFORE deploying app code that selects these columns.

-- ==========================================================================
-- recommendation_question_options.display_meta
-- ==========================================================================
-- Shape (all keys optional):
-- {
--   "sublabel":   "Everyday sweet spot",      -- second line on the card
--   "tag":        "NO GLUE",                  -- small chip on rich cards
--   "meterLabel": "UP TO 2 WEEKS",            -- wear/effort meter caption
--   "meterPct":   100,                        -- meter fill 0-100
--   "swatch":     "#e8b4c8",                  -- dot on chips / vibe block
--   "swatch2":    "#2b2b33"                   -- second tone (vibe gradient)
-- }
ALTER TABLE recommendation_question_options
  ADD COLUMN IF NOT EXISTS display_meta jsonb;

COMMENT ON COLUMN recommendation_question_options.display_meta IS
  'Optional presentation metadata for the quiz option card: {sublabel, tag, meterLabel, meterPct, swatch, swatch2}. Absent keys fall back to plain rendering.';

-- ==========================================================================
-- chat_assistant_config: results + gate copy for the redesign
-- ==========================================================================
-- quiz_results_headline_nophoto/photo may include {first_name} — replaced
-- client-side from the logged-in customer (Liquid), removed cleanly for
-- anonymous shoppers.
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_results_subtext text,
  ADD COLUMN IF NOT EXISTS quiz_show_matches_label text,
  ADD COLUMN IF NOT EXISTS quiz_upsell_title text,
  ADD COLUMN IF NOT EXISTS quiz_upsell_body text,
  ADD COLUMN IF NOT EXISTS quiz_upsell_cta text;

COMMENT ON COLUMN chat_assistant_config.quiz_results_subtext IS
  'Sub-line under the results headline ("3 sets made for your answers — every one includes 15 sizes"). Supports {count}.';
COMMENT ON COLUMN chat_assistant_config.quiz_show_matches_label IS
  'Continue label on the LAST question screen ("Show my matches").';
COMMENT ON COLUMN chat_assistant_config.quiz_upsell_title IS
  'Post-results photo upsell banner title ("See these three on your hands").';

-- ==========================================================================
-- save_recommendation_config RPC — carry display_meta through
-- ==========================================================================
CREATE OR REPLACE FUNCTION save_recommendation_config(p_shop_id uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ax jsonb;
  val jsonb;
  q jsonb;
  opt jsonb;
  rl jsonb;
  v_axis_id uuid;
  v_question_id uuid;
  v_axis_value_id uuid;
BEGIN
  DELETE FROM recommendation_axes WHERE shop_id = p_shop_id;
  DELETE FROM recommendation_rules WHERE shop_id = p_shop_id;

  FOR ax IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'axes', '[]'::jsonb)) LOOP
    INSERT INTO recommendation_axes (shop_id, key, label, source, position)
    VALUES (
      p_shop_id,
      ax->>'key',
      ax->>'label',
      ax->>'source',
      coalesce((ax->>'position')::int, 0)
    )
    RETURNING id INTO v_axis_id;

    FOR val IN SELECT * FROM jsonb_array_elements(coalesce(ax->'values', '[]'::jsonb)) LOOP
      INSERT INTO recommendation_axis_values (axis_id, value, label, position, swatch_color)
      VALUES (
        v_axis_id,
        val->>'value',
        val->>'label',
        coalesce((val->>'position')::int, 0),
        nullif(val->>'swatchColor', '')
      );
    END LOOP;
  END LOOP;

  FOR q IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'questions', '[]'::jsonb)) LOOP
    SELECT id INTO v_axis_id
    FROM recommendation_axes
    WHERE shop_id = p_shop_id AND key = q->>'axisKey';
    IF v_axis_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO recommendation_questions
      (axis_id, prompt, position, helper_text, multi_select, screen_group)
    VALUES (
      v_axis_id,
      q->>'prompt',
      coalesce((q->>'position')::int, 0),
      nullif(q->>'helperText', ''),
      coalesce((q->>'multiSelect')::boolean, false),
      nullif(q->>'screenGroup', '')
    )
    RETURNING id INTO v_question_id;

    FOR opt IN SELECT * FROM jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) LOOP
      SELECT av.id INTO v_axis_value_id
      FROM recommendation_axis_values av
      WHERE av.axis_id = v_axis_id AND av.value = opt->>'axisValueValue';
      IF v_axis_value_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO recommendation_question_options
        (question_id, label, axis_value_id, bot_response, position, reason_text,
         image_url, show_if, select_all, display_meta)
      VALUES (
        v_question_id,
        opt->>'label',
        v_axis_value_id,
        nullif(opt->>'botResponse', ''),
        coalesce((opt->>'position')::int, 0),
        nullif(opt->>'reasonText', ''),
        nullif(opt->>'imageUrl', ''),
        CASE WHEN jsonb_typeof(opt->'showIf') = 'object' THEN opt->'showIf' ELSE NULL END,
        coalesce((opt->>'selectAll')::boolean, false),
        CASE WHEN jsonb_typeof(opt->'displayMeta') = 'object' THEN opt->'displayMeta' ELSE NULL END
      );
    END LOOP;
  END LOOP;

  FOR rl IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'rules', '[]'::jsonb)) LOOP
    IF nullif(rl->>'variantId', '') IS NULL AND nullif(rl->>'productId', '') IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO recommendation_rules (shop_id, criteria, variant_id, product_id, rank, quantity)
    VALUES (
      p_shop_id,
      rl->'criteria',
      nullif(rl->>'variantId', '')::uuid,
      nullif(rl->>'productId', '')::uuid,
      (rl->>'rank')::int,
      greatest(coalesce((rl->>'quantity')::int, 1), 1)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION save_recommendation_config(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_recommendation_config(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION save_recommendation_config(uuid, jsonb) IS
  'Atomic wipe-and-rewrite of a shop''s recommendation matrix including quiz question features (multi_select, screen_group, image_url, show_if, select_all, display_meta). A constraint failure rolls the whole save back.';
