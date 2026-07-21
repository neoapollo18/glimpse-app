-- Migration 048: per-question option style override for the quiz.
--
-- Until now the widget picked how a question's answer buttons render purely
-- from the options' content (images → visual grid, swatches → chips,
-- sublabels → boxed cards, short labels → pills, else stacked rows). That
-- auto-pick stays the default — but merchants asked to force a style per
-- question ("make these full-width boxed cards like the other questions"),
-- so questions gain an explicit override.
--
-- recommendation_questions.option_style:
--   NULL      → auto (current behavior, unchanged for every existing flow)
--   'chips'   → compact pill chips (color dot when an option has a swatch)
--   'boxed'   → full-width grid of boxed label cards
--   'list'    → stacked full-width rows
--   'visual'  → image card grid
--   'rich'    → rich cards (tag chip + wear meter)
--   'vibe'    → two-tone swatch cards
--
-- ⚠ Run BEFORE deploying app code that selects this column.

ALTER TABLE recommendation_questions
  ADD COLUMN IF NOT EXISTS option_style text;

ALTER TABLE recommendation_questions
  DROP CONSTRAINT IF EXISTS recommendation_questions_option_style_check;
ALTER TABLE recommendation_questions
  ADD CONSTRAINT recommendation_questions_option_style_check
  CHECK (option_style IS NULL OR option_style IN ('chips', 'boxed', 'list', 'visual', 'rich', 'vibe'));

COMMENT ON COLUMN recommendation_questions.option_style IS
  'Optional per-question render style for the quiz answer buttons: chips | boxed | list | visual | rich | vibe. NULL = auto (widget picks from the options'' content).';

-- ==========================================================================
-- save_recommendation_config RPC — carry option_style through
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
      (axis_id, prompt, position, helper_text, multi_select, screen_group, show_if, option_style)
    VALUES (
      v_axis_id,
      q->>'prompt',
      coalesce((q->>'position')::int, 0),
      nullif(q->>'helperText', ''),
      coalesce((q->>'multiSelect')::boolean, false),
      nullif(q->>'screenGroup', ''),
      CASE WHEN jsonb_typeof(q->'showIf') = 'object' THEN q->'showIf' ELSE NULL END,
      nullif(q->>'optionStyle', '')
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
  'Atomic wipe-and-rewrite of a shop''s recommendation matrix including quiz question features (multi_select, screen_group, option_style, question-level + option-level show_if, select_all, image_url, display_meta). A constraint failure rolls the whole save back.';
