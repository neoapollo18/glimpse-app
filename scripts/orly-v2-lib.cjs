// Shared helpers for the ORLY "Find Your Vibe" pool v2 tooling
// (orly-pool-v2.cjs, orly-vto-backfill.cjs, orly-acceptance-test-v2.cjs).
//
// Source of truth: "ORLY Recommendation Backfill v2" spec, §6 pool table
// (165 products; the companion CSV it mentions was never delivered). The
// table is parsed from the markdown and snapshotted to
// brand-configs/orly-pool-v2-spec.json so later runs don't depend on
// ~/Downloads.
//
// How pool membership works in Gleame (read from app/lib, not guessed):
// recommendation-engine.server.ts buildCandidatePool() = every products row
// for the shop with status NULL/'active', then — only when
// chat_assistant_config.product_scope === 'selected' — filtered to
// selected_product_ids. ORLY runs product_scope 'all_configured', so today
// "in the pool" == "has a live products row". There is no retired flag in
// the DB; v1 tooling called a row "retired" when its shopify_id is gone from
// the public catalog.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOP_DOMAIN = 'orlybeauty.myshopify.com';
const SHOP_ID = '6ca0597c-09a4-4c6e-b60f-a6947e0fc02d';
const STOREFRONT = 'https://www.orlybeauty.com';
const DEFAULT_SPEC_MD = '/Users/charles/Downloads/ORLY Recommendation Backfill v2.md';
const SPEC_SNAPSHOT_PATH = path.join(__dirname, 'brand-configs', 'orly-pool-v2-spec.json');
const ATTRIBUTES_V2_PATH = path.join(__dirname, 'brand-configs', 'orly-attributes-v2.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

const CHIPS = ['reds', 'oranges', 'yellows', 'greens', 'blues', 'purples', 'pinks', 'nudes', 'browns', 'whites', 'greys', 'blacks'];
const FINISH_BUCKETS = ['creme', 'soft_shimmer', 'full_sparkle', 'chrome_metallic', 'sheer_glossy'];
const FORMULA_BY_PRODUCT_TYPE = {
  'Breathable Treatment + Color': 'Breathable',
  'Nail Lacquers': 'Lacquer',
  'Gel Color': 'GELFX',
};

function loadEnv() {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
}

function supabaseClient() {
  loadEnv();
  const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase/supabase-js'));
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
}

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : fallback;
}

// ---- Spec §6 table ----

// Parse the §6 markdown table. Multi-value cells use '|' inside the cell
// (e.g. `creme|sheer_glossy`); column separators are ' | ' with spaces.
function parseSpecMarkdown(md) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^## 6\. THE POOL/.test(l));
  if (start < 0) throw new Error('spec: "## 6. THE POOL" section not found');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) break;
    if (!/^\| `/.test(l)) continue;
    const cells = l.replace(/^\| /, '').replace(/ \|$/, '').split(' | ').map((s) => s.trim());
    if (cells.length !== 8) throw new Error(`spec: expected 8 cells, got ${cells.length}: ${l}`);
    const [id, name, chips, finish, depth, formula, hex, cls] = cells;
    rows.push({
      handle: id.replace(/`/g, ''),
      name,
      chips: chips ? chips.split('|') : [],
      finishes: finish ? finish.split('|') : [],
      depth,
      formula,
      hex: hex.toUpperCase(),
      class: cls,
    });
  }
  return rows;
}

// Load the spec rows: parse the markdown when available (and refresh the
// snapshot), else fall back to the committed snapshot.
function loadSpecRows({ specPath = DEFAULT_SPEC_MD, writeSnapshot = true } = {}) {
  if (specPath && fs.existsSync(specPath)) {
    const rows = parseSpecMarkdown(fs.readFileSync(specPath, 'utf8'));
    if (writeSnapshot) {
      fs.writeFileSync(SPEC_SNAPSHOT_PATH, JSON.stringify({
        source: path.basename(specPath), section: '§6 THE POOL', parsedAt: new Date().toISOString(), rows,
      }, null, 1));
    }
    return { rows, source: specPath };
  }
  if (!fs.existsSync(SPEC_SNAPSHOT_PATH)) throw new Error(`no spec markdown at ${specPath} and no snapshot at ${SPEC_SNAPSHOT_PATH}`);
  return { rows: JSON.parse(fs.readFileSync(SPEC_SNAPSHOT_PATH, 'utf8')).rows, source: SPEC_SNAPSHOT_PATH };
}

// ---- Spec §2.4 depth ----
// Gamma-encoded sRGB channels (NOT linearised) — this is what reproduces the
// spec's depth column (165/165) and the §3 distribution light 74/mid 50/deep 41.
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function depthFromHex(hex) {
  const L = luminance(hex);
  return L >= 0.62 ? 'light' : L <= 0.26 ? 'deep' : 'mid';
}

// ---- Public catalog ----
// Storefront JSON rate-limits bursts (HTTP 429 seen at 6 parallel requests):
// retry 429/5xx with backoff, honoring Retry-After.
async function fetchJson(url, attempts = 6) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) return res.json();
    if (i >= attempts || !(res.status === 429 || res.status >= 500)) throw new Error(`${url}: HTTP ${res.status}`);
    const retryAfter = Number(res.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, (retryAfter > 0 ? retryAfter * 1000 : 0) + 1000 * 2 ** (i - 1)));
  }
}

async function fetchCatalog() {
  const all = [];
  for (let page = 1; page <= 12; page++) {
    const prods = (await fetchJson(`${STOREFRONT}/products.json?limit=250&page=${page}`)).products || [];
    if (prods.length === 0) break;
    all.push(...prods);
  }
  return all;
}

// Live Bestsellers collection order (spec Rule 6). Empty array on failure.
async function fetchBestsellers() {
  const out = [];
  try {
    for (let page = 1; page <= 4; page++) {
      const prods = (await fetchJson(`${STOREFRONT}/collections/bestsellers/products.json?limit=250&page=${page}`)).products || [];
      if (prods.length === 0) break;
      out.push(...prods);
    }
  } catch (e) {
    console.warn(`WARN bestsellers scrape failed (${e.message}); bestsellerRank will be null`);
    return [];
  }
  return out;
}

// products/<handle>.json — the per-product endpoint the VTO image pick uses.
async function fetchProductByHandle(handle) {
  return (await fetchJson(`${STOREFRONT}/products/${encodeURIComponent(handle)}.json`)).product;
}

// ---- DB state (read-only) ----
async function loadShopState(sb) {
  const shop = await sb.from('shops').select('id, shop_domain, catalog_sync_enabled').eq('shop_domain', SHOP_DOMAIN);
  if (shop.error) throw new Error(`shops read: ${shop.error.message}`);
  if (!shop.data || shop.data.length !== 1) throw new Error(`expected exactly 1 shops row for ${SHOP_DOMAIN}, got ${shop.data?.length}`);
  if (shop.data[0].id !== SHOP_ID) throw new Error(`shop id mismatch: ${shop.data[0].id} != ${SHOP_ID}`);

  const cfg = await sb.from('chat_assistant_config')
    .select('shop_domain, product_scope, selected_product_ids, priority_product_ids, ai_guidance, updated_at')
    .eq('shop_domain', SHOP_DOMAIN);
  if (cfg.error) throw new Error(`chat_assistant_config read: ${cfg.error.message}`);
  if (!cfg.data || cfg.data.length !== 1) throw new Error(`expected 1 chat_assistant_config row, got ${cfg.data?.length}`);

  const products = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from('products')
      .select('id, product_name, shopify_id, status, handle, category_id, is_funnel_generated, ai_model, transformation_prompt, reference_image_url, reference_image_urls')
      .eq('shop_id', SHOP_ID).order('id').range(from, from + 999);
    if (r.error) throw new Error(`products read: ${r.error.message}`);
    products.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return { shop: shop.data[0], config: cfg.data[0], products };
}

const numericId = (gid) => String(gid || '').split('/').pop();
const isLiveRow = (p) => p.status == null || p.status === 'active';

// Mirrors buildCandidatePool's membership test.
function inPool(row, config) {
  if (!isLiveRow(row)) return false;
  if (config.product_scope === 'selected') return (config.selected_product_ids || []).includes(row.id);
  return true;
}

// Write a backup JSON BEFORE any DB write. Never overwrites an existing
// backup: a second run the same day gets a -2, -3... suffix.
function writeBackup(what, payload) {
  const date = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let file = path.join(BACKUP_DIR, `orly-${what}-${date}.json`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(BACKUP_DIR, `orly-${what}-${date}-${n}.json`);
  fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), shopDomain: SHOP_DOMAIN, shopId: SHOP_ID, ...payload }, null, 1));
  // Read back: a backup we can't parse is no backup.
  JSON.parse(fs.readFileSync(file, 'utf8'));
  return file;
}

module.exports = {
  ROOT, SHOP_DOMAIN, SHOP_ID, STOREFRONT, DEFAULT_SPEC_MD, SPEC_SNAPSHOT_PATH, ATTRIBUTES_V2_PATH,
  CHIPS, FINISH_BUCKETS, FORMULA_BY_PRODUCT_TYPE,
  loadEnv, supabaseClient, argValue,
  parseSpecMarkdown, loadSpecRows, luminance, depthFromHex,
  fetchJson, fetchCatalog, fetchBestsellers, fetchProductByHandle,
  loadShopState, numericId, isLiveRow, inPool, writeBackup,
};
