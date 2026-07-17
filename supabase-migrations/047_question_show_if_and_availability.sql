-- Migration 047: brand-logic features driven by the Locks & Mane flow —
-- question-level branching and stock-aware recommendations.
--
-- 1. recommendation_questions.show_if — skip a WHOLE question unless a prior
--    answer matches (e.g. only ask hair length when category=extensions).
--    Same shape and semantics as the option-level show_if from migration 045;
--    NULL = always asked, so every existing flow behaves exactly as before.
-- 2. chat_assistant_config.quiz_availability_filter — opt-in flag: drop
--    recommendation targets that are out of stock on Shopify before they
--    reach the shopper. Default FALSE (no behavior change for any shop).
-- 3. chat_assistant_config.quiz_shade_fallbacks — nearest-shade adjacency
--    map used ONLY when the availability filter empties a shade's matches:
--    {"<axis_key>": {"<value>": ["nearest", "next_nearest", ...], ...}}.
--    NULL = no fallback (matches simply drop).
--
-- ⚠ Run BEFORE deploying app code that selects these columns.

-- ==========================================================================
-- recommendation_questions.show_if
-- ==========================================================================
ALTER TABLE recommendation_questions
  ADD COLUMN IF NOT EXISTS show_if jsonb;

COMMENT ON COLUMN recommendation_questions.show_if IS
  'Optional render condition for the WHOLE question: {"axis_key": ..., "axis_value": ...}. The quiz only asks it when that answer was given (or is among a multi-select). NULL = always asked.';

-- ==========================================================================
-- chat_assistant_config: availability filter + shade fallback adjacencies
-- ==========================================================================
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_availability_filter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_shade_fallbacks jsonb;

COMMENT ON COLUMN chat_assistant_config.quiz_availability_filter IS
  'When true, quiz-recommend checks Shopify stock for matrix-matched targets and drops unavailable ones (fail-open: an Admin API error skips the filter rather than emptying results).';
COMMENT ON COLUMN chat_assistant_config.quiz_shade_fallbacks IS
  'Nearest-shade adjacency map per axis: {"hair_shade": {"jet_black": ["soft_black", "darkest_brown"]}}. Consulted only when the availability filter leaves zero matrix matches — the shade value is substituted and matching re-runs.';

-- ==========================================================================
-- save_recommendation_config RPC — carry question-level show_if through
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
      (axis_id, prompt, position, helper_text, multi_select, screen_group, show_if)
    VALUES (
      v_axis_id,
      q->>'prompt',
      coalesce((q->>'position')::int, 0),
      nullif(q->>'helperText', ''),
      coalesce((q->>'multiSelect')::boolean, false),
      nullif(q->>'screenGroup', ''),
      CASE WHEN jsonb_typeof(q->'showIf') = 'object' THEN q->'showIf' ELSE NULL END
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
  'Atomic wipe-and-rewrite of a shop''s recommendation matrix including quiz question features (multi_select, screen_group, question-level + option-level show_if, select_all, image_url, display_meta). A constraint failure rolls the whole save back.';
