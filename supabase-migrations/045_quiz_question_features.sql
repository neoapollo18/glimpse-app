-- Migration 045: richer quiz questions — multi-select, grouped screens,
-- conditional + visual options, and "open to anything" select-alls.
--
-- Driven by nail-brand style flows, e.g.:
--   Q2 "How long do you like your nails?" (multi-select, on-hand imagery)
--   Q3 option "Press & go" rendered only when Super short was selected
--   Q5 one screen with two multi-select parts (style + colors)
--
-- Matching semantics (code-side): rules stay ONE value per axis. A rule
-- matches when each of its values is AMONG the shopper's selections for
-- that axis — so multi-select never explodes the rules table; a shopper
-- picking two lengths simply reaches both lengths' rule cells and the
-- best-ranked targets win.
--
-- ⚠ Run BEFORE deploying app code that selects these columns.

-- ==========================================================================
-- recommendation_questions
-- ==========================================================================
-- multi_select: shopper can pick several options; answers become arrays.
ALTER TABLE recommendation_questions
  ADD COLUMN IF NOT EXISTS multi_select boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recommendation_questions.multi_select IS
  'Shopper may select multiple options. The quiz shows a Continue button instead of auto-advancing; criteria carries an array for this axis.';

-- screen_group: consecutive questions sharing a group key render on ONE
-- quiz screen (e.g. "style" part A + "colors" part B), answered together.
ALTER TABLE recommendation_questions
  ADD COLUMN IF NOT EXISTS screen_group text;

COMMENT ON COLUMN recommendation_questions.screen_group IS
  'Optional group key. Consecutive questions (by position) with the same key render on one quiz screen with a single Continue.';

-- ==========================================================================
-- recommendation_question_options
-- ==========================================================================
-- image_url: visual option cards (on-hand length/shape photos).
ALTER TABLE recommendation_question_options
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN recommendation_question_options.image_url IS
  'Optional image for the option card. Options with images render in a visual grid.';

-- show_if: option renders only when a prior answer satisfies the condition.
-- Shape: {"axis_key": "length", "axis_value": "super_short"} — with
-- multi-select axes the condition passes when the value is among the
-- selections.
ALTER TABLE recommendation_question_options
  ADD COLUMN IF NOT EXISTS show_if jsonb;

COMMENT ON COLUMN recommendation_question_options.show_if IS
  'Optional render condition: {"axis_key": ..., "axis_value": ...}. The option only shows when that answer was given (or is among a multi-select).';

-- select_all: "✨ Open to anything" — selecting it means the whole value
-- set for this axis (widget expands it; it clears/blocks other picks).
ALTER TABLE recommendation_question_options
  ADD COLUMN IF NOT EXISTS select_all boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recommendation_question_options.select_all IS
  '"Open to anything" option: selecting it stands for every value of the axis and deselects specific picks.';

-- ==========================================================================
-- save_recommendation_config RPC — carry the new fields through
-- ==========================================================================
-- Payload additions (all optional):
--   questions[]: multiSelect?, screenGroup?
--   options[]:   imageUrl?, showIf? (object), selectAll?

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
         image_url, show_if, select_all)
      VALUES (
        v_question_id,
        opt->>'label',
        v_axis_value_id,
        nullif(opt->>'botResponse', ''),
        coalesce((opt->>'position')::int, 0),
        nullif(opt->>'reasonText', ''),
        nullif(opt->>'imageUrl', ''),
        CASE WHEN jsonb_typeof(opt->'showIf') = 'object' THEN opt->'showIf' ELSE NULL END,
        coalesce((opt->>'selectAll')::boolean, false)
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
  'Atomic wipe-and-rewrite of a shop''s recommendation matrix including quiz question features (multi_select, screen_group, image_url, show_if, select_all). A constraint failure rolls the whole save back.';
