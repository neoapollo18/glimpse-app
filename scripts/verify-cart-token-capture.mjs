/**
 * Post-v2 cart_token capture diagnostic.
 *
 * Run from the repo root:
 *   node scripts/verify-cart-token-capture.mjs
 *
 * Requires SUPABASE_URL and SUPABASE_API_KEY in .env (no dotenv dependency —
 * parsed with node:fs, mirroring supabase.server.ts's pattern).
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// 1.  Parse .env (manual, no dotenv required)
// ---------------------------------------------------------------------------
function loadEnv() {
  let raw = '';
  try {
    raw = readFileSync('.env', 'utf8');
  } catch {
    console.error('ERROR: .env file not found. Run from the repo root.');
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_API_KEY = env.SUPABASE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_API_KEY) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_API_KEY missing from .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_API_KEY);

// ---------------------------------------------------------------------------
// 2.  Constants
// ---------------------------------------------------------------------------
const SHOP_ID = '9da13c55-fac7-4043-ab14-7ec8a014c142';
const V2_START = new Date('2026-05-02T00:00:00Z'); // midnight UTC (~5 pm PT 2026-05-01)

// Token classification regexes
const RE_MATCHABLE = /^[A-Za-z0-9]{20,30}$/;  // Cart-API format (joinable)
const RE_LEGACY_HEX = /^[0-9a-f]{32}$/;        // legacy 32-hex (un-joinable)

// ---------------------------------------------------------------------------
// 3.  Paginated fetch of transformation events in a time window
// ---------------------------------------------------------------------------
async function fetchTransformationEvents(sinceIso, untilIso) {
  const PAGE = 1000;
  let rows = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let q = supabase
      .from('analytics_events')
      .select('id, created_at, cart_token, widget_type, product_id')
      .eq('shop_id', SHOP_ID)
      .eq('event_type', 'transformation')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);

    if (untilIso) q = q.lt('created_at', untilIso);

    const { data, error } = await q;
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    hasMore = data.length === PAGE;
    from += PAGE;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 4.  Classify and report a batch of rows
// ---------------------------------------------------------------------------
function classifyToken(token) {
  if (!token) return 'null';
  if (RE_LEGACY_HEX.test(token)) return 'legacy-hex';
  if (RE_MATCHABLE.test(token)) return 'matchable';
  return 'other';
}

function analyzeWindow(label, rows, daysBackForRpc) {
  const total = rows.length;
  const nonNull = rows.filter(r => r.cart_token !== null && r.cart_token !== undefined && r.cart_token !== '');
  const nullRows = rows.filter(r => !r.cart_token);

  const matchable = nonNull.filter(r => classifyToken(r.cart_token) === 'matchable');
  const legacyHex = nonNull.filter(r => classifyToken(r.cart_token) === 'legacy-hex');
  const other = nonNull.filter(r => classifyToken(r.cart_token) === 'other');

  const pctNull = total > 0 ? ((nullRows.length / total) * 100).toFixed(1) : 'n/a';
  const pctNonNull = total > 0 ? ((nonNull.length / total) * 100).toFixed(1) : 'n/a';
  const pctHexAmongCaptured = nonNull.length > 0 ? ((legacyHex.length / nonNull.length) * 100).toFixed(1) : '0.0';
  const pctMatchableAmongCaptured = nonNull.length > 0 ? ((matchable.length / nonNull.length) * 100).toFixed(1) : '0.0';
  const pctOtherAmongCaptured = nonNull.length > 0 ? ((other.length / nonNull.length) * 100).toFixed(1) : '0.0';

  return {
    label,
    total,
    nonNull: nonNull.length,
    nullCount: nullRows.length,
    pctNull,
    pctNonNull,
    matchable: matchable.length,
    legacyHex: legacyHex.length,
    other: other.length,
    pctHexAmongCaptured,
    pctMatchableAmongCaptured,
    pctOtherAmongCaptured,
    sampleHexRows: legacyHex.slice(0, 5).map(r => ({
      created_at: r.created_at,
      widget_type: r.widget_type,
      product_id: r.product_id,
      cart_token_prefix: r.cart_token.slice(0, 8) + '…',
    })),
    daysBackForRpc,
  };
}

function printWindowReport(analysis) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`WINDOW: ${analysis.label}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Total transformation events : ${analysis.total}`);
  console.log(`  Non-null cart_token         : ${analysis.nonNull} (${analysis.pctNonNull}%)`);
  console.log(`  Null cart_token             : ${analysis.nullCount} (${analysis.pctNull}%)`);
  console.log('');
  console.log('  Among non-null tokens:');
  console.log(`    Matchable Cart-API format : ${analysis.matchable} (${analysis.pctMatchableAmongCaptured}%)`);
  console.log(`    Legacy 32-hex (bad)       : ${analysis.legacyHex} (${analysis.pctHexAmongCaptured}%)`);
  console.log(`    Other format              : ${analysis.other} (${analysis.pctOtherAmongCaptured}%)`);
}

// ---------------------------------------------------------------------------
// 5.  RPC call
// ---------------------------------------------------------------------------
async function fetchConversionStats(daysBack) {
  const { data, error } = await supabase.rpc('get_conversion_stats', {
    p_shop_id: SHOP_ID,
    p_days_back: daysBack,
  });
  if (error) return { error: error.message };
  const stats = Array.isArray(data) ? data[0] : data;
  return stats || {};
}

// ---------------------------------------------------------------------------
// 6.  Main
// ---------------------------------------------------------------------------
async function main() {
  const now = new Date();

  // Window boundaries
  const v2SinceIso = V2_START.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaySinceIso = sevenDaysAgo.toISOString();

  // Days-back for RPC (computed at runtime so it works on any run date)
  const daysBackV2 = Math.max(1, Math.ceil((now - V2_START) / (1000 * 60 * 60 * 24)));

  console.log('Gleame cart_token capture diagnostic — post-v2 deploy');
  console.log(`Run at        : ${now.toISOString()}`);
  console.log(`Shop ID       : ${SHOP_ID}`);
  console.log(`v2 window from: ${v2SinceIso}  (p_days_back = ${daysBackV2})`);
  console.log(`7-day from    : ${sevenDaySinceIso}  (p_days_back = 7)`);
  console.log('\nFetching data… (may take a moment for large shops)');

  // Fetch both windows in parallel
  const [v2Rows, sevenDayRows, v2Stats, sevenDayStats] = await Promise.all([
    fetchTransformationEvents(v2SinceIso, null),
    fetchTransformationEvents(sevenDaySinceIso, null),
    fetchConversionStats(daysBackV2),
    fetchConversionStats(7),
  ]);

  const v2Analysis = analyzeWindow(`Since v2 deploy (>= ${v2SinceIso})`, v2Rows, daysBackV2);
  const sevenDayAnalysis = analyzeWindow('Trailing 7 days', sevenDayRows, 7);

  // Print window reports
  printWindowReport(v2Analysis);
  console.log('\n  get_conversion_stats RPC output:');
  console.log(' ', JSON.stringify(v2Stats, null, 2).replace(/\n/g, '\n  '));

  printWindowReport(sevenDayAnalysis);
  console.log('\n  get_conversion_stats RPC output:');
  console.log(' ', JSON.stringify(sevenDayStats, null, 2).replace(/\n/g, '\n  '));

  // Verdicts
  console.log(`\n${'='.repeat(70)}`);
  console.log('VERDICTS');
  console.log(`${'='.repeat(70)}`);

  const hexShareV2 = parseFloat(v2Analysis.pctHexAmongCaptured);
  const v2Pass = hexShareV2 <= 5;
  console.log(`\nVERDICT (v2 window): hex share among captured = ${v2Analysis.pctHexAmongCaptured}%. ${v2Pass ? 'PASS' : 'FAIL'} (threshold ≤ 5%)`);

  if (!v2Pass && v2Analysis.sampleHexRows.length > 0) {
    console.log('\nSample legacy-hex rows (up to 5) — widget_type tells you which file is still emitting hex:');
    for (const r of v2Analysis.sampleHexRows) {
      console.log(`  created_at=${r.created_at}  widget_type=${r.widget_type}  product_id=${r.product_id}  token=${r.cart_token_prefix}`);
    }
  }

  // Null rate explosion check (v2 window vs 7-day)
  const nullRateV2 = v2Analysis.total > 0 ? (v2Analysis.nullCount / v2Analysis.total) * 100 : 0;
  const nullRate7d = sevenDayAnalysis.total > 0 ? (sevenDayAnalysis.nullCount / sevenDayAnalysis.total) * 100 : 0;
  if (nullRateV2 > nullRate7d + 20) {
    console.log(`\nWARNING: null rate jumped from ${nullRate7d.toFixed(1)}% (7d) to ${nullRateV2.toFixed(1)}% (v2 window).`);
    console.log('         This means v2 is rejecting more legacy-hex tokens (expected), but coverage is lower.');
    console.log('         Acceptable if hex share is clean; watch for further drops as old sessions age out.');
  } else {
    console.log(`\nNull-rate check: 7d=${nullRate7d.toFixed(1)}%  v2-window=${nullRateV2.toFixed(1)}%  — no unexpected explosion.`);
  }

  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
