-- Migration 044: recreate save_recommendation_config for the quiz fields
--
-- Migration 043 added helper_text (questions), reason_text (options),
-- swatch_color (axis values), and quantity (rules). The transactional
-- wipe-and-rewrite RPC from migration 039 must carry them through, or every
-- editor save would silently erase the new fields.
--
-- Payload shape (all new keys optional — an older editor payload still saves):
-- {
--   "axes":      [{ key, label, source, position,
--                   values: [{ value, label, position, swatchColor? }] }],
--   "questions": [{ axisKey, prompt, position, helperText?,
--                   options: [{ label, axisValueValue, botResponse, position, reasonText? }] }],
--   "rules":     [{ criteria: {...}, variantId | productId, rank, quantity? }]
-- }

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
  -- Wipe. Axis delete cascades to values, questions, and options; rules are
  -- FK'd to variants/products (not axes), so they're deleted explicitly.
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
      CONTINUE; -- question references an axis not in the payload; skip
    END IF;

    INSERT INTO recommendation_questions (axis_id, prompt, position, helper_text)
    VALUES (
      v_axis_id,
      q->>'prompt',
      coalesce((q->>'position')::int, 0),
      nullif(q->>'helperText', '')
    )
    RETURNING id INTO v_question_id;

    FOR opt IN SELECT * FROM jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) LOOP
      SELECT av.id INTO v_axis_value_id
      FROM recommendation_axis_values av
      WHERE av.axis_id = v_axis_id AND av.value = opt->>'axisValueValue';
      IF v_axis_value_id IS NULL THEN
        CONTINUE; -- option maps to a value not in the payload; skip
      END IF;

      INSERT INTO recommendation_question_options
        (question_id, label, axis_value_id, bot_response, position, reason_text)
      VALUES (
        v_question_id,
        opt->>'label',
        v_axis_value_id,
        nullif(opt->>'botResponse', ''),
        coalesce((opt->>'position')::int, 0),
        nullif(opt->>'reasonText', '')
      );
    END LOOP;
  END LOOP;

  FOR rl IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'rules', '[]'::jsonb)) LOOP
    -- The XOR check requires exactly one target; skip stray empty cells
    -- instead of failing the whole save.
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

-- Re-assert grants after CREATE OR REPLACE (REVOKE/GRANT state survives
-- replacement, but keeping this explicit protects against the function ever
-- being dropped and recreated instead).
REVOKE ALL ON FUNCTION save_recommendation_config(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_recommendation_config(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION save_recommendation_config(uuid, jsonb) IS
  'Atomic wipe-and-rewrite of a shop''s recommendation matrix (axes, values, questions, options, rules) including quiz fields (helper_text, reason_text, swatch_color, quantity). A constraint failure rolls the whole save back, preserving the previous config.';
