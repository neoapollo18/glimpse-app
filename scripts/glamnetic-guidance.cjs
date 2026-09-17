// Shared builder for Glamnetic's ai_guidance blob (Find My Nail Match v1).
// Layer rules encode the Mia handoff §3 (answer mappings), §4 (locked
// relaxation), §5 (result assembly) and §6 (hard rules + soft scoring).
// PRODUCT FACTS are generated from brand-configs/glamnetic-pool.json
// (rebuilt by glamnetic-pool.cjs from synced catalog tags) because the
// ranker serializes candidates by NAME only — and names lie ("Cloud Dance"
// is silver-blue glitter, "Teddy" is greige). Facts come from tags, never
// name inference.
'use strict';
const fs = require('fs');
const path = require('path');

const POOL_PATH = path.join(__dirname, 'brand-configs', 'glamnetic-pool.json');
const MAX_GUIDANCE = 20000; // quiz-config-schema CAPS.maxGuidanceLength

const FAMILY_SHORT = {
  nudes_neutrals: 'nudes', pinks_pastels: 'pinks', reds_berries: 'reds', bold_bright: 'bold',
  dark_moody: 'dark', metallics_shimmer: 'metal', french_white: 'french',
};

const MARQUEE = [
  [/^The Soft Launch/, 'SoftLaunch'], [/^Spells & Sparkles/, 'Spells'], [/^Sparkling Gems/, 'Gems'],
  [/^Routine Refresh/, 'Refresh'], [/^Harry Potter/, 'HP'], [/^Hello Kitty/i, 'HelloKitty'],
  [/^(Fanatics|NCAA|NFL|NHL|MLB|MLS|WNBA)/, 'Fanatics'], [/^Glamzilla/, 'Glamzilla'],
  [/^Glam Icons/, 'GlamIcons'], [/^(Summer Shop|Euro Summer)/, 'Summer'],
];

const LAYER_RULES = `Glamnetic press-on nail quiz (Find My Nail Match). Rank nail sets for the shopper's answers. Apply these rules in order; higher rules win conflicts. Judge ONLY from the PRODUCT FACTS below — never from a product's name.

FACTS LEGEND: each line is "Name: [system] [length] shape(s) | color families | style tier | style tags | collection | BS". Defaults: a set is glue-on and short unless marked otherwise; "qp" = Quick Press (press & go, always extra short); other lengths are spelled out (super_short, medium, long). BS = current bestseller. Shape "natural" is Glamnetic's super-short line: one natural rounded profile — treat it as matching round or oval picks, and as the primary answer whenever the shopper picked super short with glue-on.

HARD RULES — never violate:
1. If the shopper's application answer is press & go: recommend ONLY qp (Quick Press) sets. They come extra short by design — ignore any length picks, and say so in the reason ("Quick Press comes extra short").
2. Otherwise (glue-on classic or adhesive tabs): recommend ONLY glue sets. Tabs is the same catalog — same sets, worn with adhesive tabs instead of glue.
3. length must be one of the shopper's picked lengths (skip this rule for qp per rule 1). Catalog fact: true long sets are nearly nonexistent — a long pick will usually relax to medium; the reason should own it ("closest to the long you wanted").
4. shape must be one of the shopper's picked shapes, unless they said open to anything. "natural" counts as round/oval per the legend.
If fewer than 5 sets satisfy the hard rules, relax in THIS order only, one step at a time: (1) shape to its nearest neighbor (coffin→square→squoval, round→oval→almond, squoval→square→oval, and the reverse directions); (2) length one adjacent step; (3) style tier one step down; (4) drop the least-weighted color family. NEVER relax the system rule. A relaxed pick's reason must read like "Closest to what you picked", never pretend it matched exactly.

SOFT SCORING — rank the hard-rule survivors:
+3 for each picked color family the set matches. +3 for each picked style tier matched. +2 for vibe boosts (below). +1 if BS. "Surprise me" on color, and any skipped question, contribute ZERO — do not treat surprise-me as "every family matches".

VIBE BOOSTS (the vibe answer weights, never filters):
- Model off-duty: nudes families, clean tier, Glazed/Glossy styles, SoftLaunch collection, qp nudes.
- Soft & sweet: pinks, clean or extra tier, Pearl/Ombre/Glazed styles.
- French girl forever: French Tip style, french + nudes + reds families, GlamIcons collection.
- Girls night out: statement tier, reds + dark families, Glitter/Velvet styles.
- Main character energy: statement or art tier, Chrome/Glitter/3D/3D Gems styles, Gems collection.
- Out of Office: bold family, Summer collection.
- After hours: dark family, Velvet or glossy Solid Color, Cat Eye styles.
- Spooky season: Spells collection first, then dark family + art tier.
- Surprise me: no vibe weight — rank by BS then family/tier score.

ASSEMBLY:
- Return the 5 best, best first. Slots 1-3 are the primary matches: at least 2 of them must match a picked color family (the 3rd may be a near-miss only if it clearly wins everything else). Slots 4-5 flex the shopper's LOOSEST dimension (the multi-select where she picked most, or anything she answered surprise-me on).
- Slot 1 should be the set that satisfies every hard rule plus at least one picked color family plus at least one picked tier with NO relaxation; if no set does, just rank the best fit first.
- Each reason (max 140 chars) speaks to the shopper in her own answer words — "Short almond, both your picks", "Dark & moody, exactly", "Quick Press comes extra short". Never a claim the FACTS don't back. If she chose adhesive tabs, it still fits: same sets, tabs just wear up to 3 days with no glue.
- Avoid 3 near-identical sets in the primaries (same family + tier + style) unless her picks leave no room.`;

function factLine(p) {
  const shapes = p.shapes.join('/') || '?';
  const fams = p.families.map((f) => FAMILY_SHORT[f] || f).join('/') || '?';
  const styles = p.styles.slice(0, 2).join(',');
  let coll = '';
  for (const [re, short] of MARQUEE) {
    if (p.collections.some((c) => re.test(c))) { coll = short; break; }
  }
  // Legend defaults: glue-on + short are omitted; qp implies extra short.
  const head = [];
  if (p.system === 'quick_press') head.push('qp');
  else if (p.length !== 'short') head.push(p.length);
  head.push(shapes);
  const bits = [head.join(' '), fams, p.tier];
  if (styles) bits.push(styles);
  if (coll) bits.push(coll);
  if (p.bestseller) bits.push('BS');
  return `- ${p.name}: ${bits.join(' | ')}`;
}

function buildGuidance() {
  const { pool } = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
  const text = [
    LAYER_RULES,
    '',
    `PRODUCT FACTS (${pool.length} sets, from catalog tags):`,
    ...pool.map(factLine),
  ].join('\n');
  if (text.length > MAX_GUIDANCE) {
    throw new Error(`guidance ${text.length} chars exceeds the ${MAX_GUIDANCE} cap — tighten factLine`);
  }
  return text;
}

module.exports = { buildGuidance, POOL_PATH };
if (require.main === module) {
  const g = buildGuidance();
  console.log(g.slice(0, 3000));
  console.log(`\n… total ${g.length} chars (cap ${MAX_GUIDANCE})`);
}
