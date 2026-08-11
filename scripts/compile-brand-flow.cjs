// Compile a brand config (decision tables + shade maps + taxonomy) into the
// generic recommendation engine's flat scored rules, and save atomically via
// the save_recommendation_config RPC. The engine stays brand-agnostic; a new
// brand is a new JSON file, not new code.
//
// HOW IT COMPILES (Locks & Mane shapes, but generic):
//   - questions carry question-level showIf (migration 047) so e.g. the
//     extension-fit questions are skipped for accessory shoppers. A question
//     may list explicit options ({label, value}) — two labels can map to one
//     value ("I'm not sure" → no); otherwise options mirror the axis values.
//   - each extensions matrix cell (current_length × goal) expands per photo
//     shade AND per sets-table combo (e.g. thickness × blunt_cut): clip-in rule
//     (rank 1, quantity = max(cell sets, sets-table row)) + optional
//     ponytail rule (rank 2, shade remapped through shadeVariantMap.ponytail
//     — Jenn's lookup). Cells without a pony yield a SINGLE recommendation.
//     There is INTENTIONALLY no shade-less backstop: before the selfie the
//     match is partial, which is what triggers the quiz's shade gate.
//   - setsTable rows (Rule Set 2) are evaluated first-match-wins per
//     (combo axes, cell length); the combo axes are derived from the
//     keys the rows actually use, so other brands can table on other axes.
//   - accessories.byStyleIntent become {category, style_intent} rules that
//     resolve without any extension question answered — the early exit.
//   - variantFallbackProducts routes a shade a product doesn't stock to
//     another product's variant at compile time (clip_12 → clip_16), instead
//     of the old shade-less product-level target.
//   - shadeFallbacks + availabilityFilter + multiSetPrompt are written to
//     chat_assistant_config (quiz_shade_fallbacks / quiz_availability_filter /
//     quiz_multi_set_prompt, migration 052).
//
// USAGE:
//   node scripts/compile-brand-flow.cjs [path/to/brand.json] [--dry-run]
//     [--criteria=k=v,k=v,...]
//   (default config: scripts/brand-configs/locks-and-mane.json)
//
// --dry-run validates the config and prints compiled counts without touching
// the DB (works before the brand's shop/products exist in Gleame).
// --criteria scores the compiled rules with the SAME semantics as
// matchRecommendationRules (specificity, extras/partial, target dedupe) and
// prints the winning targets — QA a decision-table cell without a deploy.
//
// Idempotent: wipe-and-rewrite via the RPC, same as seed-demo-flows.cjs.
// Fails loudly on a missing product name; a missing VARIANT (shade not
// stocked) warns and routes through variantFallbackProducts, ending on a
// product-level target only when no product in the chain stocks the shade.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const configPath = args.find((a) => !a.startsWith('--'))
  || path.join(__dirname, 'brand-configs', 'locks-and-mane.json');

const brand = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ---- Validate config shape before touching anything ----
const fail = (msg) => { console.error('CONFIG ERROR: ' + msg); process.exit(1); };
const ID_RE = /^[a-z_][a-z0-9_]*$/;

const axisByKey = new Map();
for (const ax of brand.axes || []) {
  if (!ID_RE.test(ax.key || '')) fail(`axis key "${ax.key}" must be lower snake_case`);
  const values = new Set();
  for (const v of ax.values || []) {
    if (!ID_RE.test(v.value || '')) fail(`value "${v.value}" in axis "${ax.key}" must be lower snake_case`);
    values.add(v.value);
  }
  axisByKey.set(ax.key, { ...ax, valueSet: values });
}
const requireAxisValue = (key, value, where) => {
  const ax = axisByKey.get(key);
  if (!ax) fail(`${where} references unknown axis "${key}"`);
  if (!ax.valueSet.has(value)) fail(`${where} references unknown value "${key}=${value}"`);
};

for (const q of brand.questions || []) {
  if (!axisByKey.has(q.axisKey)) fail(`question references unknown axis "${q.axisKey}"`);
  if (q.showIf) requireAxisValue(q.showIf.axis_key, q.showIf.axis_value, `question "${q.axisKey}" showIf`);
  for (const opt of q.options || []) {
    requireAxisValue(q.axisKey, opt.value, `question "${q.axisKey}" option "${opt.label}"`);
  }
}

const shadeAxis = (brand.axes || []).find((a) => a.source === 'photo');
if (!shadeAxis) fail('no photo-sourced shade axis defined');
const shades = shadeAxis.values.map((v) => v.value);

// $comment is documentation, not a product key.
const productKeys = Object.fromEntries(
  Object.entries(brand.products || {}).filter(([k]) => k !== '$comment')
);
const cells = (brand.matrix && brand.matrix.cells) || [];
for (const cell of cells) {
  requireAxisValue('current_length', cell.current_length, 'matrix cell');
  requireAxisValue('goal', cell.goal, 'matrix cell');
  if (!productKeys[cell.clipIn]) fail(`matrix cell references unknown product key "${cell.clipIn}"`);
  // pony is optional — a cell without one produces a single recommendation.
  if (cell.pony && !productKeys[cell.pony]) fail(`matrix cell references unknown product key "${cell.pony}"`);
}

// Rule Set 2: sets table. Combo axes = whichever axis keys the rows use
// (besides the reserved "sets" and "lengths" keys), so the expansion isn't
// hard-coded to layers/thickness.
const setsRows = (brand.setsTable && brand.setsTable.rows) || [];
const comboAxisKeys = [...new Set(setsRows.flatMap((r) => Object.keys(r)))]
  .filter((k) => k !== 'sets' && k !== 'lengths');
for (const row of setsRows) {
  if (!(Number.isInteger(row.sets) && row.sets > 0)) fail('setsTable row needs a positive integer "sets"');
  for (const k of comboAxisKeys) {
    if (row[k] !== undefined) requireAxisValue(k, row[k], 'setsTable row');
  }
  for (const len of row.lengths || []) requireAxisValue('current_length', len, 'setsTable row lengths');
}
// First matching row wins, mirroring how the table reads on paper.
const setsFromTable = (cell, combo) => {
  for (const row of setsRows) {
    if (row.lengths && !row.lengths.includes(cell.current_length)) continue;
    if (comboAxisKeys.every((k) => row[k] === undefined || row[k] === combo[k])) return row.sets;
  }
  return 1;
};
// Every combination of combo-axis values the table can distinguish.
let combos = [{}];
for (const key of comboAxisKeys) {
  const values = [...axisByKey.get(key).valueSet];
  combos = combos.flatMap((c) => values.map((v) => ({ ...c, [key]: v })));
}

for (const [intent, entries] of Object.entries((brand.accessories && brand.accessories.byStyleIntent) || {})) {
  requireAxisValue('style_intent', intent, 'accessories');
  if (!Array.isArray(entries)) fail(`accessories for "${intent}" must be an array of {name} entries`);
  for (const e of entries) {
    if (!e || typeof e.name !== 'string' || !e.name) fail(`accessories for "${intent}" has an entry without a "name"`);
  }
}
for (const [axisKey, byValue] of Object.entries(brand.shadeFallbacks || {})) {
  if (axisKey === '$comment') continue;
  for (const [value, adjacents] of Object.entries(byValue)) {
    requireAxisValue(axisKey, value, 'shadeFallbacks');
    for (const adj of adjacents) requireAxisValue(axisKey, adj, `shadeFallbacks for "${value}"`);
  }
}
const clipShadeMap = (brand.shadeVariantMap && brand.shadeVariantMap.clip_in) || {};
const ponyShadeMap = (brand.shadeVariantMap && brand.shadeVariantMap.ponytail) || {};
for (const s of shades) {
  if (!clipShadeMap[s]) fail(`shadeVariantMap.clip_in missing shade "${s}"`);
  if (!ponyShadeMap[s]) fail(`shadeVariantMap.ponytail missing shade "${s}"`);
}

// Product-to-product variant fallback ("shade not offered on the 12″ →
// recommend the 16″ in that shade"). Chains are allowed but must not cycle.
const variantFallbacks = Object.fromEntries(
  Object.entries(brand.variantFallbackProducts || {}).filter(([k]) => k !== '$comment')
);
for (const [from, to] of Object.entries(variantFallbacks)) {
  if (!productKeys[from]) fail(`variantFallbackProducts references unknown product key "${from}"`);
  if (!productKeys[to]) fail(`variantFallbackProducts references unknown product key "${to}"`);
  const seen = new Set([from]);
  for (let k = to; k !== undefined; k = variantFallbacks[k]) {
    if (seen.has(k)) fail(`variantFallbackProducts cycle at "${k}"`);
    seen.add(k);
  }
}

if (brand.multiSetPrompt !== undefined &&
    (typeof brand.multiSetPrompt !== 'string' || !brand.multiSetPrompt.trim())) {
  fail('multiSetPrompt must be a non-empty string when present');
}

(async () => {
  // ---- Resolve shop, products, variants (skipped on --dry-run) ----
  let P = (key) => `product:${key}`; // dry-run placeholder resolver
  let variantId = () => null;
  let shopId = null;
  let sb = null;

  if (!dryRun) {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
    }
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

    const shop = await sb.from('shops').select('id').eq('shop_domain', brand.shopDomain).single();
    if (!shop.data) throw new Error('shop not found: ' + brand.shopDomain);
    shopId = shop.data.id;

    const prods = await sb.from('products').select('id, product_name').eq('shop_id', shopId);
    const byName = new Map((prods.data || []).map((p) => [p.product_name, p.id]));
    const neededNames = new Set(Object.values(productKeys));
    for (const entries of Object.values((brand.accessories && brand.accessories.byStyleIntent) || {})) {
      if (Array.isArray(entries)) for (const e of entries) neededNames.add(e.name);
    }
    for (const n of neededNames) {
      if (!byName.has(n)) throw new Error('missing product: ' + n);
    }
    P = (key) => byName.get(productKeys[key] ?? key) || byName.get(key);

    const productIds = [...neededNames].map((n) => byName.get(n));
    const vars = await sb.from('product_variants')
      .select('id, product_id, variant_title')
      .in('product_id', productIds);
    const variantByTitle = new Map(
      (vars.data || []).map((v) => [`${v.product_id}|${v.variant_title}`, v.id])
    );
    variantId = (productId, title) => variantByTitle.get(`${productId}|${title}`) || null;
  }

  // ---- Compile rules ----
  const rules = [];
  const warnings = [];
  // Target helper: prefer the shade's variant. When the product doesn't
  // stock that shade, walk variantFallbackProducts (e.g. clip_12 → clip_16:
  // the 12″ carries only part of the range, so those shoppers get the 16″ in
  // their shade). Only if no product in the chain stocks the shade do we
  // fall back to a product-level target on the LAST product tried — the
  // routing intent is "send them to the fallback", never a shade-less
  // recommendation of the short product. Dry-run can't resolve variants, so
  // it keeps the primary product-level placeholder.
  const target = (productKey, shadeTitle, ruleBase) => {
    if (dryRun) return { ...ruleBase, variantId: null, productId: P(productKey) };
    let key = productKey;
    for (;;) {
      const vid = variantId(P(key), shadeTitle);
      if (vid) {
        if (key !== productKey) warnings.push(`no variant "${shadeTitle}" on ${productKeys[productKey]} — routed to ${productKeys[key]}`);
        return { ...ruleBase, variantId: vid, productId: null };
      }
      const next = variantFallbacks[key];
      if (next === undefined) {
        warnings.push(`no variant "${shadeTitle}" on ${productKeys[productKey]}${key !== productKey ? ` or its fallback chain` : ''} — product-level fallback on ${productKeys[key]}`);
        return { ...ruleBase, variantId: null, productId: P(key) };
      }
      key = next;
    }
  };

  for (const cell of cells) {
    // The category key only exists for brands with an accessory branch
    // (extensions-only configs define no category axis — keying rules on
    // one would leave every match permanently partial).
    const cellCriteria = {
      ...(axisByKey.has('category') ? { category: 'extensions' } : {}),
      current_length: cell.current_length,
      goal: cell.goal,
    };
    for (const shade of shades) {
      const shadeCriteria = { ...cellCriteria, [shadeAxis.key]: shade };
      // Hero clip-in — AI shade used directly. One rule per sets-table combo:
      // quantity = max(cell sets, Rule Set 2 row). L&M cells no longer carry
      // their own sets, so quantity comes straight from the table.
      for (const combo of combos) {
        rules.push(target(cell.clipIn, clipShadeMap[shade], {
          criteria: { ...shadeCriteria, ...combo },
          rank: 1,
          quantity: Math.max(cell.sets || 1, setsFromTable(cell, combo)),
        }));
      }
      // Complementary ponytail (rank 2) — shade remapped through Jenn's
      // lookup; quantity is always 1, so no combo expansion needed. Cells
      // without a pony intentionally produce a single recommendation.
      if (cell.pony) {
        rules.push(target(cell.pony, ponyShadeMap[shade], {
          criteria: shadeCriteria, rank: 2, quantity: 1,
        }));
      }
    }
  }

  // Accessories: resolved from style intent alone — the early exit for
  // category=accessories (extension questions are showIf-hidden for them).
  for (const [intent, entries] of Object.entries((brand.accessories && brand.accessories.byStyleIntent) || {})) {
    (entries || []).forEach((e, i) => {
      rules.push({
        criteria: { category: 'accessories', style_intent: intent },
        variantId: null,
        productId: dryRun ? `product:${e.name}` : P(e.name),
        rank: i + 1,
        quantity: 1,
      });
    });
  }

  // ---- Axes + questions payload ----
  const axesPayload = (brand.axes || []).map((a, i) => ({
    key: a.key, label: a.label, source: a.source, position: i,
    values: a.values.map((v, j) => ({
      value: v.value, label: v.label, position: j, swatchColor: v.swatchColor || null,
    })),
  }));
  const questionsPayload = (brand.questions || []).map((q, qi) => {
    const ax = axisByKey.get(q.axisKey);
    // Explicit options let two labels map to one value ("I'm not sure" → no)
    // and can carry admin-editor styling (imageUrl, displayMeta) so a
    // recompile reproduces it; without them the options mirror the axis
    // values 1:1.
    const optionList = (q.options && q.options.length > 0)
      ? q.options.map((o) => ({
          label: o.label, value: o.value, reasonText: o.reasonText,
          imageUrl: o.imageUrl, displayMeta: o.displayMeta,
        }))
      : ax.values.map((v) => ({ label: v.label, value: v.value, reasonText: v.reasonText }));
    return {
      axisKey: q.axisKey,
      prompt: q.prompt,
      position: qi,
      helperText: q.helperText || null,
      multiSelect: !!q.multiSelect,
      screenGroup: q.screenGroup || null,
      showIf: q.showIf || null,
      // Optional per-question render style (migration 048): chips | boxed |
      // list | visual | rich | vibe. Omitted/null = auto.
      optionStyle: q.optionStyle || null,
      options: optionList.map((o, i) => ({
        label: o.label,
        axisValueValue: o.value,
        botResponse: null,
        reasonText: o.reasonText || null,
        imageUrl: o.imageUrl || null,
        showIf: null,
        selectAll: false,
        displayMeta: o.displayMeta || null,
        position: i,
      })),
    };
  });

  const payload = { axes: axesPayload, questions: questionsPayload, rules };
  console.log(
    `compiled: axes ${axesPayload.length} | questions ${questionsPayload.length} | rules ${rules.length}` +
    ` (matrix cells ${cells.length} × shades ${shades.length}` +
    `, accessory intents ${Object.keys((brand.accessories && brand.accessories.byStyleIntent) || {}).length})`
  );
  for (const w of [...new Set(warnings)]) console.warn('WARN: ' + w);

  // --criteria QA: replicate matchRecommendationRules' scoring so a table
  // cell can be sanity-checked against the compiled rules before any deploy.
  const criteriaArg = args.find((a) => a.startsWith('--criteria='));
  if (criteriaArg) {
    const raw = criteriaArg.slice('--criteria='.length);
    const sel = new Map();
    for (const pair of raw.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) sel.set(k.trim(), v.trim());
    }
    const scored = [];
    for (const r of rules) {
      let matched = 0, extras = 0, conflict = false;
      for (const [k, v] of Object.entries(r.criteria)) {
        if (!sel.has(k)) { extras++; continue; }
        if (sel.get(k) === v || sel.get(k) === '_any') matched++;
        else { conflict = true; break; }
      }
      if (!conflict && matched > 0) scored.push({ r, matched, extras });
    }
    const definitive = scored.filter((s) => s.extras === 0);
    const pool = definitive.length > 0 ? definitive : scored;
    pool.sort((a, b) => (b.matched - a.matched) || (a.r.rank - b.r.rank));
    const seen = new Set(), hits = [];
    for (const s of pool) {
      const key = `${s.r.variantId || ''}|${s.r.productId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(s);
    }
    console.log(`\n--criteria ${raw} → ${hits.length} hit(s)${definitive.length === 0 ? ' (PARTIAL — shade gate would show)' : ''}:`);
    for (const s of hits.slice(0, 6)) {
      console.log(`  rank ${s.r.rank} qty ${s.r.quantity} target ${s.r.variantId || s.r.productId} matched=${s.matched} extras=${s.extras}`);
    }
  }

  if (dryRun) {
    console.log('dry run — nothing saved. Sample rule:', JSON.stringify(rules[0], null, 2));
    return;
  }

  // ---- Destructive-save guard (added after the 2026-07-27 incident where a
  // recompile silently destroyed hours of admin-editor quiz styling). The
  // RPC is wipe-and-rewrite: anything on the live questions/options that
  // this config does not reproduce is lost. Refuse unless --force.
  if (!args.includes('--force')) {
    const cfgQByAxis = new Map(questionsPayload.map((q) => [q.axisKey, q]));
    const axRes = await sb.from('recommendation_axes').select('id, key').eq('shop_id', shopId);
    const keyByAxisId = new Map((axRes.data || []).map((a) => [a.id, a.key]));
    const doomed = [];
    if (keyByAxisId.size > 0) {
      const qRes = await sb.from('recommendation_questions')
        .select('id, axis_id, prompt, option_style, helper_text, screen_group')
        .in('axis_id', [...keyByAxisId.keys()]);
      const liveQs = qRes.data || [];
      for (const q of liveQs) {
        const cfgQ = cfgQByAxis.get(keyByAxisId.get(q.axis_id)) || {};
        if (q.option_style && q.option_style !== cfgQ.optionStyle) doomed.push(`question "${q.prompt}": option_style=${q.option_style}`);
        if (q.helper_text && q.helper_text !== cfgQ.helperText) doomed.push(`question "${q.prompt}": helper_text`);
        if (q.screen_group && q.screen_group !== cfgQ.screenGroup) doomed.push(`question "${q.prompt}": screen_group=${q.screen_group}`);
      }
      if (liveQs.length > 0) {
        const oRes = await sb.from('recommendation_question_options')
          .select('question_id, label, image_url, display_meta, bot_response')
          .in('question_id', liveQs.map((q) => q.id));
        // imageUrl/displayMeta CAN be reproduced by the config (explicit
        // question options) — doom only what the config does not re-emit for
        // the same question axis + option label. bot_response is still never
        // emitted, so any live value is admin-editor work by definition.
        //
        // display_meta comparison must be key-order-insensitive: Postgres
        // jsonb normalizes key order, so a faithfully-reproduced object can
        // come back with keys reordered — a naive JSON.stringify diff would
        // false-doom it and push the operator toward --force, the exact
        // destructive habit this guard exists to prevent.
        const stableStringify = (v) => {
          if (v === null || typeof v !== 'object') return JSON.stringify(v);
          if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
          return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
        };
        const axisKeyByQId = new Map(liveQs.map((q) => [q.id, keyByAxisId.get(q.axis_id)]));
        for (const o of oRes.data || []) {
          const cfgQ = cfgQByAxis.get(axisKeyByQId.get(o.question_id));
          const cfgOpt = (cfgQ && cfgQ.options || []).find((c) => c.label === o.label);
          if (o.image_url && o.image_url !== (cfgOpt && cfgOpt.imageUrl)) doomed.push(`option "${o.label}": image_url`);
          // {} carries no admin work — treat it like absent, or clearing a
          // style panel in the admin editor would false-doom every option.
          if (o.display_meta && Object.keys(o.display_meta).length > 0 && stableStringify(o.display_meta) !== stableStringify((cfgOpt && cfgOpt.displayMeta) || null)) doomed.push(`option "${o.label}": display_meta`);
          if (o.bot_response) doomed.push(`option "${o.label}": bot_response`);
        }
      }
    }
    if (doomed.length > 0) {
      console.error('\nREFUSING TO SAVE — the live flow has admin-made styling this config does not reproduce.');
      console.error('Saving would permanently destroy:');
      for (const d of [...new Set(doomed)]) console.error('  - ' + d);
      console.error('Merge these into the brand config first, or re-run with --force to destroy them.');
      process.exit(1);
    }
  }

  const { error } = await sb.rpc('save_recommendation_config', { p_shop_id: shopId, p_payload: payload });
  if (error) throw new Error('RPC failed: ' + error.message);

  // Availability filter + shade fallback adjacencies live on the assistant
  // config row (keyed by shop_domain), not the matrix payload.
  const fallbacks = {};
  for (const [axisKey, byValue] of Object.entries(brand.shadeFallbacks || {})) {
    if (axisKey === '$comment') continue;
    fallbacks[axisKey] = byValue;
  }
  const { error: cfgErr } = await sb.from('chat_assistant_config').upsert({
    shop_domain: brand.shopDomain,
    quiz_availability_filter: !!brand.availabilityFilter,
    quiz_shade_fallbacks: Object.keys(fallbacks).length > 0 ? fallbacks : null,
    // Migration 052: appended to the try-on prompt when quantity >= 2 (the
    // per-product prompts describe a single set).
    quiz_multi_set_prompt: brand.multiSetPrompt || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_domain' });
  if (cfgErr) throw new Error('chat_assistant_config upsert failed: ' + cfgErr.message);

  console.log(`SAVED for ${brand.shopDomain}. Availability filter: ${!!brand.availabilityFilter}. Storefront picks it up within ~60s.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
