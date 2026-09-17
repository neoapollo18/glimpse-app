// ORLY Find Your Vibe — acceptance test (spec Section 8, ship gate).
// Enumerates every quiz path: 8 vibes x 3 intensities x (12 chips +
// surprise_me) x (5 finishes + surprise_me) and asserts each path can fill
// >=6 in-stock mains matching the picked chip/finish (after the spec's
// relaxation ladder), or documents the thin cell (4+4 result).
//
// Runs offline against scripts/brand-configs/orly-attributes.json (rewritten
// by onboard-orly-products.cjs on each catalog pull) — pool sufficiency only;
// it does not exercise the LLM ranker. Re-run after every weekly scrape.
//
// USAGE: node scripts/orly-acceptance-test.cjs [--verbose]
'use strict';
const path = require('path');
const verbose = process.argv.includes('--verbose');

const attrs = require(path.join(__dirname, 'brand-configs', 'orly-attributes.json'));

const VIBES = ['model_off_duty', 'soft_sweet', 'timeless', 'girls_night_out', 'full_glam', 'vacation', 'coastal_cool', 'moody'];
const INTENSITIES = ['subtle', 'just_right', 'full_look'];
const CHIPS = ['reds', 'oranges', 'yellows', 'greens', 'blues', 'purples', 'pinks', 'nudes', 'browns', 'whites', 'greys', 'blacks', 'surprise_me'];
const FINISHES = ['creme', 'soft_shimmer', 'full_sparkle', 'chrome_metallic', 'sheer_glossy', 'surprise_me'];

// Rule 7 spectral neighbors.
const NEIGHBORS = {
  reds: ['pinks', 'oranges'], pinks: ['reds', 'purples'], purples: ['pinks', 'blues'],
  oranges: ['reds', 'yellows'], yellows: ['oranges', 'greens'], greens: ['yellows', 'blues'],
  blues: ['greens', 'purples'], nudes: ['browns', 'whites'], browns: ['nudes'],
  whites: ['nudes', 'greys'], greys: ['blacks', 'whites'], blacks: ['greys'],
};

// Picked finish -> catalog Type_* keywords (secondary finishes count).
const FINISH_TYPES = {
  creme: ['creme'],
  soft_shimmer: ['shimmer', 'pearl'],
  full_sparkle: ['glitter', 'holo', 'confetti', 'flakie'],
  chrome_metallic: ['metallic', 'chrome', 'duochrome'],
  sheer_glossy: ['sheer', 'jelly'],
};

const pool = attrs.products.filter((p) => !p.retired && p.available !== false);

function chipMatch(p, chips) {
  // 'multi' products don't satisfy a specific chip pick (guidance: only when
  // the finish also fits — conservatively excluded here).
  return (p.chips || []).some((c) => chips.includes(c));
}
function finishMatch(p, finish) {
  const kws = FINISH_TYPES[finish];
  const types = (p.types || []).map((t) => t.toLowerCase());
  return types.some((t) => kws.some((k) => t.includes(k)));
}

function qualifying(vibe, chip, finish) {
  const topperOk = finish === 'full_sparkle' || vibe === 'full_glam';
  const chips = chip === 'surprise_me' ? null : [chip];

  // Ladder: 0 = strict, 1 = drop finish, 2 = +spectral neighbors.
  for (let stage = 0; stage <= 2; stage++) {
    const wantChips = chips && stage >= 2 ? chips.concat(NEIGHBORS[chip] || []) : chips;
    const useFinish = stage === 0 && finish !== 'surprise_me';
    let colors = 0, toppers = 0;
    for (const p of pool) {
      if (wantChips && !chipMatch(p, wantChips)) continue;
      if (useFinish && !finishMatch(p, finish)) continue;
      if (p.topper) { if (topperOk) toppers++; continue; }
      colors++;
    }
    const n = colors + Math.min(toppers, 2); // Rule 2: max 2 toppers in mains
    if (n >= 6) return { n, stage };
    if (stage === 2) return { n, stage };
  }
}

const failures = [], thin = [];
let pass = 0, total = 0;
const thinCombos = new Map(); // chip|finish -> count (vibe/intensity rarely matter)
for (const vibe of VIBES) for (const intensity of INTENSITIES) for (const chip of CHIPS) for (const finish of FINISHES) {
  total++;
  const { n, stage } = qualifying(vibe, chip, finish);
  const pathStr = `${vibe} / ${intensity} / ${chip} / ${finish}`;
  if (n >= 6) { pass++; if (verbose && stage > 0) console.log(`RELAXED(stage ${stage}) ${pathStr}: ${n}`); }
  else if (n >= 4) {
    thin.push(`${pathStr}: ${n} mains (thin cell -> 4+4)`);
    const k = `${chip} + ${finish}`;
    thinCombos.set(k, (thinCombos.get(k) || 0) + 1);
  } else failures.push(`${pathStr}: only ${n} mains after relaxation`);
}

console.log(`pool: ${pool.length} in-stock active (${pool.filter((p) => p.topper).length} toppers) of ${attrs.products.length} total`);
console.log(`paths: ${total}, pass: ${pass}, thin (4-5 mains): ${thin.length}, FAIL (<4): ${failures.length}`);
if (thinCombos.size) {
  console.log('\nThin cells (documented 4+4 result), by chip+finish:');
  for (const [k, v] of thinCombos) console.log(`  ${k} (${v} paths)`);
}
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures.slice(0, 40)) console.log('  ' + f);
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log('\nSHIP GATE: ' + (failures.length === 0 ? 'PASS (no path below 4 mains)' : 'FAIL'));
