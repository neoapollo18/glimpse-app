// Shared builder for ORLY's ai_guidance blob (quiz LLM ranking prompt).
// Layer rules come from the Charlie handoff v1; the PRODUCT FACTS section is
// generated from scripts/brand-configs/orly-attributes.json, which
// onboard-orly-products.cjs rewrites from the live public catalog on each
// run (the handoff's weekly re-pull).
'use strict';
const fs = require('fs');
const path = require('path');

const ATTRIBUTES_PATH = path.join(__dirname, 'brand-configs', 'orly-attributes.json');

const LAYER_RULES = `ORLY nail color quiz (Find Your Vibe). Rank products for the shopper's answers. Apply these rules in order; higher rules win conflicts.

RESULT SHAPE: the ranked list is 6 MAINS followed by 2 WILDCARDS. Mains must satisfy the shopper's picks (rule below). Wildcards are the highest-fit products that FAIL the color picks but strongly fit the vibe + intensity — they go only in the last 2 slots, never mixed into the mains. Never pad mains with products that violate the shopper's picks: if fewer than 6 products qualify even after relaxation, put the 4 best qualifying mains first and let wildcards grow to 4.

TOPPERS: products marked "topper" are sheer glitter films worn over color or bare nails. Toppers NEVER take main slots, with one exception: when the shopper picked Full Sparkle or the vibe is Full Glam, up to 2 toppers may appear in mains. On every other path at most 1 topper total may appear, in the final slot only, chosen to complement (pair with) the mains.

SHOPPER PICKS ARE HARD PREFERENCES (strongest signal):
- Colors picked: every main must match at least one picked color chip (a product matches if ANY of its chips is picked). Multi/rainbow shades count as matching only when their finish also fits the picks.
- Finishes picked: every main must match a picked finish; a secondary finish counts. Finish map: Classic Creme = creme; Soft Shimmer = shimmer or pearl; Full Sparkle = glitter, holographic, confetti or flakies; Chrome & Metallic = metallic or duochrome; Sheer & Glossy = jelly or sheer.
- Surprise Me / No Preference answers add no constraint; break ties by bestseller rank.

VIBE PROFILES (rank within the products that pass the shopper's picks; chips > finish > depth):
- Model Off-Duty: chips nudes, whites, pinks; creme or sheer/jelly finish; light depth; sheer or buildable coverage.
- Soft & Sweet: chips pinks, purples, blues, yellows, whites; creme or soft shimmer; light depth.
- Timeless: chips reds, pinks, nudes, whites; creme; mid depth; full coverage.
- Girls' Night Out: chips reds, purples, blacks; creme, shimmer or metallic; mid or deep depth; full coverage.
- Full Glam: finish leads, color follows the picks or bestseller rank: glitter, holographic, confetti, flakies, chrome, metallic; any depth.
- Vacation: chips oranges, pinks, yellows, reds; creme or shimmer; mid depth; tropical brights and neons welcome.
- Coastal Cool: chips blues, greens, whites, greys; creme first, then any finish; any depth.
- Moody: chips blacks, greys, browns, purples, reds, blues, greens; creme or metallic; deep depth; full coverage.

INTENSITY (applied on top of the vibe profile):
- Subtle: prefer light depth and creme, sheer/jelly or soft shimmer finishes; strongly deprioritize full sparkle, chunky glitter and neons. Subtle + Full Glam resolves to fine shimmer or micro-glitter, never chunky glitter.
- Just right: apply the vibe profile as-is.
- The full look: prefer mid/deep depth and bolder shades; full sparkle, neons and deep colors may outrank.

ASSEMBLY: slots 1-2 go to the two best-selling qualifying products (merchantPriority products are the current bestsellers, in order). Slots 3-6: vary your selection among the next dozen or so qualifying products so repeat runs do not return an identical grid. Never force a poorly matching bestseller over a clearly better match.

RELAXATION (only when fewer than 6 mains qualify), in this order: (1) drop the finish preference; (2) widen the picked chips to spectral neighbors: reds<->pinks<->purples, oranges<->reds, oranges<->yellows, yellows<->greens, greens<->blues, blues<->purples, nudes<->browns, nudes<->whites, greys<->blacks, greys<->whites; (3) allow depth one step off; (4) retired products as a true last resort, only when fewer than 4 mains exist after all other relaxation.`;

// Pool v2 (spec "ORLY Recommendation Backfill v2"): entries carry the spec's
// quiz-vocabulary attributes directly — chips, finish buckets, computed
// depth, hex — written by orly-pool-v2.cjs to orly-attributes-v2.json.
const FINISH_LABEL = {
  creme: 'classic creme', soft_shimmer: 'soft shimmer', full_sparkle: 'full sparkle',
  chrome_metallic: 'chrome/metallic', sheer_glossy: 'sheer/glossy',
};
function factLineV2(p) {
  const bits = [];
  // Chipless = no single-hue color metafield (spec §2.5 multi/neon/pastel
  // only). Don't assert "multi-color": some are plain shades (Reddy or Not).
  bits.push(p.chips && p.chips.length ? `chips ${p.chips.join('/')}` : 'no color chip (matches a color pick only via Surprise Me; match on finish)');
  bits.push(`finish ${(p.finishes || []).map((f) => FINISH_LABEL[f] || f).join(' + ')}`);
  bits.push(`${p.depth} depth`);
  bits.push(p.formula);
  if (p.topper) bits.push('glitter topper, wears over other color or bare nails');
  return `- ${p.name}: ${bits.join(', ')}`;
}

function factLine(p) {
  if (p.schema === 'v2') return factLineV2(p);
  const colors = (p.colors || []).join('/').toLowerCase() || 'color unknown';
  const types = (p.types || []).map((t) => t.toLowerCase());
  const finish = types.length ? types.join(' ') : 'finish unknown';
  const bits = [`${colors} ${finish}`];
  if (p.chips && p.chips.length) bits.push(`chips ${p.chips.join('/')}`);
  if (p.depth) bits.push(`${p.depth} depth`);
  bits.push(p.formula);
  if (p.topper) bits.push('glitter topper, wears over other color or bare nails');
  return `- ${p.name}: ${bits.join(', ')}`;
}

// buildGuidance()                       -> v1 behavior, reads orly-attributes.json
// buildGuidance({ attributesPath })     -> reads another attributes file
// buildGuidance({ products })           -> explicit product list (v1 and/or
//                                          v2 entries; orly-pool-v2.cjs passes
//                                          the resulting pool)
// Never writes anything; pushing the result is the caller's (flagged) job.
function buildGuidance(opts = {}) {
  const products = opts.products
    || JSON.parse(fs.readFileSync(opts.attributesPath || ATTRIBUTES_PATH, 'utf8')).products;
  const active = products.filter((p) => !p.retired);
  const retired = products.filter((p) => p.retired);
  const hasV2 = active.some((p) => p.schema === 'v2');
  const lines = [
    LAYER_RULES,
    '',
    hasV2
      ? 'PRODUCT FACTS (from ORLY Shopify metafields; chips and finish use the quiz answer vocabulary; depth is computed from the shade hex; formula Lacquer = classic polish, Breathable = breathable treatment + color, GELFX = gel polish; judge from these, not from name alone):'
      : 'PRODUCT FACTS (from the ORLY catalog; formula Lacquer = classic polish, Breathable = breathable treatment + color; judge from these, not from name alone):',
    ...active.map(factLine),
  ];
  if (retired.length > 0) {
    lines.push(
      `- ${retired.map((p) => `${p.name} (${(p.colors || []).join('/').toLowerCase()})`).join(', ')}: retired from the current catalog; strongly deprioritize, recommend only when nothing else fits the shopper's picks.`,
    );
  }
  return lines.join('\n');
}

module.exports = { buildGuidance, ATTRIBUTES_PATH };
