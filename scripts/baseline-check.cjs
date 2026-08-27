// Live-merchant regression gate for the quiz-first overhaul.
// Re-fetches ORLY + L&M storefront responses and compares them to the golden
// captures in scripts/baselines/<date>/, then asserts their products /
// product_variants / recommendation_rules row counts are unchanged.
//
// Run after EVERY deploy of an overhaul phase. Any diff = stop and investigate.
//
// Diff rules:
//   quiz-config, recommendation-config  -> deep-equal (normalized JSON)
//   quiz-recommend (L&M, matrix mode)   -> deep-equal on matches/matrixApplied/partial
//   quiz-recommend (ORLY, ai mode)      -> schema keys + match count + flags only
//                                          (LLM ordering is nondeterministic)
//
// USAGE: node scripts/baseline-check.cjs [--baseline 2026-08-26] [--update-counts]
'use strict';
const fs = require('fs');
const path = require('path');

// Scripts in this repo expect env exported; fall back to parsing .env so this
// can run standalone.
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const APP_URL = 'https://glimpse-app-charles.onrender.com';
const SHOPS = ['orlybeauty.myshopify.com', 'locks-mane.myshopify.com'];
const CANNED = {
  'orlybeauty.myshopify.com': {
    criteria: { vibe: 'timeless', intensity: 'just_right', colors: ['reds'], finishes: ['classic_creme'] },
    mode: 'ai', // schema-level diff only
  },
  'locks-mane.myshopify.com': {
    criteria: { goal: 'length', style_intent: 'everyday', current_length: 'at_shoulders', thickness: 'medium', blunt_cut: 'no' },
    mode: 'matrix', // deep-equal diff
  },
};

const argIdx = process.argv.indexOf('--baseline');
const BASELINE = argIdx > -1 ? process.argv[argIdx + 1] : '2026-08-26';
const DIR = path.join(__dirname, 'baselines', BASELINE);
const COUNTS_FILE = path.join(DIR, 'row-counts.json');

const stable = (o) => JSON.stringify(sortKeys(o));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function rowCounts() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
  const out = {};
  for (const domain of SHOPS) {
    const { data: shop, error } = await sb.from('shops').select('id').eq('shop_domain', domain).single();
    if (error || !shop) throw new Error(`shop lookup failed for ${domain}: ${error?.message}`);
    const counts = {};
    const { count: p } = await sb.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id);
    counts.products = p;
    const { data: prodIds } = await sb.from('products').select('id').eq('shop_id', shop.id);
    const ids = (prodIds || []).map((r) => r.id);
    let variants = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { count: v } = await sb.from('product_variants').select('id', { count: 'exact', head: true }).in('product_id', ids.slice(i, i + 200));
      variants += v || 0;
    }
    counts.product_variants = variants;
    const { count: r } = await sb.from('recommendation_rules').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id);
    counts.recommendation_rules = r;
    out[domain] = counts;
  }
  return out;
}

(async () => {
  let failures = 0;
  const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
  const ok = (msg) => console.log(`  ok    ${msg}`);

  for (const shop of SHOPS) {
    console.log(`\n== ${shop}`);
    for (const ep of ['quiz-config', 'recommendation-config']) {
      const live = await fetchJson(`${APP_URL}/api/storefront/${ep}?shopDomain=${shop}`);
      const golden = JSON.parse(fs.readFileSync(path.join(DIR, `${shop}.${ep}.json`), 'utf8'));
      if (stable(live) === stable(golden)) ok(ep);
      else fail(`${ep} differs from baseline ${BASELINE}`);
    }

    const { criteria, mode } = CANNED[shop];
    const live = await fetchJson(`${APP_URL}/api/storefront/quiz-recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopDomain: shop, criteria }),
    });
    const golden = JSON.parse(fs.readFileSync(path.join(DIR, `${shop}.quiz-recommend.json`), 'utf8'));
    if (mode === 'matrix') {
      if (stable(live) === stable(golden)) ok('quiz-recommend (deep)');
      else fail('quiz-recommend deep diff (matrix mode should be deterministic)');
    } else {
      const shape = (j) => stable({ keys: Object.keys(j).sort(), n: (j.matches || []).length, matrixApplied: j.matrixApplied, partial: j.partial, matchKeys: Object.keys((j.matches || [])[0] || {}).sort() });
      if (shape(live) === shape(golden)) ok('quiz-recommend (schema/count)');
      else fail('quiz-recommend schema/count diff');
    }
  }

  console.log('\n== row counts');
  const counts = await rowCounts();
  if (process.argv.includes('--update-counts') || !fs.existsSync(COUNTS_FILE)) {
    fs.writeFileSync(COUNTS_FILE, JSON.stringify(counts, null, 2));
    console.log(`  wrote ${COUNTS_FILE}`);
  } else {
    const golden = JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf8'));
    if (stable(counts) === stable(golden)) ok(`row counts unchanged ${JSON.stringify(counts)}`);
    else fail(`row counts changed: baseline ${JSON.stringify(golden)} vs now ${JSON.stringify(counts)}`);
  }

  console.log(failures ? `\n${failures} FAILURE(S) - do not proceed` : '\nAll baseline checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
