// ORLY Find Your Vibe — pool v2 acceptance test (spec "ORLY Recommendation
// Backfill v2" §3-§5 coverage + §7 ship gate). Offline: reads
// brand-configs/orly-attributes-v2.json (written by orly-pool-v2.cjs). Pool
// sufficiency only — it does not exercise the LLM ranker.
//
// 1. Recomputes the §3 chip x depth, §4 chip x finish and §5 vibe x chip
//    tables over the full 165 pool and diffs every cell against the spec.
// 2. Thin cells (vibe x chip < 3) vs the spec's §5.1 list of 14.
// 3. §7: every path 8 vibes x 3 intensities x (12 chips + surprise_me) x
//    (5 finishes + surprise_me) over IN-STOCK products:
//      stage 0  picked chip + vibe depth + finish (picked, else the vibe's
//               finish profile)
//      stage 1  Rule 7 step 1: drop finish
//      PASS     >= 6 mains carrying the picked chip at stage 0 or 1
//      else     Rule 7 continues: step 2 spectral-neighbor chips, step 3
//               depth one step off -> is a 4-main (+4 wildcard) result
//               reachable?
//      THIN     not PASS, and the (vibe, chip) cell is listed in §5.1
//      FAIL     not PASS, and the cell is NOT in §5.1
//    Toppers (Rule 2) count as mains only on full_sparkle picks or
//    full_glam, max 2. Chipless (multi) products match only Surprise Me.
//    Intensity is a ranking preference in the guidance, not a filter, so it
//    doesn't change pool sufficiency (enumerated for completeness).
//    Ship gate: every non-PASS path is a §5.1 cell.
//
// Vibe profiles (depth + finish) were reverse-engineered from §5: each one
// reproduces its §5 row exactly (pool count and all 12 chip cells).
//
// USAGE: node scripts/orly-acceptance-test-v2.cjs [--attrs <file>] [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');

const verbose = process.argv.includes('--verbose');
const ai = process.argv.indexOf('--attrs');
const ATTRS = ai >= 0 ? process.argv[ai + 1] : path.join(__dirname, 'brand-configs', 'orly-attributes-v2.json');
const attrs = JSON.parse(fs.readFileSync(ATTRS, 'utf8'));
const all = attrs.products.filter((p) => !p.retired);

const VIBES = ['model_off_duty', 'soft_sweet', 'timeless', 'girls_night_out', 'full_glam', 'vacation', 'coastal_cool', 'moody'];
const INTENSITIES = ['subtle', 'just_right', 'full_look'];
const CHIPS = ['reds', 'oranges', 'yellows', 'greens', 'blues', 'purples', 'pinks', 'nudes', 'browns', 'whites', 'greys', 'blacks'];
const FINISHES = ['creme', 'soft_shimmer', 'full_sparkle', 'chrome_metallic', 'sheer_glossy'];
const DEPTHS = ['light', 'mid', 'deep'];

const VIBE_PROFILE = {
  model_off_duty: { depth: ['light'], finish: ['creme', 'soft_shimmer', 'sheer_glossy'] },
  soft_sweet: { depth: ['light'], finish: ['creme', 'soft_shimmer'] },
  timeless: { depth: ['mid', 'deep'], finish: ['creme'] },
  girls_night_out: { depth: ['mid', 'deep'], finish: ['creme', 'soft_shimmer', 'chrome_metallic'] },
  full_glam: { depth: DEPTHS, finish: ['full_sparkle', 'chrome_metallic'] },
  vacation: { depth: ['light', 'mid'], finish: ['creme', 'soft_shimmer', 'full_sparkle'] },
  coastal_cool: { depth: DEPTHS, finish: ['creme', 'soft_shimmer', 'chrome_metallic', 'sheer_glossy'] },
  moody: { depth: ['mid', 'deep'], finish: ['creme', 'soft_shimmer', 'chrome_metallic'] },
};

// Rule 7 spectral neighbors (same as v1 / guidance).
const NEIGHBORS = {
  reds: ['pinks', 'oranges'], pinks: ['reds', 'purples'], purples: ['pinks', 'blues'],
  oranges: ['reds', 'yellows'], yellows: ['oranges', 'greens'], greens: ['yellows', 'blues'],
  blues: ['greens', 'purples'], nudes: ['browns', 'whites'], browns: ['nudes'],
  whites: ['nudes', 'greys'], greys: ['blacks', 'whites'], blacks: ['greys'],
};
const widenDepth = (ds) => [...new Set(ds.flatMap((d) => (d === 'mid' ? DEPTHS : d === 'light' ? ['light', 'mid'] : ['mid', 'deep'])))];

// ---- Spec tables (verbatim from §3, §4, §5, §5.1) ----
const SPEC_S3 = { // light mid deep
  reds: [0, 7, 18], oranges: [8, 15, 6], yellows: [12, 3, 0], greens: [3, 7, 1], blues: [9, 8, 3], purples: [6, 7, 8],
  pinks: [25, 22, 8], nudes: [9, 3, 1], browns: [9, 8, 5], whites: [7, 0, 1], greys: [10, 3, 3], blacks: [0, 0, 4],
};
const SPEC_S4 = { // creme soft_shimmer full_sparkle chrome_metallic sheer_glossy
  reds: [20, 3, 2, 0, 0], oranges: [22, 5, 4, 0, 1], yellows: [4, 8, 6, 1, 0], greens: [5, 1, 4, 3, 1], blues: [11, 3, 4, 2, 0],
  purples: [15, 4, 2, 3, 1], pinks: [41, 6, 8, 5, 4], nudes: [12, 1, 0, 0, 0], browns: [11, 7, 7, 2, 0], whites: [4, 2, 2, 1, 0],
  greys: [8, 2, 8, 1, 0], blacks: [4, 0, 0, 0, 0],
};
const SPEC_S5 = { // pool, then CHIPS order
  model_off_duty: [59, 0, 8, 9, 1, 6, 6, 22, 9, 6, 5, 5, 0],
  soft_sweet: [59, 0, 8, 9, 1, 6, 6, 22, 9, 6, 5, 5, 0],
  timeless: [65, 20, 14, 0, 4, 8, 10, 23, 4, 9, 0, 4, 4],
  girls_night_out: [81, 23, 19, 3, 6, 10, 14, 27, 4, 13, 1, 4, 4],
  full_glam: [40, 2, 4, 6, 6, 6, 4, 10, 0, 7, 3, 9, 0],
  vacation: [120, 7, 23, 15, 9, 15, 13, 46, 12, 17, 7, 13, 0],
  coastal_cool: [144, 23, 27, 13, 8, 16, 20, 52, 13, 20, 6, 9, 4],
  moody: [81, 23, 19, 3, 6, 10, 14, 27, 4, 13, 1, 4, 4],
};
const SPEC_THIN = [
  'model_off_duty|reds', 'model_off_duty|greens', 'model_off_duty|blacks',
  'soft_sweet|reds', 'soft_sweet|greens', 'soft_sweet|blacks',
  'timeless|yellows', 'timeless|whites', 'girls_night_out|whites',
  'full_glam|reds', 'full_glam|nudes', 'full_glam|blacks',
  'vacation|blacks', 'moody|whites',
];

const has = (p, chip) => (p.chips || []).includes(chip);
const hasFinish = (p, fs) => (p.finishes || []).some((f) => fs.includes(f));
const fitsVibe = (p, v) => VIBE_PROFILE[v].depth.includes(p.depth) && hasFinish(p, VIBE_PROFILE[v].finish);

// ---- 1. Coverage tables vs spec ----
const diffs = [];
for (const c of CHIPS) {
  DEPTHS.forEach((d, i) => {
    const n = all.filter((p) => has(p, c) && p.depth === d).length;
    if (n !== SPEC_S3[c][i]) diffs.push(`§3 ${c} x ${d}: got ${n}, spec ${SPEC_S3[c][i]}`);
  });
  FINISHES.forEach((f, i) => {
    const n = all.filter((p) => has(p, c) && (p.finishes || []).includes(f)).length;
    if (n !== SPEC_S4[c][i]) diffs.push(`§4 ${c} x ${f}: got ${n}, spec ${SPEC_S4[c][i]}`);
  });
}
const cell = {};
for (const v of VIBES) {
  const vp = all.filter((p) => fitsVibe(p, v));
  if (vp.length !== SPEC_S5[v][0]) diffs.push(`§5 ${v} pool: got ${vp.length}, spec ${SPEC_S5[v][0]}`);
  CHIPS.forEach((c, i) => {
    const n = vp.filter((p) => has(p, c)).length;
    cell[`${v}|${c}`] = n;
    if (n !== SPEC_S5[v][i + 1]) diffs.push(`§5 ${v} x ${c}: got ${n}, spec ${SPEC_S5[v][i + 1]}`);
  });
}
console.log(`attributes: ${path.relative(process.cwd(), ATTRS)} — ${all.length} products (${all.filter((p) => p.topper).length} toppers, ${all.filter((p) => p.available !== false).length} in stock)`);
console.log(`coverage §3/§4/§5 vs spec: ${diffs.length === 0 ? 'ALL CELLS MATCH (36 + 60 + 104)' : `${diffs.length} DIFFS`}`);
for (const d of diffs) console.log('  ' + d);

// ---- 2. Thin cells ----
const thinNow = Object.entries(cell).filter(([, n]) => n < 3).map(([k]) => k);
const extra = thinNow.filter((k) => !SPEC_THIN.includes(k));
const gone = SPEC_THIN.filter((k) => !thinNow.includes(k));
console.log(`\nthin vibe x chip cells (< 3 products): ${thinNow.length} vs §5.1's ${SPEC_THIN.length} -> ${extra.length || gone.length ? 'DIFFERENT' : 'SAME SET'}`);
for (const k of thinNow) console.log(`  ${k.replace('|', ' x ')}: ${cell[k]}${SPEC_THIN.includes(k) ? '' : '  <- NOT in §5.1'}`);
for (const k of gone) console.log(`  ${k.replace('|', ' x ')}: ${cell[k]}  <- in §5.1 but no longer thin`);

// ---- 3. §7 path enumeration (in-stock) ----
const pool = all.filter((p) => p.available !== false);
function mains(vibe, chips, depths, finishes, pickedFinish) {
  const topperOk = pickedFinish === 'full_sparkle' || vibe === 'full_glam';
  let colors = 0, toppers = 0;
  for (const p of pool) {
    if (chips && !(p.chips || []).some((c) => chips.includes(c))) continue;
    if (!depths.includes(p.depth)) continue;
    if (finishes && !hasFinish(p, finishes)) continue;
    if (p.topper) { if (topperOk) toppers++; continue; }
    colors++;
  }
  return colors + Math.min(toppers, 2);
}

const results = { PASS: 0, THIN: 0, FAIL: 0 };
const nonPassCells = new Map(); // vibe|chip -> { status, paths, pickedChipMains, afterRule7 }
let total = 0;
let ladderPass = 0, ladderUnder4 = 0, ladderMin = Infinity; // v1-test semantics
for (const vibe of VIBES) for (const intensity of INTENSITIES) for (const chip of [...CHIPS, 'surprise_me']) for (const finish of [...FINISHES, 'surprise_me']) {
  total++;
  const prof = VIBE_PROFILE[vibe];
  const chips = chip === 'surprise_me' ? null : [chip];
  const s0 = mains(vibe, chips, prof.depth, finish === 'surprise_me' ? prof.finish : [finish], finish);
  const s1 = mains(vibe, chips, prof.depth, null, finish);
  const wide = chips ? chips.concat(NEIGHBORS[chip] || []) : null;
  const s2 = mains(vibe, wide, prof.depth, null, finish);
  const s3 = mains(vibe, wide, widenDepth(prof.depth), null, finish);
  const best = Math.max(s0, s1, s2, s3);
  if (best >= 6) ladderPass++;
  if (best < 4) ladderUnder4++;
  ladderMin = Math.min(ladderMin, best);
  if (Math.max(s0, s1) >= 6) {
    results.PASS++;
    if (verbose && s0 < 6) console.log(`RELAXED(drop finish) ${vibe}/${intensity}/${chip}/${finish}: ${s0} -> ${s1}`);
    continue;
  }
  const key = `${vibe}|${chip}`;
  const status = SPEC_THIN.includes(key) ? 'THIN' : 'FAIL';
  results[status]++;
  const e = nonPassCells.get(key) || { status, paths: 0, pickedChipMains: Infinity, afterRule7: Infinity };
  e.paths++;
  e.pickedChipMains = Math.min(e.pickedChipMains, s1);
  e.afterRule7 = Math.min(e.afterRule7, Math.max(s2, s3));
  nonPassCells.set(key, e);
}
console.log(`\n§7 paths: ${total} | PASS ${results.PASS} | documented thin (§5.1) ${results.THIN} | FAIL (undocumented) ${results.FAIL}`);
const listCells = (status) => [...nonPassCells.entries()].filter(([, e]) => e.status === status);
for (const status of ['THIN', 'FAIL']) {
  const cells = listCells(status);
  if (!cells.length) continue;
  console.log(`\n${status === 'THIN' ? 'Documented thin cells' : 'UNDOCUMENTED FAILURES'} (vibe x chip; worst case over intensity/finish):`);
  for (const [k, e] of cells) {
    const shape = e.pickedChipMains >= 4 ? '4-5 picked-chip mains = the designed 4+4 shape' : `only ${e.pickedChipMains} picked-chip mains, Rule 7 neighbors fill the rest`;
    console.log(`  ${k.replace('|', ' x ')}: ${shape}; ${e.afterRule7} mains after Rule 7 neighbors/depth (${e.paths} paths)`);
  }
}
const spec51NotHit = SPEC_THIN.filter((k) => !nonPassCells.has(k));
if (spec51NotHit.length) console.log(`\n§5.1 cells that actually PASS once the finish is relaxed (thin in the pool table, fine for the gate): ${spec51NotHit.map((k) => k.replace('|', ' x ')).join(', ')}`);

const failCells = listCells('FAIL');
console.log(`\nRule 7 ladder (v1 acceptance-test semantics: neighbor/depth-relaxed mains count): ${ladderPass}/${total} paths reach >= 6 mains; ${ladderUnder4} under 4; worst path ${ladderMin}`);
const gatePass = results.FAIL === 0;
console.log(`SHIP GATE, literal §7 (>= 6 picked-chip mains, else a §5.1 cell): ${gatePass ? 'PASS' : `FAIL — ${failCells.length} undocumented cells (${failCells.filter(([, e]) => e.pickedChipMains >= 4).length} already 4+4 shape, ${failCells.filter(([, e]) => e.pickedChipMains < 4).length} with 3 mains); all have pool counts >= 3, above §5.1's < 3 thin threshold`}`);
if (!gatePass || diffs.length) process.exit(1);
