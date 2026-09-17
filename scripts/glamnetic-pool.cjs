// Glamnetic pool builder — "Find My Nail Match" v1 (Mia handoff, Sept 2026).
// Builds the 200-product recommendation pool per the handoff's §1 tier order
// from the SYNCED catalog tags (glamrco.myshopify.com), derives the §2
// attribute schema (tags only — NEVER from product names: "Cloud Dance" is
// silver-blue glitter, "Teddy" is greige; names lie), and runs the §4
// coverage matrix with the locked relaxation chain.
//
// Catalog reality vs handoff (verified against synced tags, Sept 2026):
//   - "Quick Press Mani" carries tag "Application Type_Peel & Stick Nails"
//     (+ "_Nail Collection_Quick Press Mani 2026"); all are Extra Short.
//   - Bestsellers = tag "bestsellers" (33 active singles), not a ~85-product
//     collection; Tier 1 is therefore smaller and Tier 5 fills more.
//   - Ratings/review counts are NOT in the synced data (PDP-only), so the
//     collab tier picks bestseller-tagged sets first, then newest-collection
//     membership — never invented ratings.
//   - Color tags are coarse (Color_Pink, Color_Blue…), not the fine-grained
//     site filters (Lavender, Mint…). Family mapping below works from what
//     exists; ambiguous coarse colors land in the closest family.
//   - The final quiz drops the "For my fandom" tile; collabs stay in the
//     pool (Tier 4) as strong sellers but get no near-hard vibe mapping.
//
// USAGE:
//   node scripts/glamnetic-pool.cjs            # report only
//   node scripts/glamnetic-pool.cjs --rebuild  # also writes brand-configs/glamnetic-pool.json
'use strict';
const fs = require('fs');
const path = require('path');

const SHOP_DOMAIN = 'glamrco.myshopify.com';
const POOL_TARGET = 200;
const POOL_PATH = path.join(__dirname, 'brand-configs', 'glamnetic-pool.json');

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
}

// ---- §2 attribute derivation (tags only) ----

const LENGTH_TAGS = {
  'Nail Length_Extra Short': 'extra_short',
  'Nail Length_Super Short': 'super_short',
  'Nail Length_Short': 'short',
  'Nail Length_Medium': 'medium',
  'Nail Length_Long': 'long',
};
const SHAPE_TAGS = {
  'Nail Shape_Almond': 'almond',
  'Nail Shape_Oval': 'oval',
  'Nail Shape_Round': 'round',
  'Nail Shape_Square': 'square',
  'Nail Shape_Squoval': 'squoval',
  'Nail Shape_Coffin': 'coffin',
  // Glamnetic's super-short line uses "Super Short" as its SHAPE tag — the
  // whole line is one natural rounded profile with no almond/oval/etc.
  // variants. Kept as its own value; guidance maps it to round/oval picks.
  'Nail Shape_Super Short': 'natural',
};
// §3c color families from the coarse synced Color_* tags. Metallics also
// pull from Finish/Style tags (chrome sets are often Color_Silver-less).
const FAMILY_FROM_COLOR = {
  Nude: ['nudes_neutrals'], Brown: ['nudes_neutrals'],
  Pink: ['pinks_pastels'],
  Red: ['reds_berries'], Burgundy: ['reds_berries'], Berry: ['reds_berries'], Mauve: ['reds_berries'],
  Orange: ['bold_bright'], Coral: ['bold_bright'], Green: ['bold_bright'], Blue: ['bold_bright'],
  Yellow: ['bold_bright'], Multicolor: ['bold_bright'],
  Black: ['dark_moody'], Navy: ['dark_moody'], Gray: ['dark_moody'], Grey: ['dark_moody'], Purple: ['dark_moody'],
  Silver: ['metallics_shimmer'], Gold: ['metallics_shimmer'], Chrome: ['metallics_shimmer'], Iridescent: ['metallics_shimmer'],
  White: ['french_white'],
};
const METALLIC_STYLE_TAGS = new Set([
  'Nail Style_Chrome', 'Nail Style_Metallic Chrome', 'Nail Style_Glitter', 'Nail Style_Sparkles',
  'Nail Style_Aura', 'Finish_Chrome', 'Finish_Metallic Chrome', 'Finish_Glitter', 'Finish_Metallic',
]);
// §3d style tiers from Nail Style_* tags; a product maps to its HIGHEST tier.
const TIER_OF_STYLE = {
  'Solid Color': 'clean', 'French Tip': 'clean', 'Glazed': 'clean', 'Natural': 'clean', 'Matte': 'clean',
  'Pearl': 'extra', 'Ombre': 'extra', 'Jelly': 'extra', 'Cat Eye': 'extra', 'Accent Nail': 'extra',
  'Accent Nails': 'extra', 'Polka Dots': 'extra', 'Waves': 'extra',
  'Chrome': 'statement', 'Metallic Chrome': 'statement', 'Glitter': 'statement', 'Sparkles': 'statement',
  'Tortoise': 'statement', 'Aura': 'statement', 'Velvet': 'statement', 'Magnetic Cat Eye': 'statement',
  '3D': 'art', '3D Gems': 'art', '3D Gem': 'art', 'Abstract': 'art', 'Patterns': 'art', 'Floral': 'art',
  'Glow in the Dark': 'art',
};
const TIER_RANK = { clean: 0, extra: 1, statement: 2, art: 3 };

function deriveAttrs(p) {
  const tags = p.tags || [];
  const has = (t) => tags.includes(t);
  const system = has('Application Type_Peel & Stick Nails') ? 'quick_press' : 'glue_on';
  let length = null;
  for (const [tag, v] of Object.entries(LENGTH_TAGS)) if (has(tag)) length = length ?? v;
  const shapes = Object.entries(SHAPE_TAGS).filter(([tag]) => has(tag)).map(([, v]) => v);
  const families = new Set();
  for (const t of tags) {
    const m = t.match(/^Color_(.+)$/);
    if (m) for (const f of FAMILY_FROM_COLOR[m[1]] || []) families.add(f);
  }
  if (tags.some((t) => METALLIC_STYLE_TAGS.has(t))) families.add('metallics_shimmer');
  if (has('Nail Style_French Tip')) families.add('french_white');
  const styles = tags.filter((t) => t.startsWith('Nail Style_')).map((t) => t.slice('Nail Style_'.length));
  let tier = null;
  for (const s of styles) {
    const t = TIER_OF_STYLE[s];
    if (t && (tier == null || TIER_RANK[t] > TIER_RANK[tier])) tier = t;
  }
  const finishes = tags.filter((t) => t.startsWith('Finish_')).map((t) => t.slice('Finish_'.length));
  const collections = tags
    .filter((t) => t.startsWith('_Nail Collection_') || t.startsWith('_Collection_'))
    .map((t) => t.replace(/^_(Nail )?Collection_/, ''));
  return {
    id: p.id, name: p.product_name, handle: p.handle, imageUrl: p.image_url, price: p.price,
    system, length, shapes, families: [...families], tier: tier || 'clean', styles, finishes,
    collections, bestseller: has('bestsellers'),
  };
}

// ---- §1 exclusions + tier assembly ----

function isEligibleSingle(p) {
  if (p.status !== 'active') return false;
  const tags = p.tags || [];
  if (tags.includes('status-draft')) return false;
  if (!['Nails', 'New_Nails'].includes(p.product_type)) return false; // excludes bundles/accessories/lashes/toenail SKUs typed otherwise
  if (tags.includes('Product Type_Toenails')) return false;
  if (tags.some((t) => /^_Nail Collection_Sandal Season/.test(t))) return false; // toenails
  if (tags.some((t) => /^_Collection_Last Call/.test(t))) return false; // clearance — dead within weeks
  return true;
}

const inCollection = (a, re) => a.collections.some((c) => re.test(c));
const COLLAB_RES = {
  harry_potter: /^Harry Potter/,
  hello_kitty: /^Hello Kitty/i,
  fanatics: /^(Fanatics|NCAA|NFL|NHL|MLB|MLS|WNBA)/,
  glamzilla: /^Glamzilla/,
};

function buildPool(products) {
  // No length tag = the hard length filter can never match it; keep it out.
  const eligible = products.filter(isEligibleSingle).map(deriveAttrs).filter((a) => a.length);
  const pool = [];
  const inPool = new Set();
  const add = (a, tierLabel) => {
    if (pool.length >= POOL_TARGET || inPool.has(a.id)) return;
    inPool.add(a.id);
    pool.push({ ...a, poolTier: tierLabel });
  };
  const byName = (x, y) => x.name.localeCompare(y.name);

  // Tier 1: bestsellers. Tier 2: the ENTIRE Quick Press pool, no exceptions.
  eligible.filter((a) => a.bestseller).sort(byName).forEach((a) => add(a, 'T1 bestseller'));
  eligible.filter((a) => a.system === 'quick_press').sort(byName).forEach((a) => add(a, 'T2 quick_press'));
  // Tier 3: current-season collections in full.
  const SEASON = [/^The Soft Launch/, /^Spells & Sparkles/, /^Sparkling Gems/, /^Routine Refresh/];
  for (const re of SEASON) eligible.filter((a) => inCollection(a, re)).sort(byName).forEach((a) => add(a, 'T3 season'));
  // Tier 4: collabs, up to 4 each (no synced ratings — bestseller tag first, then name).
  for (const [key, re] of Object.entries(COLLAB_RES)) {
    const picks = eligible
      .filter((a) => inCollection(a, re) && !inPool.has(a.id))
      .sort((x, y) => Number(y.bestseller) - Number(x.bestseller) || byName(x, y))
      .slice(0, 4);
    picks.forEach((a) => add(a, `T4 collab:${key}`));
  }
  // Tier 5: fill hard cells (system × length × shape) thin-first, then anything.
  const rest = eligible.filter((a) => !inPool.has(a.id));
  const cellCount = (system, length, shape) =>
    pool.filter((a) => a.system === system && a.length === length && a.shapes.includes(shape)).length;
  const need = [];
  // The natural-profile super-short line is the only glue-on answer to a
  // super-short pick — pull a healthy slice of it into the pool.
  need.push({ system: 'glue_on', length: 'super_short', shape: 'natural', threshold: 10 });
  for (const length of ['super_short', 'short', 'medium', 'long'])
    for (const shape of ['almond', 'oval', 'round', 'square', 'squoval', 'coffin'])
      need.push({ system: 'glue_on', length, shape, threshold: 6 });
  for (const shape of ['oval', 'almond', 'round', 'square'])
    need.push({ system: 'quick_press', length: 'extra_short', shape, threshold: 4 });
  for (const cell of need.sort((a, b) => cellCount(a.system, a.length, a.shape) - cellCount(b.system, b.length, b.shape))) {
    if (pool.length >= POOL_TARGET) break;
    let n = cellCount(cell.system, cell.length, cell.shape);
    for (const a of rest.sort((x, y) => Number(y.bestseller) - Number(x.bestseller) || byName(x, y))) {
      if (n >= cell.threshold || pool.length >= POOL_TARGET) break;
      if (inPool.has(a.id) || a.system !== cell.system || a.length !== cell.length || !a.shapes.includes(cell.shape)) continue;
      add(a, 'T5 cell-fill');
      n++;
    }
  }
  for (const a of rest.sort((x, y) => Number(y.bestseller) - Number(x.bestseller) || byName(x, y))) {
    if (pool.length >= POOL_TARGET) break;
    add(a, 'T5 fill');
  }
  return { pool, eligibleCount: eligible.length };
}

// ---- §4 coverage matrix + locked relaxation chain ----

const SHAPE_RELAX = {
  coffin: ['square', 'squoval'], round: ['oval', 'almond'], squoval: ['square', 'oval'],
  almond: ['oval', 'round'], oval: ['almond', 'squoval'], square: ['squoval', 'coffin'],
};
const LENGTH_RELAX = {
  super_short: ['short'], short: ['super_short', 'medium'], medium: ['short', 'long'], long: ['medium'],
};

function coverageReport(pool) {
  const lines = [];
  const failures = [];
  const count = (system, length, shape) =>
    pool.filter((a) => a.system === system && a.length === length && a.shapes.includes(shape)).length;
  const resolved = (system, length, shape) => {
    // Relaxation order (locked): shape neighbors first, then length one step
    // ON TOP of the relaxed shapes (the steps stack — a super_short coffin
    // shopper relaxes to squoval, then to short squoval). Tier and color
    // relax further downstream in the LLM; ≥3 here means the hard cell
    // resolves without touching preference layers. The natural-profile
    // super-short line satisfies round/oval-adjacent picks at that length.
    const shapesOk = new Set([shape, ...(SHAPE_RELAX[shape] || [])]);
    if (length === 'super_short' && (shape === 'round' || shapesOk.has('round') || shapesOk.has('oval'))) {
      shapesOk.add('natural');
    }
    const lengthsOk = new Set([length, ...(LENGTH_RELAX[length] || [])]);
    return pool.filter(
      (a) => a.system === system && lengthsOk.has(a.length) && a.shapes.some((s) => shapesOk.has(s)),
    ).length;
  };
  lines.push('cell'.padEnd(34) + 'direct  families  tiers  after-relax');
  const cells = [];
  for (const length of ['super_short', 'short', 'medium', 'long'])
    for (const shape of Object.keys(SHAPE_RELAX)) cells.push(['glue_on', length, shape]);
  for (const shape of ['oval', 'almond', 'round', 'square']) cells.push(['quick_press', 'extra_short', shape]);
  for (const [system, length, shape] of cells) {
    const direct = pool.filter((a) => a.system === system && a.length === length && a.shapes.includes(shape));
    const fams = new Set(direct.flatMap((a) => a.families));
    const tiers = new Set(direct.map((a) => a.tier));
    const after = resolved(system, length, shape);
    lines.push(
      `${system} × ${length} × ${shape}`.padEnd(34) +
      String(direct.length).padEnd(8) + String(fams.size).padEnd(10) + String(tiers.size).padEnd(7) + String(after) +
      (after < 3 ? '   *** FAILS (<3 after relaxation)' : ''),
    );
    if (after < 3) failures.push(`${system} × ${length} × ${shape}`);
  }
  return { lines, failures };
}

async function fetchProducts(sb, shopId) {
  const all = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb
      .from('products')
      .select('id, product_name, handle, status, product_type, tags, price, image_url')
      .eq('shop_id', shopId).order('id').range(page * 1000, page * 1000 + 999);
    if (error) throw new Error('products fetch failed: ' + error.message);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  const rebuild = process.argv.includes('--rebuild');
  loadEnv();
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (!shop.data) throw new Error('shop not found: ' + SHOP_DOMAIN);

  const products = await fetchProducts(sb, shop.data.id);
  const { pool, eligibleCount } = buildPool(products);

  const tierCounts = {};
  pool.forEach((a) => { tierCounts[a.poolTier.split(' ')[0]] = (tierCounts[a.poolTier.split(' ')[0]] || 0) + 1; });
  console.log(`eligible singles: ${eligibleCount}; pool: ${pool.length} (target ${POOL_TARGET})`);
  console.log('tiers:', JSON.stringify(tierCounts));
  console.log(`missing length: ${pool.filter((a) => !a.length).length}; missing shape: ${pool.filter((a) => a.shapes.length === 0).length}; missing family: ${pool.filter((a) => a.families.length === 0).length}`);

  const { lines, failures } = coverageReport(pool);
  console.log('\n=== §4 COVERAGE (pool) ===');
  lines.forEach((l) => console.log(l));
  if (failures.length) console.log(`\n${failures.length} cells fail after relaxation:\n  ${failures.join('\n  ')}`);
  else console.log('\nAll cells resolve ≥3 after the locked relaxation chain.');

  if (rebuild) {
    fs.writeFileSync(POOL_PATH, JSON.stringify({ shopDomain: SHOP_DOMAIN, builtAt: new Date().toISOString(), pool }, null, 1));
    console.log(`\nwrote ${POOL_PATH} (${pool.length} products)`);
  }
}

module.exports = { POOL_PATH, SHOP_DOMAIN, loadEnv, fetchProducts, isEligibleSingle, deriveAttrs, buildPool, coverageReport };
if (require.main === module) main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
