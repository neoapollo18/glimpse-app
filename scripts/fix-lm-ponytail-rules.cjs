// L&M rule repair (2026-09-17): 32 recommendation_rules point at variant
// ids that no longer exist in product_variants — all of them 3-axis
// (goal + hair_shade + current_length) ponytail rules for the 4 shades the
// 18" Clip-In Ponytail does not come in (Peanut Butter Cup, Gingerbread,
// Cinnamon Bun, Dark Chocolate; verified against the live storefront).
// The variants existed when compile-brand-flow.cjs ran (18:36 UTC) and
// were cleaned since, so the compiled rules dangle: a shopper whose shade
// hits one gets non-matrix fallback picks — "shade detected right,
// recommended something else".
//
// Fix: repoint each dangling rule to a PRODUCT-level target on the 18"
// ponytail (variant_id NULL, product_id set) — exactly what the compiler's
// own `target()` fallback emits today for a shade the product doesn't
// stock. No new merchandising decisions; Jenn's real ponytail shade map
// remains the proper long-term fix.
//
// Aborts if any dangling rule is NOT one of the expected 32 (different
// shade or shape) — that would mean new damage this script wasn't written
// for. Idempotent: re-running finds 0 dangling rules and writes nothing.
//
// USAGE: node scripts/fix-lm-ponytail-rules.cjs [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');

const SHOP_DOMAIN = 'locks-mane.myshopify.com';
const PONY_18_PRODUCT_ID = 'ce24c2d4-7052-4136-9934-02e317a7608f'; // 18" Clip-In Ponytail
const EXPECTED_SHADES = new Set(['peanutbuttercup', 'gingerbread', 'cinnamonbun', 'darkchocolate']);
const dryRun = process.argv.includes('--dry-run');

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
}

async function danglingRules(sb, shopId) {
  const rules = await sb.from('recommendation_rules')
    .select('id, criteria, variant_id')
    .eq('shop_id', shopId)
    .not('variant_id', 'is', null);
  if (rules.error) throw new Error(`rules fetch: ${rules.error.message}`);
  const vids = [...new Set(rules.data.map((r) => r.variant_id))];
  const found = new Set();
  for (let i = 0; i < vids.length; i += 100) {
    const vs = await sb.from('product_variants').select('id').in('id', vids.slice(i, i + 100));
    if (vs.error) throw new Error(`variants fetch: ${vs.error.message}`);
    vs.data.forEach((v) => found.add(v.id));
  }
  return rules.data.filter((r) => !found.has(r.variant_id));
}

async function main() {
  loadEnv();
  const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase/supabase-js'));
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (shop.error) throw new Error(`shop lookup: ${shop.error.message}`);

  const pony = await sb.from('products').select('id, product_name').eq('id', PONY_18_PRODUCT_ID).single();
  if (pony.error || !/18.*Ponytail/i.test(pony.data.product_name)) {
    throw new Error(`target product check failed: ${pony.error?.message ?? pony.data?.product_name}`);
  }

  const dangling = await danglingRules(sb, shop.data.id);
  console.log(`dangling variant rules: ${dangling.length}${dryRun ? ' (DRY RUN)' : ''}`);
  const unexpected = dangling.filter(
    (r) => !EXPECTED_SHADES.has(r.criteria.hair_shade) || Object.keys(r.criteria).length !== 3
  );
  if (unexpected.length) {
    console.error('UNEXPECTED dangling rules — aborting, investigate first:');
    unexpected.slice(0, 5).forEach((r) => console.error(' ', r.id, JSON.stringify(r.criteria)));
    process.exit(1);
  }

  for (const r of dangling) {
    console.log(`${dryRun ? 'DRY ' : ''}repoint ${r.criteria.hair_shade} ${r.criteria.goal}/${r.criteria.current_length} -> product-level ${pony.data.product_name}`);
    if (dryRun) continue;
    const upd = await sb.from('recommendation_rules')
      .update({ variant_id: null, product_id: PONY_18_PRODUCT_ID })
      .eq('id', r.id)
      .select('id');
    if (upd.error) throw new Error(`update ${r.id}: ${upd.error.message}`);
    if (!upd.data || upd.data.length === 0) throw new Error(`update ${r.id} matched 0 rows`);
  }

  if (!dryRun) {
    const remaining = await danglingRules(sb, shop.data.id);
    console.log(`remaining dangling after fix: ${remaining.length}`);
    if (remaining.length > 0) process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
