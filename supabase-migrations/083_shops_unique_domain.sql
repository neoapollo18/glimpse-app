-- Migration 083: one shops row per shop_domain.
--
-- shops.shop_domain never had a unique constraint. ensureShopExists read the
-- row with .single(), which ERRORS on 2+ rows; that read as "no shop", so it
-- inserted another row on every admin load. Once a store had two rows (an
-- install race), it snowballed: mitucorazon.myshopify.com reached 5 rows and
-- every .single() lookup by domain failed, so its Quiz Studio 404'd.
--
-- This migration:
--   1. Removes duplicate rows that NOTHING references (no products, quiz,
--      config versions, analytics, leads, brand data...). For each domain
--      the row kept is the one with the most references, then the lowest
--      id. A duplicate that DOES hold data is never deleted; the unique
--      index in step 2 then fails loudly so it can be merged by hand.
--   2. Adds UNIQUE (shop_domain), so ensureShopExists' existing 23505
--      handling finally has a constraint to hit.
--
-- On 2026-10-05 the only duplicated domain was mitucorazon (5 rows, all
-- empty). Safe to re-run.

DO $$
DECLARE
  ref_tables text[] := ARRAY[
    'products', 'analytics_events', 'conversions', 'reference_images',
    'brand_library', 'brand_profiles', 'quiz_answer_rules', 'quiz_config_versions',
    'quiz_copilot_sessions', 'quiz_leads', 'quiz_question_guidance',
    'recommendation_axes', 'recommendation_rules', 'skin_analysis_config',
    'skin_analysis_uploads', 'widget_orders'
  ];
  t text;
  dup record;
  refs int;
  total int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _shop_refs (id uuid PRIMARY KEY, refs int NOT NULL) ON COMMIT DROP;
  TRUNCATE _shop_refs;

  FOR dup IN
    SELECT s.id FROM shops s
    WHERE s.shop_domain IN (SELECT shop_domain FROM shops GROUP BY shop_domain HAVING count(*) > 1)
  LOOP
    total := 0;
    FOREACH t IN ARRAY ref_tables LOOP
      IF to_regclass(t) IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'shop_id') THEN
        EXECUTE format('SELECT count(*) FROM %I WHERE shop_id = $1', t) INTO refs USING dup.id;
        total := total + refs;
      END IF;
    END LOOP;
    INSERT INTO _shop_refs (id, refs) VALUES (dup.id, total);
  END LOOP;

  -- Delete only unreferenced rows that are not the keeper for their domain.
  DELETE FROM shops s
  USING _shop_refs r
  WHERE s.id = r.id
    AND r.refs = 0
    AND s.id <> (
      SELECT s2.id FROM shops s2 JOIN _shop_refs r2 ON r2.id = s2.id
      WHERE s2.shop_domain = s.shop_domain
      ORDER BY r2.refs DESC, s2.id ASC
      LIMIT 1
    );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shops_shop_domain_key ON shops (shop_domain);
