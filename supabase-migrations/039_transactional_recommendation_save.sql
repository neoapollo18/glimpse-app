-- Migration 039: transactional save for the recommendation matrix
--
-- saveRecommendationConfig used to wipe-and-rewrite via individual PostgREST
-- calls: delete all axes + rules, then insert row by row. Any failure mid-way
-- (e.g. a duplicate axis key tripping UNIQUE (shop_id, key), or a transient
-- error) left the shop's previous config DESTROYED and the new one half
-- written. This moves the whole rewrite into one PL/pgSQL function — a single
-- transaction, so a failed save rolls back to the previous config intact.
--
-- Payload shape mirrors the editor's wire format:
-- {
--   "axes":      [{ key, label, source, position, values: [{ value, label, position }] }],
--   "questions": [{ axisKey, prompt, position, options: [{ label, axisValueValue, botResponse, position }] }],
--   "rules":     [{ criteria: {...}, variantId | productId, rank }]
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
      INSERT INTO recommendation_axis_values (axis_id, value, label, position)
      VALUES (
        v_axis_id,
        val->>'value',
        val->>'label',
        coalesce((val->>'position')::int, 0)
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

    INSERT INTO recommendation_questions (axis_id, prompt, position)
    VALUES (v_axis_id, q->>'prompt', coalesce((q->>'position')::int, 0))
    RETURNING id INTO v_question_id;

    FOR opt IN SELECT * FROM jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) LOOP
      SELECT av.id INTO v_axis_value_id
      FROM recommendation_axis_values av
      WHERE av.axis_id = v_axis_id AND av.value = opt->>'axisValueValue';
      IF v_axis_value_id IS NULL THEN
        CONTINUE; -- option maps to a value not in the payload; skip
      END IF;

      INSERT INTO recommendation_question_options
        (question_id, label, axis_value_id, bot_response, position)
      VALUES (
        v_question_id,
        opt->>'label',
        v_axis_value_id,
        nullif(opt->>'botResponse', ''),
        coalesce((opt->>'position')::int, 0)
      );
    END LOOP;
  END LOOP;

  FOR rl IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'rules', '[]'::jsonb)) LOOP
    -- The XOR check requires exactly one target; skip stray empty cells
    -- instead of failing the whole save.
    IF nullif(rl->>'variantId', '') IS NULL AND nullif(rl->>'productId', '') IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO recommendation_rules (shop_id, criteria, variant_id, product_id, rank)
    VALUES (
      p_shop_id,
      rl->'criteria',
      nullif(rl->>'variantId', '')::uuid,
      nullif(rl->>'productId', '')::uuid,
      (rl->>'rank')::int
    );
  END LOOP;
END;
$$;

-- SECURITY DEFINER bypasses RLS and Postgres grants EXECUTE to PUBLIC by
-- default, which Supabase exposes at /rest/v1/rpc/ — without this revoke,
-- anyone holding the anon key could wipe any shop's matrix. Service-role
-- only (the Remix app uses the service key).
REVOKE ALL ON FUNCTION save_recommendation_config(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_recommendation_config(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION save_recommendation_config(uuid, jsonb) IS
  'Atomic wipe-and-rewrite of a shop''s recommendation matrix (axes, values, questions, options, rules). A constraint failure rolls the whole save back, preserving the previous config.';
