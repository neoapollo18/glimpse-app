// ORLY "Find Your Vibe" pool v2 — spec "ORLY Recommendation Backfill v2"
// (165 products, §6 table = source of truth; the companion CSV was never
// delivered). Supersedes onboard-orly-products.cjs for the v2 pool.
//
// Pool membership in Gleame (see orly-v2-lib.cjs): live products rows for
// the shop, filtered by chat_assistant_config.selected_product_ids only
// when product_scope = 'selected'. ORLY is 'all_configured' today.
//
// What it does
//   dry-run (default; DB reads + public catalog only, writes ONLY local files
//   brand-configs/orly-pool-v2-spec.json, orly-attributes-v2.json and
//   orly-guidance-v2.preview.txt):
//     - parses §6, validates vocab, recomputes depth from hex (§2.4) and
//       checks it against the depth column + the §3 74/50/41 distribution
//     - resolves every spec handle on the live store (products.json), reports
//       title / formula mismatches, stock, data-quality flags
//     - diffs against the DB: in pool (kept) / row exists but out of pool
//       (reinstate) / no row (onboard) / current pool members not in v2
//     - regenerates the v2 attributes file + a guidance preview
//   --apply:
//     - backup of config + every current product row's pool-relevant
//       columns -> scripts/backups/orly-pool-v2-<date>.json, BEFORE writes
//     - reinstates out-of-pool v2 rows (status -> NULL), guarded by id
//     - inserts the missing v2 products as new rows, each already carrying
//       the universal VTO prompt + first-image reference (orly-vto-backfill
//       helpers) because ORLY's quiz has try-on enabled and the pool is live
//     - if product_scope is already 'selected', adds the new ids to
//       selected_product_ids (otherwise they'd be invisible)
//     - rewrites orly-attributes-v2.json with the real row ids
//   --push-guidance (with --apply): ai_guidance + priority_product_ids
//     rebuilt for the RESULTING pool (v2 facts, plus legacy v1 facts for any
//     non-v2 members still in the pool)
//   --retire-dropped (with --apply --push-guidance): product_scope ->
//     'selected', selected_product_ids -> exactly the 165 v2 rows. Dropped
//     rows are NOT modified or deleted (PDP try-on keeps working); they just
//     leave the quiz pool. Never default.
//
// NEVER calls save_recommendation_config or any wipe-and-rewrite path.
//
// USAGE:
//   node scripts/orly-pool-v2.cjs [--spec <md>] [--push-guidance] [--retire-dropped]   # dry-run preview
//   node scripts/orly-pool-v2.cjs --apply [--push-guidance [--retire-dropped]]
//     [--ai-model keep|<id>] [--image first|swatch]   (VTO config for new rows)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('./orly-v2-lib.cjs');
const vto = require('./orly-vto-backfill.cjs');
const { buildGuidance } = require('./orly-guidance.cjs');

const V1_ATTRIBUTES_PATH = path.join(__dirname, 'brand-configs', 'orly-attributes.json');
const GUIDANCE_PREVIEW_PATH = path.join(__dirname, 'brand-configs', 'orly-guidance-v2.preview.txt');
const EXPECTED_DISTRIBUTION = { light: 74, mid: 50, deep: 41 }; // spec §2.4 / §3
const HERO_COUNT = 10;

const norm = (s) => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const tally = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});

// ---- Hex sanity (informational only — the spec forbids loosening the
// mapping; this just surfaces metafield data that looks wrong) ----
function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return { h: h * 60, s, l };
}
const CHIP_HEX_CHECK = {
  reds: ({ h, s }) => (h <= 15 || h >= 340) && s >= 0.35,
  oranges: ({ h, s }) => h >= 5 && h <= 45 && s >= 0.3,
  yellows: ({ h, s }) => h >= 30 && h <= 75 && s >= 0.3,
  greens: ({ h, s }) => h >= 75 && h <= 185 && s >= 0.12,
  blues: ({ h, s }) => h >= 180 && h <= 260 && s >= 0.12,
  purples: ({ h, s }) => h >= 250 && h <= 335 && s >= 0.1,
  pinks: ({ h, l }) => (h >= 300 || h <= 25) && l >= 0.3,
  nudes: ({ h, s, l }) => l >= 0.45 && s <= 0.8 && (h <= 45 || h >= 300),
  browns: ({ h, l }) => h <= 45 && l <= 0.6,
  whites: ({ s, l }) => l >= 0.8 && s <= 0.6,
  greys: ({ s, l }) => s <= 0.2 && l >= 0.1 && l <= 0.9,
  blacks: ({ l }) => l <= 0.2,
};

function validateSpec(rows) {
  const errors = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.handle)) errors.push(`duplicate handle ${r.handle}`);
    seen.add(r.handle);
    for (const c of r.chips) if (!lib.CHIPS.includes(c)) errors.push(`${r.handle}: unknown chip ${c}`);
    if (r.finishes.length === 0) errors.push(`${r.handle}: no finish`);
    for (const f of r.finishes) if (!lib.FINISH_BUCKETS.includes(f)) errors.push(`${r.handle}: unknown finish ${f}`);
    if (!['Breathable', 'Lacquer', 'GELFX'].includes(r.formula)) errors.push(`${r.handle}: unknown formula ${r.formula}`);
    if (!['color', 'topper'].includes(r.class)) errors.push(`${r.handle}: unknown class ${r.class}`);
    if (!/^#[0-9A-F]{6}$/.test(r.hex)) errors.push(`${r.handle}: bad hex ${r.hex}`);
    if (!['light', 'mid', 'deep'].includes(r.depth)) errors.push(`${r.handle}: bad depth ${r.depth}`);
  }
  return errors;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pushGuidance = process.argv.includes('--push-guidance');
  const retireDropped = process.argv.includes('--retire-dropped');
  const modelFlag = lib.argValue('--ai-model', 'keep');
  const imageMode = lib.argValue('--image', 'first');
  const specPath = lib.argValue('--spec', lib.DEFAULT_SPEC_MD);
  if (retireDropped && !pushGuidance) {
    throw new Error('--retire-dropped requires --push-guidance (the current priority heroes and guidance describe products that would leave the pool)');
  }
  console.log(`ORLY pool v2 — ${apply ? 'APPLY' : 'DRY RUN'}${pushGuidance ? ' +push-guidance' : ''}${retireDropped ? ' +retire-dropped' : ''}`);

  // ---- 1. Spec ----
  const { rows: spec, source } = lib.loadSpecRows({ specPath });
  console.log(`\nspec: ${spec.length} rows from ${source} (snapshot ${path.relative(lib.ROOT, lib.SPEC_SNAPSHOT_PATH)})`);
  const specErrors = validateSpec(spec);
  if (specErrors.length) console.log(`SPEC ERRORS (${specErrors.length}):\n  ${specErrors.join('\n  ')}`);
  console.log(`  formula ${JSON.stringify(tally(spec.map((r) => r.formula)))}; class ${JSON.stringify(tally(spec.map((r) => r.class)))}`);

  // ---- 2. Depth (§2.4) ----
  const depthMismatch = spec.filter((r) => lib.depthFromHex(r.hex) !== r.depth);
  const dist = tally(spec.map((r) => lib.depthFromHex(r.hex)));
  const distOk = Object.entries(EXPECTED_DISTRIBUTION).every(([k, v]) => dist[k] === v);
  console.log(`\ndepth from hex: ${JSON.stringify(dist)} vs §3 ${JSON.stringify(EXPECTED_DISTRIBUTION)} -> ${distOk ? 'MATCH' : 'MISMATCH'}; vs §6 depth column: ${depthMismatch.length} mismatches`);
  for (const r of depthMismatch) console.log(`  ${r.handle} ${r.hex} L=${lib.luminance(r.hex).toFixed(3)} computed=${lib.depthFromHex(r.hex)} spec=${r.depth}`);

  // ---- 3. Live catalog ----
  const catalog = await lib.fetchCatalog();
  const bestsellers = await lib.fetchBestsellers();
  const byHandle = new Map(catalog.map((c) => [c.handle, c]));
  console.log(`\ncatalog: ${catalog.length} products; bestsellers collection: ${bestsellers.length}`);
  const unresolved = [];
  const titleMismatch = [];
  const formulaMismatch = [];
  for (const r of spec) {
    const c = byHandle.get(r.handle) || catalog.find((x) => decodeURIComponent(x.handle) === r.handle);
    if (!c) { unresolved.push(r.handle); continue; }
    r.catalog = c;
    if (norm(c.title) !== norm(r.name)) titleMismatch.push(`${r.handle}: spec "${r.name}" vs live "${c.title}"`);
    const f = lib.FORMULA_BY_PRODUCT_TYPE[c.product_type];
    if (f !== r.formula) formulaMismatch.push(`${r.handle}: spec ${r.formula} vs product_type "${c.product_type}"`);
  }
  console.log(`  handles resolved: ${spec.length - unresolved.length}/${spec.length}${unresolved.length ? ` — UNRESOLVED: ${unresolved.join(', ')}` : ''}`);
  console.log(`  title mismatches (spec name vs live title): ${titleMismatch.length}${titleMismatch.length ? '\n    ' + titleMismatch.join('\n    ') : ''}`);
  const compact = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const oddHandles = spec.filter((r) => r.catalog && !compact(r.handle).includes(compact(norm(r.catalog.title).split(/\s+-\s+/)[0])));
  console.log(`  handles that don't read like their title (trusted; live title confirmed): ${oddHandles.map((r) => `${r.handle} = "${r.catalog.title}"`).join('; ')}`);
  console.log(`  formula vs product_type mismatches: ${formulaMismatch.length}${formulaMismatch.length ? '\n    ' + formulaMismatch.join('\n    ') : ''}`);
  const oos = spec.filter((r) => r.catalog && !r.catalog.variants.some((v) => v.available));
  console.log(`  out of stock now (all variants unavailable): ${oos.length} — ${oos.map((r) => r.handle).join(', ')}`);

  // ---- 4. Data-quality flags (report only) ----
  const flags = [];
  for (const r of spec.filter((x) => x.chips.length === 0)) flags.push(`${r.handle}: no chips (multi/neon/pastel only per §2.5) — only reachable via Surprise Me colors`);
  for (const r of spec.filter((x) => x.catalog && (x.catalog.tags || []).some((t) => /duos/i.test(t)))) flags.push(`${r.handle}: two-bottle DUO kit (${(r.catalog.tags || []).filter((t) => /duos/i.test(t)).join(',')}) — two shades in one product; single-color VTO prompt doesn't fit`);
  const byHex = {};
  for (const r of spec) (byHex[r.hex] = byHex[r.hex] || []).push(r);
  for (const [hex, rs] of Object.entries(byHex)) {
    const shades = new Set(rs.map((r) => norm(r.name).split(' - ')[0]));
    if (shades.size > 1) flags.push(`hex ${hex} shared by different shades: ${rs.map((r) => r.handle).join(', ')} (likely placeholder metafield)`);
  }
  for (const r of spec.filter((x) => x.chips.length)) {
    const c = hsl(r.hex);
    if (!r.chips.some((ch) => CHIP_HEX_CHECK[ch](c))) flags.push(`${r.handle}: hex ${r.hex} doesn't look like any of its chips (${r.chips.join('/')}) — depth ${r.depth} derives from this hex`);
  }
  console.log(`\ndata-quality flags (${flags.length}, informational — spec says never loosen the mapping):\n  ${flags.join('\n  ')}`);

  // ---- 5. DB diff ----
  const sb = lib.supabaseClient();
  const state = await lib.loadShopState(sb);
  const { config } = state;
  const rowsByNum = new Map();
  for (const p of state.products) {
    const k = lib.numericId(p.shopify_id);
    rowsByNum.set(k, (rowsByNum.get(k) || []).concat(p));
  }
  const dupRows = [...rowsByNum.entries()].filter(([, v]) => v.length > 1);
  const catalogIds = new Set(catalog.map((c) => String(c.id)));
  const currentPool = state.products.filter((p) => lib.inPool(p, config));
  console.log(`\nDB: ${state.products.length} ORLY product rows; product_scope=${config.product_scope}; selected_product_ids=${(config.selected_product_ids || []).length}; current pool=${currentPool.length}; status ${JSON.stringify(tally(state.products.map((p) => p.status ?? 'NULL')))}; catalog_sync_enabled=${state.shop.catalog_sync_enabled}`);
  if (dupRows.length) console.log(`  DUPLICATE rows per shopify id: ${dupRows.map(([k, v]) => `${k} x${v.length}`).join(', ')}`);

  const kept = [], reinstate = [], onboard = [];
  for (const r of spec.filter((x) => x.catalog)) {
    const rs = rowsByNum.get(String(r.catalog.id)) || [];
    if (rs.length === 0) { onboard.push(r); continue; }
    r.row = rs[0];
    if (lib.inPool(r.row, config)) kept.push(r); else reinstate.push(r);
  }
  const v2Ids = new Set(spec.filter((x) => x.catalog).map((r) => String(r.catalog.id)));
  const dropped = currentPool.filter((p) => !v2Ids.has(lib.numericId(p.shopify_id)));
  const heroSet = new Set(config.priority_product_ids || []);
  console.log(`  v2 in pool already (kept): ${kept.length} — ${kept.map((r) => r.row.product_name).join(', ')}`);
  console.log(`  v2 rows out of pool (reinstate): ${reinstate.length}${reinstate.length ? ' — ' + reinstate.map((r) => `${r.row.product_name} [status ${r.row.status}]`).join(', ') : ''}`);
  console.log(`  v2 needing onboarding (new rows): ${onboard.length} — by formula ${JSON.stringify(tally(onboard.map((r) => r.formula)))}`);
  console.log(`  current pool NOT in v2 (leave the pool only with --retire-dropped): ${dropped.length}; of which gone from the live catalog: ${dropped.filter((p) => !catalogIds.has(lib.numericId(p.shopify_id))).length}; current priority heroes among them: ${dropped.filter((p) => heroSet.has(p.id)).length}/${heroSet.size}`);
  for (const p of dropped) console.log(`    - ${p.product_name}${catalogIds.has(lib.numericId(p.shopify_id)) ? '' : ' [not in live catalog]'}${heroSet.has(p.id) ? ' [HERO]' : ''}`);

  // ---- 6. Attributes v2 ----
  const allPoolIds = (extra) => new Set([...v2Ids, ...extra]);
  const rankAmong = (idSet) => {
    const m = new Map();
    for (const b of bestsellers) if (idSet.has(String(b.id)) && !m.has(String(b.id))) m.set(String(b.id), m.size + 1);
    return m;
  };
  const resultingExtraIds = retireDropped ? [] : dropped.map((p) => lib.numericId(p.shopify_id));
  const rank = rankAmong(allPoolIds(resultingExtraIds));
  const v2Entries = spec.filter((x) => x.catalog).map((r) => ({
    schema: 'v2',
    gleameId: r.row?.id ?? null,
    handle: r.handle,
    shopifyId: String(r.catalog.id),
    name: r.catalog.title,
    specName: r.name,
    chips: r.chips,
    finishes: r.finishes,
    depth: lib.depthFromHex(r.hex),
    luminance: Number(lib.luminance(r.hex).toFixed(4)),
    hex: r.hex,
    formula: r.formula,
    class: r.class,
    topper: r.class === 'topper',
    available: r.catalog.variants.some((v) => v.available),
    duoKit: (r.catalog.tags || []).some((t) => /duos/i.test(t)),
    bestsellerRank: rank.get(String(r.catalog.id)) ?? null,
    retired: false,
  }));
  const writeAttributes = (entries) => fs.writeFileSync(lib.ATTRIBUTES_V2_PATH, JSON.stringify({
    shopDomain: lib.SHOP_DOMAIN,
    spec: 'ORLY Recommendation Backfill v2, §6 (derivation §2)',
    generatedAt: new Date().toISOString(),
    pendingOnboard: entries.filter((e) => !e.gleameId).length,
    products: entries,
  }, null, 1));
  writeAttributes(v2Entries);
  console.log(`\nwrote ${path.relative(lib.ROOT, lib.ATTRIBUTES_V2_PATH)} (${v2Entries.length} products, ${v2Entries.filter((e) => !e.gleameId).length} pending row ids)`);

  // Legacy (v1-format) entries for current non-v2 members that stay in the
  // pool when not retiring — so guidance always describes the real pool.
  const v1Attrs = JSON.parse(fs.readFileSync(V1_ATTRIBUTES_PATH, 'utf8')).products;
  const v1ById = new Map(v1Attrs.map((p) => [p.gleameId, p]));
  const legacyEntries = (retireDropped ? [] : dropped).map((p) => {
    const a = v1ById.get(p.id) || { name: p.product_name, colors: [], types: [], formula: 'Lacquer' };
    const live = catalogIds.has(lib.numericId(p.shopify_id));
    return { ...a, gleameId: p.id, name: p.product_name, retired: !live, bestsellerRank: rank.get(lib.numericId(p.shopify_id)) ?? null };
  });
  const resultingPool = [...v2Entries, ...legacyEntries];
  const heroesFor = (entries) => entries
    .filter((e) => !e.retired && e.available !== false && e.bestsellerRank != null)
    .sort((a, b) => a.bestsellerRank - b.bestsellerRank)
    .slice(0, HERO_COUNT);
  const heroes = heroesFor(resultingPool);
  const guidance = buildGuidance({ products: resultingPool });
  fs.writeFileSync(GUIDANCE_PREVIEW_PATH, guidance);
  console.log(`resulting pool if applied with these flags: ${resultingPool.length} (${v2Entries.length} v2 + ${legacyEntries.length} legacy); maxLlmCandidates cap is 200${resultingPool.length > 200 ? ' — EXCEEDED, the ranker would see a random 200' : ''}`);
  console.log(`guidance preview (${guidance.length} chars, live today ${config.ai_guidance?.length ?? 0}) -> ${path.relative(lib.ROOT, GUIDANCE_PREVIEW_PATH)}${pushGuidance ? '' : ' [not pushed: pass --push-guidance]'}`);
  console.log(`proposed priority heroes (live Bestsellers order within that pool, in stock): ${heroes.map((h) => `${h.bestsellerRank}:${h.name}${h.topper ? ' (topper)' : ''}`).join(', ')}`);

  if (!apply) {
    console.log('\nDRY RUN — no DB writes. Plan on --apply: '
      + `reinstate ${reinstate.length}, insert ${onboard.length} (with VTO prompt + reference image, ai_model ${modelFlag === 'keep' ? vto.DEFAULT_AI_MODEL : modelFlag}, image=${imageMode})`
      + `${pushGuidance ? ', push guidance + heroes' : ''}${retireDropped ? `, product_scope -> selected with the ${v2Entries.length} v2 rows (drops ${dropped.length})` : ''}.`);
    return;
  }

  // ================= APPLY =================
  if (specErrors.length || unresolved.length || dupRows.length) {
    throw new Error('refusing to apply: spec errors, unresolved handles or duplicate rows (see above)');
  }
  const categories = [...new Set(state.products.map((p) => p.category_id).filter(Boolean))];
  if (categories.length !== 1) throw new Error(`expected one category_id across ORLY rows, got ${categories.join(', ')}`);

  const backupFile = lib.writeBackup('pool-v2', {
    note: 'Pre-apply state for orly-pool-v2.cjs. Inserted rows are listed in the run log; config columns below are the only config values the script may change.',
    config: {
      product_scope: config.product_scope,
      selected_product_ids: config.selected_product_ids,
      priority_product_ids: config.priority_product_ids,
      ai_guidance: config.ai_guidance,
      updated_at: config.updated_at,
    },
    products: state.products.map((p) => ({ id: p.id, product_name: p.product_name, shopify_id: p.shopify_id, status: p.status, handle: p.handle })),
    plan: {
      reinstate: reinstate.map((r) => r.row.id),
      onboardHandles: onboard.map((r) => r.handle),
      dropped: dropped.map((p) => p.id),
      flags: { pushGuidance, retireDropped, modelFlag, imageMode },
    },
  });
  console.log(`\nbackup written: ${backupFile}`);

  // Reinstate (status -> NULL), guarded by id.
  for (const r of reinstate) {
    if (lib.isLiveRow(r.row)) continue; // out of pool only via selected scope; handled in config step
    const upd = await sb.from('products').update({ status: null }).eq('id', r.row.id).eq('shop_id', lib.SHOP_ID).select('id');
    if (upd.error || !upd.data || upd.data.length !== 1) throw new Error(`reinstate ${r.row.product_name}: ${upd.error?.message || `matched ${upd.data?.length ?? 0} rows`}`);
    console.log(`reinstated ${r.row.product_name}`);
  }

  // Insert new rows, each fully VTO-configured.
  const sharp = require(path.join(lib.ROOT, 'node_modules', 'sharp'));
  let inserted = 0;
  const insertFailures = [];
  for (const r of onboard) {
    try {
      const gid = `gid://shopify/Product/${r.catalog.id}`;
      const exists = await sb.from('products').select('id').eq('shop_id', lib.SHOP_ID).eq('shopify_id', gid);
      if (exists.error) throw new Error(`pre-insert check: ${exists.error.message}`);
      if (exists.data.length) { console.log(`= ${r.catalog.title} already exists (re-run), skipping`); continue; }
      const productJson = await lib.fetchProductByHandle(r.handle);
      const id = crypto.randomUUID();
      const fields = await vto.buildVtoFields({ sharp, productJson, productId: id, existingModel: null, modelFlag, imageMode });
      const ins = await sb.from('products').insert({
        id,
        shop_id: lib.SHOP_ID,
        product_name: r.catalog.title,
        shopify_id: gid,
        handle: r.catalog.handle,
        category_id: categories[0],
        is_funnel_generated: false,
        ...fields,
      }).select('id');
      if (ins.error) throw new Error(`insert: ${ins.error.message}`);
      if (!ins.data || ins.data.length !== 1) throw new Error(`insert returned ${ins.data?.length ?? 0} rows`);
      inserted++;
      console.log(`+ ${r.catalog.title} [${r.formula}]`);
    } catch (e) {
      insertFailures.push(r.handle);
      console.warn(`FAIL ${r.handle}: ${e.message}`);
    }
  }
  console.log(`inserted ${inserted}, failed ${insertFailures.length}`);

  // Re-read, attach real ids, rewrite the attributes file.
  const after = await lib.loadShopState(sb);
  const idByNum = new Map(after.products.map((p) => [lib.numericId(p.shopify_id), p.id]));
  for (const e of v2Entries) e.gleameId = idByNum.get(e.shopifyId) ?? null;
  writeAttributes(v2Entries);
  const missingIds = v2Entries.filter((e) => !e.gleameId);

  // Config (single-row update, only when something needs changing).
  const patch = {};
  if (config.product_scope === 'selected' && !retireDropped) {
    patch.selected_product_ids = [...new Set([...(config.selected_product_ids || []), ...v2Entries.map((e) => e.gleameId).filter(Boolean)])];
  }
  if (pushGuidance || retireDropped) {
    if (insertFailures.length || missingIds.length) {
      console.warn(`SKIPPING config step: ${insertFailures.length} insert failures / ${missingIds.length} v2 products without rows. Re-run --apply (idempotent) first.`);
      process.exitCode = 1;
      return;
    }
    const finalPool = [...v2Entries, ...legacyEntries];
    patch.ai_guidance = buildGuidance({ products: finalPool });
    patch.priority_product_ids = heroesFor(finalPool).map((h) => h.gleameId);
  }
  if (retireDropped) {
    patch.product_scope = 'selected';
    patch.selected_product_ids = v2Entries.map((e) => e.gleameId);
  }
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const upd = await sb.from('chat_assistant_config').update(patch).eq('shop_domain', lib.SHOP_DOMAIN).select('shop_domain');
    if (upd.error) throw new Error(`config update: ${upd.error.message}`);
    if (!upd.data || upd.data.length !== 1) throw new Error(`config update matched ${upd.data?.length ?? 0} rows`);
    console.log(`config updated: ${Object.keys(patch).filter((k) => k !== 'updated_at').join(', ')}`);
  }

  const final = await lib.loadShopState(sb);
  const finalPool = final.products.filter((p) => lib.inPool(p, final.config));
  const v2InPool = finalPool.filter((p) => v2Ids.has(lib.numericId(p.shopify_id))).length;
  console.log(`\nVERIFY: pool now ${finalPool.length} rows (${v2InPool}/${v2Ids.size} v2); scope ${final.config.product_scope}; heroes ${final.config.priority_product_ids?.length}; backup ${backupFile}`);
  if (insertFailures.length || v2InPool !== v2Ids.size) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
