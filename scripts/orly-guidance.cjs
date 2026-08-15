// Shared builder for ORLY's ai_guidance blob (quiz LLM ranking prompt).
// Layer rules come from the Charlie handoff v1; the PRODUCT FACTS section is
// generated from scripts/brand-configs/orly-attributes.json, which
// onboard-orly-products.cjs rewrites from the live public catalog on each
// run (the handoff's weekly re-pull).
'use strict';
const fs = require('fs');
const path = require('path');

const ATTRIBUTES_PATH = path.join(__dirname, 'brand-configs', 'orly-attributes.json');

const LAYER_RULES = `ORLY nail color quiz. Priority when rules conflict: the shopper's explicit color/finish picks first, then hero bestsellers, then vibe fit.

VIBE PROFILES (prefer products whose color/finish/coverage match):
- Model Off-Duty: nudes, whites, clear, soft pinks; creme, jelly or pearl finish; sheer or buildable coverage.
- Soft & Sweet: pinks, mauves, pastels, whites, light blues, light yellows; creme, pearl or shimmer.
- Timeless: classic reds, pinks, nudes, whites; creme; full coverage.
- Girls' Night Out: reds, purples, blacks, mauves; creme, shimmer or metallic; full coverage.
- Full Glam: finish leads, color follows: glitter, holographic, confetti, flakies, chrome.
- Vacation: corals, oranges, neons, yellows, bright pinks; creme or shimmer.
- Coastal Cool: blues, greens, teals, whites.
- Moody: blacks, greys, browns, deep reds, deep purples, deep greens, deep blues; full coverage.

INTENSITY:
- Subtle: prefer sheer/buildable coverage and creme, pearl or jelly finishes; avoid glitter, holographic, neon and chunky sparkle. Subtle + Full Glam resolves to fine shimmer or micro-glitter, never chunky glitter.
- Just right: apply the vibe profile as-is.
- The full look: prefer full coverage; glitter, metallic, neon and deeper shades may outrank.

COLOR AND FINISH PICKS ARE HARD PREFERENCES: when the shopper picked colors, every top pick must belong to one of their picked color families. Family expansions: Oranges also covers corals and warm neons; Blues and Greens also cover teals; Pinks also covers corals and mauves; Purples also covers mauves; Yellows also covers golds; Whites also covers clear/sheer whites. Picked finishes map: Classic Creme = creme; Soft Shimmer = shimmer or pearl; Full Sparkle = glitter, holographic, confetti or flakies; Chrome & Metallic = metallic or duochrome; Sheer & Glossy = jelly or sheer. "Open to anything" answers add no constraint. A product that fails the shopper's color picks but nails the vibe may appear only in the last 1-2 slots, never the top ones.

HEROES: merchantPriority products are current bestsellers. When one genuinely fits the vibe and the shopper's picks, place the best 1-2 of them in the top slots. Never force a poorly matching hero over a clearly better match, and never fill more than 2 top slots with heroes.`;

function factLine(p) {
  const colors = (p.colors || []).join('/').toLowerCase() || 'color unknown';
  const types = (p.types || []).map((t) => t.toLowerCase());
  const finish = types.length ? types.join(' ') : 'finish unknown';
  const bits = [`${colors} ${finish}`, p.formula];
  if (p.topper) bits.push('glitter topper, wears over other color or bare nails');
  return `- ${p.name}: ${bits.join(', ')}`;
}

function buildGuidance() {
  const attrs = JSON.parse(fs.readFileSync(ATTRIBUTES_PATH, 'utf8'));
  const active = attrs.products.filter((p) => !p.retired);
  const retired = attrs.products.filter((p) => p.retired);
  const lines = [
    LAYER_RULES,
    '',
    'PRODUCT FACTS (from the ORLY catalog; formula Lacquer = classic polish, Breathable = breathable treatment + color; judge from these, not from name alone):',
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
