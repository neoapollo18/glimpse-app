// Columnar matching pipeline (Glamnetic recommendation logic v3, brief
// sections 4-6, fix spec v4). Pure functions of (answers, pool): Step A
// hard filters, the vibe / drama tiers, Step C soft scoring, Step E "also
// matched", the branching blocks and the resultKey permalink encoding. The
// server module (engine.server.ts) adds I/O: the pool load, stock, the
// Step D ranker and caching.
//
// Length, shape, finish and color are never relaxed (v4 made color hard).
// Vibe and drama rank the sets that pass, in tiers; the ranker only
// reorders inside a tier. Branching hides any option that can't leave at
// least spec.fullMatchMin sets matching every answer.

import type { DerivedProduct } from "./attributes";
import { claimableVibes, vibeMatches } from "./attributes";
import {
  COLUMNAR_DEFAULTS,
  COLUMNAR_ROLES,
  DEFAULT_ANSWER_LABELS,
  ROLE_VOCAB,
  axisForRole,
  vibeEnabled,
  type ColumnarRole,
  type ColumnarSpec,
} from "./spec";

/** The widget's "Open to anything" marker (supabase.server ANY_VALUE). */
export const ANY_VALUE = "_any";

/** Specific answer IDs (vocabulary order), or "surprise" = no filter and no
 * score term. A role absent from the object was skipped / not asked, which
 * matches the same way. */
export type RoleAnswer = string[] | "surprise";
export type ColumnarAnswers = Partial<Record<ColumnarRole, RoleAnswer>>;

const specific = (a: RoleAnswer | undefined): string[] | null =>
  Array.isArray(a) && a.length > 0 ? a : null;

const vocabSort = (role: ColumnarRole, ids: Iterable<string>): string[] => {
  const vocab = ROLE_VOCAB[role];
  return [...new Set(ids)].filter((id) => vocab.includes(id)).sort((a, b) => vocab.indexOf(a) - vocab.indexOf(b));
};

/**
 * Canonical answers from the criteria the widget posts (DB axis keys and
 * values). Select-all arrives as ANY_VALUE and means surprise for that axis;
 * values the spec doesn't map (a stale option, a non-select-all "Surprise
 * me!" option) are ignored, so an axis with nothing mapped stays open.
 */
export function criteriaToAnswers(
  criteria: Record<string, string | string[]>,
  spec: Pick<ColumnarSpec, "axes">,
): ColumnarAnswers {
  const collected: Partial<Record<ColumnarRole, Set<string> | "surprise">> = {};
  for (const [axisKey, raw] of Object.entries(criteria)) {
    const axis = spec.axes[axisKey];
    if (!axis) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.includes(ANY_VALUE)) {
      collected[axis.role] = "surprise";
      continue;
    }
    if (collected[axis.role] === "surprise") continue;
    const set = (collected[axis.role] as Set<string> | undefined) ?? new Set<string>();
    for (const v of values) {
      const id = Object.prototype.hasOwnProperty.call(axis.values, v) ? axis.values[v] : undefined;
      if (id) set.add(id);
    }
    if (set.size > 0) collected[axis.role] = set;
  }
  const out: ColumnarAnswers = {};
  for (const role of COLUMNAR_ROLES) {
    const c = collected[role];
    if (c === "surprise") out[role] = "surprise";
    else if (c && c.size > 0) {
      let ids = vocabSort(role, c);
      // The vibe question is single-select; a forged multi-vibe post keeps
      // one, deterministically.
      if (role === "vibe") ids = ids.slice(0, 1);
      if (ids.length) out[role] = ids;
    }
  }
  return out;
}

/** Answers back in the quiz's own terms (axis key -> axis values), so a
 * permalink can restore the shopper's picks. */
export function answersToCriteria(
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "axes">,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const role of COLUMNAR_ROLES) {
    const a = answers[role];
    if (!a) continue;
    const axisKey = axisForRole(spec, role);
    if (!axisKey) continue;
    if (a === "surprise") {
      out[axisKey] = [ANY_VALUE];
      continue;
    }
    const values: string[] = [];
    for (const id of a) {
      const axisValue = Object.keys(spec.axes[axisKey].values).find((v) => spec.axes[axisKey].values[v] === id);
      if (axisValue && !values.includes(axisValue)) values.push(axisValue);
    }
    if (values.length) out[axisKey] = values;
  }
  return out;
}

// ---- resultKey: "c1" + one token per role (vibe, length, shape, color,
// finish, drama). x = not answered, s = surprise, else a hex bitmask
// over the role's vocabulary. URL-safe and self-contained.

const KEY_PREFIX = "c1";
const KEY_RE = /^c1(\.(?:x|s|[0-9a-f]{1,4})){6}$/;

export function encodeResultKey(answers: ColumnarAnswers): string {
  const parts = COLUMNAR_ROLES.map((role) => {
    const a = answers[role];
    if (!a) return "x";
    if (a === "surprise") return "s";
    let mask = 0;
    for (const id of a) {
      const i = ROLE_VOCAB[role].indexOf(id);
      if (i >= 0) mask |= 1 << i;
    }
    return mask ? mask.toString(16) : "x";
  });
  return [KEY_PREFIX, ...parts].join(".");
}

export function decodeResultKey(key: unknown): ColumnarAnswers | null {
  if (typeof key !== "string" || key.length > 64 || !KEY_RE.test(key)) return null;
  const tokens = key.split(".").slice(1);
  const out: ColumnarAnswers = {};
  for (let r = 0; r < COLUMNAR_ROLES.length; r++) {
    const role = COLUMNAR_ROLES[r];
    const t = tokens[r];
    if (t === "x") continue;
    if (t === "s") {
      out[role] = "surprise";
      continue;
    }
    const mask = parseInt(t, 16);
    const vocab = ROLE_VOCAB[role];
    if (!Number.isFinite(mask) || mask <= 0 || mask >= 1 << vocab.length) return null;
    const ids = vocab.filter((_, i) => mask & (1 << i));
    if (role === "vibe" && ids.length !== 1) return null;
    out[role] = ids;
  }
  return out;
}

// ---- Steps A-C ----

/** The vibe that shapes this request: null for surprise, unanswered, or a
 * tile the merchant has retired (a stale page can still post it). */
export function activeVibe(answers: ColumnarAnswers, spec: Pick<ColumnarSpec, "vibes">): string | null {
  const v = specific(answers.vibe)?.[0] ?? null;
  return v && vibeEnabled(spec, v) ? v : null;
}

/** A super short set has no shape (Glamnetic tags its shape "Super Short"),
 * so a shape pick never applies to it. It still needs Super Short among
 * the lengths to get past the length filter. */
export const shapeless = (p: Pick<DerivedProduct, "length" | "shape">): boolean =>
  p.shape === "super_short" && p.length === "super_short";

/** Step A: length, shape, finish and color (at least one picked family).
 * Never relaxed. */
export function passesHardFilters(p: DerivedProduct, answers: ColumnarAnswers): boolean {
  const lengths = specific(answers.length);
  if (lengths && !(p.length && lengths.includes(p.length))) return false;
  const shapes = specific(answers.shape);
  if (shapes && !shapeless(p) && !(p.shape && shapes.includes(p.shape))) return false;
  const finishes = specific(answers.finish);
  if (finishes && !(p.finish && finishes.includes(p.finish))) return false;
  const colors = specific(answers.color);
  if (colors && !p.colors.some((c) => colors.includes(c))) return false;
  return true;
}

/** Vibes that gate instead of rank: Lisa's "French tips & ombres only". */
export const GATE_VIBES: readonly string[] = ["french_girl"];

/** Does the set fit the shopper's vibe and drama picks? A surprise or
 * skipped question always fits. */
export function softMatch(
  p: DerivedProduct,
  answers: ColumnarAnswers,
  vibe: string | null,
): { vibe: boolean; drama: boolean } {
  const dramas = specific(answers.drama);
  return {
    vibe: !vibe || vibeMatches(p, vibe),
    drama: !dramas || p.drama.some((d) => dramas.includes(d)),
  };
}

export type Tier = 1 | 2 | 3 | 4;

/**
 * Tier inside the hard-filtered set: 1 = vibe and drama both fit, 2 = drama
 * only, 3 = vibe only, 4 = neither. Drama outranks vibe: it is the look the
 * shopper asked for in so many words (solid vs full nail art), it shows on
 * the card, and it comes straight from tags, where a vibe is a softer read.
 * A gate vibe swaps the two, since Lisa made French Girl Chic "French tips
 * and ombres only".
 */
export function tierOf(p: DerivedProduct, answers: ColumnarAnswers, vibe: string | null): Tier {
  const m = softMatch(p, answers, vibe);
  if (m.vibe && m.drama) return 1;
  const gate = vibe !== null && GATE_VIBES.includes(vibe);
  if (gate ? m.vibe : m.drama) return 2;
  if (gate ? m.drama : m.vibe) return 3;
  return 4;
}

/** Share of the product's values the shopper picked (a nude-only set beats
 * a four-color art set for a "Nudes" pick). */
const overlap = (have: string[], picked: string[] | null): number => {
  if (!picked || have.length === 0) return 0;
  let n = 0;
  for (const h of have) if (picked.includes(h)) n++;
  return n / have.length;
};

export type Rung = 1 | 2 | 3 | 4 | 5;

export function scoreProduct(
  p: DerivedProduct,
  answers: ColumnarAnswers,
  vibe: string | null,
  w: { color: number; drama: number; vibe: number },
): number {
  let s = 0;
  s += w.color * overlap(p.colors, specific(answers.color));
  s += w.drama * overlap(p.drama, specific(answers.drama));
  if (vibe && vibeMatches(p, vibe)) s += w.vibe;
  return s;
}

const colorwayKey = (p: DerivedProduct) => p.colors.join("+");

/**
 * Step C order: ladder tier (when given), score, then best-seller, then
 * recency (newest first), then handle for determinism. Equal runs are
 * interleaved by colorway so a surprise-me grid doesn't stack six identical
 * colorways.
 */
export function stepCOrder(
  products: DerivedProduct[],
  answers: ColumnarAnswers,
  vibe: string | null,
  w: { color: number; drama: number; vibe: number },
  tierOf: (p: DerivedProduct) => number = () => 0,
): Array<{ product: DerivedProduct; score: number }> {
  const scored = products.map((product) => ({
    product,
    score: scoreProduct(product, answers, vibe, w),
    tier: tierOf(product),
  }));
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.score - a.score ||
      Number(b.product.bestseller) - Number(a.product.bestseller) ||
      b.product.recency - a.product.recency ||
      a.product.handle.localeCompare(b.product.handle),
  );
  const same = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    a.tier === b.tier && Math.abs(a.score - b.score) < 1e-9;
  const out: typeof scored = [];
  for (let i = 0; i < scored.length; ) {
    let j = i;
    while (j < scored.length && same(scored[j], scored[i])) j++;
    // Round-robin over colorways inside the tie, keeping each colorway's
    // own order.
    const buckets = new Map<string, typeof scored>();
    for (const s of scored.slice(i, j)) {
      const k = colorwayKey(s.product);
      const b = buckets.get(k);
      if (b) b.push(s);
      else buckets.set(k, [s]);
    }
    const queues = [...buckets.values()];
    for (let round = 0; out.length < j; round++) {
      for (const q of queues) if (q[round]) out.push(q[round]);
    }
    i = j;
  }
  return out.map(({ product, score }) => ({ product, score }));
}

export interface LadderResult {
  /** 1 = every shown set matches every answer; 2 = some step outside the
   * drama picks; 4 = some step outside the vibe (and maybe drama); 5 =
   * fewer than resultCount sets pass the hard filters. 3 (color relaxed)
   * is retired: color is a hard filter since fix spec v4. */
  rung: Rung;
  /** Sets matching every answer (hard filters, vibe and drama). */
  exactCount: number;
  /** Sets passing the hard filters (length, shape, finish, color). */
  hardCount: number;
  /** The hard-filtered set in tier, then Step C order. The ranker's
   * candidates and the Also matched row both come from here. */
  ordered: DerivedProduct[];
  /** Tier of every set in `ordered`, by id. */
  tiers: Map<string, Tier>;
  /** What the shown sets step outside of (for the header). */
  outside: { vibe: boolean; drama: boolean };
  /** Which answer one tap loosens when nothing matches. */
  loosen: "finish" | "shape" | "color" | null;
}

/**
 * Fix spec v4 (replaces the brief's section 5 ladder): every set shown
 * passes the hard filters; vibe and drama order them in tiers (tierOf),
 * Step C's score orders each tier. The French Girl Chic gate holds while
 * at least resultCount French or ombre sets pass, as rung 4 used to; below
 * that, the other sets fill in after them.
 */
export function runLadder(
  pool: DerivedProduct[],
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "weights" | "vibes" | "resultCount">,
): LadderResult {
  const vibe = activeVibe(answers, spec);
  const hard = pool.filter((p) => passesHardFilters(p, answers));
  const need = spec.resultCount;
  const gated = vibe && GATE_VIBES.includes(vibe) ? hard.filter((p) => vibeMatches(p, vibe)) : hard;
  const set = gated.length >= need ? gated : hard;
  const tiers = new Map<string, Tier>(set.map((p) => [p.id, tierOf(p, answers, vibe)]));
  const ordered = stepCOrder(set, answers, vibe, spec.weights, (p) => tiers.get(p.id)!).map((s) => s.product);

  // The ranker can only reorder inside a tier, so the top of this order
  // already says what the grid steps outside of.
  const top = ordered.slice(0, need);
  const outside = { vibe: false, drama: false };
  for (const p of top) {
    const m = softMatch(p, answers, vibe);
    if (!m.vibe) outside.vibe = true;
    if (!m.drama) outside.drama = true;
  }
  const rung: Rung = top.length < need ? 5 : outside.vibe ? 4 : outside.drama ? 2 : 1;

  let loosen: LadderResult["loosen"] = null;
  if (ordered.length === 0) {
    const without = (role: "finish" | "shape" | "color") => {
      const a = { ...answers };
      delete a[role];
      return pool.some((p) => passesHardFilters(p, a));
    };
    const candidates = (["finish", "shape", "color"] as const).filter((r) => specific(answers[r]));
    loosen = candidates.find((r) => without(r)) ?? candidates[0] ?? null;
  }

  let exactCount = 0;
  for (const t of tiers.values()) if (t === 1) exactCount++;
  return { rung, exactCount, hardCount: hard.length, ordered, tiers, outside, loosen };
}

const tierIn = (ladder: Pick<LadderResult, "tiers">, p: DerivedProduct): Tier => ladder.tiers.get(p.id) ?? 4;

/**
 * The Step D candidate set: every set of a tier the grid can reach (up to
 * the tier of the last grid slot), capped at candidateCount. The ranker
 * never sees a set it could only place above a closer one.
 */
export function rankerCandidates(
  ladder: Pick<LadderResult, "ordered" | "tiers">,
  spec: Pick<ColumnarSpec, "candidateCount" | "resultCount">,
): DerivedProduct[] {
  const n = Math.min(spec.resultCount, ladder.ordered.length);
  if (n === 0) return [];
  const boundary = tierIn(ladder, ladder.ordered[n - 1]);
  return ladder.ordered.filter((p) => tierIn(ladder, p) <= boundary).slice(0, Math.max(spec.candidateCount, n));
}

/**
 * Step D's picks (or the Step C fallback) plus Step E. A valid ranking is
 * exactly n distinct candidates; it then decides the order inside each
 * tier and which sets of the last tier fill the grid, but never the tiers:
 * a closer set it left out is put back ahead of the farther ones.
 */
export function selectResults(
  ladder: Pick<LadderResult, "ordered" | "tiers">,
  spec: Pick<ColumnarSpec, "resultCount" | "alsoMatchedCount" | "candidateCount">,
  rankedIds?: string[] | null,
): { results: DerivedProduct[]; alsoMatched: DerivedProduct[]; usedRanker: boolean } {
  const candidates = rankerCandidates(ladder, spec);
  const n = Math.min(spec.resultCount, ladder.ordered.length);
  const byId = new Map(candidates.map((p) => [p.id, p]));
  let results = ladder.ordered.slice(0, n);
  let usedRanker = false;
  if (n > 0 && rankedIds && rankedIds.length === n && rankedIds.every((id) => byId.has(id)) && new Set(rankedIds).size === n) {
    const picked = rankedIds.map((id) => byId.get(id)!);
    const boundary = tierIn(ladder, ladder.ordered[n - 1]);
    const out: DerivedProduct[] = [];
    for (let t = 1; t <= boundary; t++) {
      const mine = picked.filter((p) => tierIn(ladder, p) === t);
      if (t < boundary) {
        out.push(...mine, ...candidates.filter((p) => tierIn(ladder, p) === t && !mine.includes(p)));
      } else {
        out.push(...mine.slice(0, n - out.length));
      }
    }
    // n distinct candidates always refill the grid; anything else is Step C.
    if (out.length === n) {
      results = out;
      usedRanker = true;
    }
  }
  const shown = new Set(results.map((p) => p.id));
  const alsoMatched = ladder.ordered.filter((p) => !shown.has(p.id)).slice(0, spec.alsoMatchedCount);
  return { results, alsoMatched, usedRanker };
}

// ---- Copy (brief section 5 "Copy rules on the results page") ----

export type AnswerLabels = Record<string, string>;
const label = (labels: AnswerLabels, id: string) => labels[id] ?? DEFAULT_ANSWER_LABELS[id] ?? id;
const lower = (s: string) => s.toLowerCase();

/** "short or medium almond or oval" for the header. */
function pathPhrase(answers: ColumnarAnswers, labels: AnswerLabels): string {
  const lengths = specific(answers.length)?.map((id) => lower(label(labels, id))) ?? [];
  const shapes = (specific(answers.shape) ?? [])
    .filter((id) => id !== "super_short")
    .map((id) => lower(label(labels, id)));
  return [lengths.join(" or "), shapes.join(" or ")].filter(Boolean).join(" ");
}

export interface HeaderCopy {
  kind: "normal" | "relaxed" | "fewer" | "none";
  text: string | null;
}

export function headerFor(
  ladder: Pick<LadderResult, "rung" | "outside">,
  answers: ColumnarAnswers,
  labels: AnswerLabels,
  shown: number,
): HeaderCopy {
  if (shown === 0) return { kind: "none", text: "We don't have that combination yet." };
  // Only vibe and drama ever step outside the picks; never length, shape,
  // finish or color.
  const outside = [ladder.outside.vibe ? "vibe" : null, ladder.outside.drama ? "style" : null]
    .filter(Boolean)
    .join(" and ");
  if (ladder.rung === 5 && !outside) {
    return {
      kind: "fewer",
      text: `${shown} ${shown === 1 ? "set matches" : "sets match"} exactly. Change an answer above to see more.`,
    };
  }
  if (!outside) return { kind: "normal", text: null };
  const path = pathPhrase(answers, labels);
  return {
    kind: ladder.rung === 5 ? "fewer" : "relaxed",
    text: `Here's what we have${path ? ` in ${path}` : ""}. A few step outside your ${outside} picks.`,
  };
}

/** Shopper-facing length / shape / finish for the card meta line. A super
 * short set has no shape of its own, so its shape is "". */
export function metaFor(p: DerivedProduct): { length: string; shape: string; finish: string } {
  return {
    length: p.length ? DEFAULT_ANSWER_LABELS[p.length] ?? p.length : "",
    shape: p.shape && p.shape !== "super_short" ? DEFAULT_ANSWER_LABELS[p.shape] ?? p.shape : "",
    finish: p.finishLabel ?? (p.finish ? DEFAULT_ANSWER_LABELS[p.finish] ?? p.finish : ""),
  };
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const MAX_REASON_WORDS = 14;

/** "glossy short almond" / "velvet super short": only what the set is. */
function fitPhrase(p: DerivedProduct): string {
  const m = metaFor(p);
  return [m.finish, m.length, m.shape].filter(Boolean).map(lower).join(" ");
}

/**
 * Templated why-line (the ranker's fallback and the "Also matched" row):
 * the set's exact finish, length and shape, plus the strongest answer it
 * echoes back in the shopper's own words. Names only attributes the set
 * has, a vibe only where Lisa approved it (or the French tip / ombre tags
 * say so), and never hedges on length, shape or finish.
 */
export function whyLine(
  p: DerivedProduct,
  answers: ColumnarAnswers,
  labels: AnswerLabels,
  vibe: string | null,
): string {
  const fit = fitPhrase(p);
  const colorHit = specific(answers.color)?.find((c) => p.colors.includes(c));
  const dramaHit = specific(answers.drama)?.find((d) => p.drama.includes(d));
  const color = colorHit ? lower(label(labels, colorHit)) : null;
  const drama = dramaHit ? lower(label(labels, dramaHit)) : null;
  const claimVibe = vibe && claimableVibes(p).includes(vibe) ? vibe : null;
  const lines: string[] = [];
  if (claimVibe === "french_girl") {
    lines.push(`${p.isFrench ? "French tips" : "Soft ombre"}, ${fit}, made for ${label(labels, claimVibe)}.`);
  }
  if (color && drama) lines.push(`${fit} in ${color}, ${drama} as asked.`);
  if (color) lines.push(`${fit} in the ${color} you picked.`);
  if (drama) lines.push(`${fit}, ${drama} like you asked.`);
  if (claimVibe) lines.push(`${fit}, made for ${label(labels, claimVibe)}.`);
  // Only answers the shopper actually gave: a surprise or skipped question
  // was never "chosen", and a super short set has no shape to match.
  const chosen = (["length", "shape", "finish"] as const).filter((role) => {
    const have = p[role];
    if (!have || (role === "shape" && have === "super_short")) return false;
    return Boolean(specific(answers[role])?.includes(have));
  });
  if (chosen.length) {
    const list = chosen.length === 1 ? chosen[0] : `${chosen.slice(0, -1).join(", ")} and ${chosen[chosen.length - 1]}`;
    lines.push(`${fit}: exactly the ${list} you chose.`);
  }
  lines.push(`${fit}.`);
  const first = lines.find((l) => wordCount(l) <= MAX_REASON_WORDS) ?? lines[lines.length - 1];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// Words a ranker reason may only use when the set actually has them.
// Longest phrase first: "super short" is consumed before "short" is checked.
const LENGTH_WORDS: Array<[string, string]> = [
  ["\\bsuper[\\s-]?short\\b", "super_short"],
  ["\\bextra[\\s-]?short\\b", "super_short"],
  ["\\bextra[\\s-]?long\\b", "long"],
  ["\\bshort\\b", "short"],
  ["\\bmedium\\b", "medium"],
  // "long-lasting" / "long-wear" talk about wear, not length.
  ["\\blong\\b(?!-)", "long"],
];
const SHAPE_WORDS: Record<string, RegExp> = {
  almond: /\balmond\b/i,
  coffin: /\b(coffin|ballerina)\b/i,
  oval: /\boval\b/i,
  round: /\bround\b/i,
  squoval: /\bsquoval\b/i,
  square: /\bsquare\b/i,
};
const FINISH_WORDS: Record<string, RegExp> = {
  glossy: /\bgloss(y)?\b/i,
  glazed_pearl: /\bglaz(e|ed)\b|\bpearl(escent)?\b/i,
  velvet_cateye: /\bvelvet\b|\bcat[\s-]?eye\b|\bmagnetic\b/i,
  chrome: /\bchrome\b/i,
  matte: /\bmatte\b/i,
};
const COLOR_WORDS: Record<string, RegExp> = {
  nudes: /\bnudes?\b|\bneutrals?\b|\bbeige\b|\bbrown\b|\bmocha\b/i,
  pinks_purples: /\bpinks?\b|\bpurples?\b|\blilac\b|\blavender\b|\bmauve\b/i,
  reds_berries: /\breds?\b|\bberry\b|\bberries\b|\bburgundy\b|\bcherry\b|\bmaroon\b/i,
  bold_bright: /\bblues?\b|\bgreens?\b|\bneon\b|\bteal\b/i,
  dark_moody: /\bblack\b|\bgr[ae]y\b|\bdark\b|\bmoody\b/i,
  metallics: /\bgold\b|\bsilver\b|\bbronze\b|\bcopper\b|\bmetallics?\b/i,
  oranges_yellows: /\boranges?\b|\byellows?\b|\bcoral\b|\bpeach\b/i,
  white: /\bwhite\b|\bmilky\b|\bivory\b/i,
};
// The drama answers in the shopper's words ("A little extra" is a claim:
// the Berry Baby bug). Checked after length phrases ("extra short") are
// consumed.
const DRAMA_WORDS: Record<string, RegExp> = {
  clean_classic: /\bclean\b(?![\s-]girl)|\bclassic\b/i,
  little_extra: /\bextra\b/i,
  statement: /\bstatement\b/i,
  full_art: /\bnail[\s-]?art\b|\bfull[\s-]on\b|\bart\b/i,
};
// The vibe tiles' words: a claim only where claimableVibes allows it.
const VIBE_WORDS: Record<string, RegExp> = {
  clean_girl: /\bclean[\s-]girl\b|\bminimal(ist)?\b/i,
  soft_sweet: /\bsweet\b/i,
  french_girl: /\bfrench[\s-]girl\b/i,
  main_character: /\bmain[\s-]character\b/i,
  vacay: /\bvacay\b|\bvacation\b/i,
  alt_edgy: /\bedgy\b|\balt(ernative)?\b|\bgrunge\b|\bgoth(ic)?\b/i,
  holiday: /\bholidays?\b|\bfestive\b/i,
};
const BANNED_HEDGES = /\b(closest|similar|almost|nearly|close to)\b/i;

/**
 * Hard constraints on a ranker reason: short, no hedging, and every length,
 * shape, finish, color, drama, vibe or design word it uses must be true of
 * this set (a vibe only where claimableVibes allows it). Anything else is
 * swapped for the templated line.
 */
export function reasonIsValid(reason: unknown, p: DerivedProduct): reason is string {
  if (typeof reason !== "string") return false;
  const full = reason.trim();
  if (!full || wordCount(full) > MAX_REASON_WORDS || BANNED_HEDGES.test(full)) return false;
  // The set's own name ("Scarlet Pearl") is a name, not an attribute claim.
  const name = p.title.trim();
  const text = name ? full.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ") : full;
  let rest = text;
  for (const [src, id] of LENGTH_WORDS) {
    if (new RegExp(src, "i").test(rest) && p.length !== id) return false;
    rest = rest.replace(new RegExp(src, "gi"), " ");
  }
  for (const [id, re] of Object.entries(SHAPE_WORDS)) if (re.test(text) && p.shape !== id) return false;
  for (const [id, re] of Object.entries(FINISH_WORDS)) if (re.test(text) && p.finish !== id) return false;
  for (const [id, re] of Object.entries(COLOR_WORDS)) if (re.test(text) && !p.colors.includes(id)) return false;
  for (const [id, re] of Object.entries(DRAMA_WORDS)) if (re.test(rest) && !p.drama.includes(id)) return false;
  const vibes = claimableVibes(p);
  for (const [id, re] of Object.entries(VIBE_WORDS)) if (re.test(text) && !vibes.includes(id)) return false;
  // "French Girl Chic" is checked as a vibe above; "French" alone is tips.
  if (/\bfrench\b(?![\s-]girl)/i.test(text) && !p.isFrench) return false;
  if (/\bombre\b/i.test(text) && !p.isOmbre) return false;
  if (/\b3d\b|\bgems?\b/i.test(text) && !p.is3d) return false;
  if (/\bglitter\b/i.test(text) && !p.hasGlitter) return false;
  if (/\bsolid\b/i.test(text) && !p.isSolid) return false;
  if (/\bpattern(s|ed)?\b/i.test(text) && !p.hasPattern) return false;
  return true;
}

// ---- Branching (brief section 6, contract 2/3) ----

export const BRANCH_COLUMNS = ["length", "shape", "finish"] as const;
export type BranchColumn = (typeof BRANCH_COLUMNS)[number];

export interface BranchingBlock {
  /** Legacy (contract 3): what a widget deployed before fix spec v4 reads.
   * Such a widget ignores `full`. */
  threshold: number;
  questions: Record<string, { column: BranchColumn; values: Record<string, string> }>;
  pool: { columns: ["length", "shape", "finish"]; rows: Array<[string, string, string]> };
  /** Fix spec v4: full-match branching (see FullBranching). */
  full?: FullBranching;
}

export function branchingRows(eligible: DerivedProduct[]): Array<[string, string, string]> {
  return eligible
    .filter((p) => p.length && p.shape && p.finish)
    .map((p) => [p.length!, p.shape!, p.finish!]);
}

/** The flow's questions as the branching block needs them. */
export type FlowQuestionsForBranching = Array<{
  axisKey: string;
  options: Array<{ axisValue: string; selectAll?: boolean | null }>;
}>;

/** The block recommendation-config serves: one row per eligible product,
 * plus the v4 full-match block when the flow's questions are given. */
export function buildBranching(
  spec: Pick<ColumnarSpec, "axes" | "threshold"> & Partial<Pick<ColumnarSpec, "fullMatchMin">>,
  eligible: DerivedProduct[],
  flowQuestions?: FlowQuestionsForBranching,
): BranchingBlock {
  const questions: BranchingBlock["questions"] = {};
  for (const [axisKey, axis] of Object.entries(spec.axes)) {
    if (axis.role === "length" || axis.role === "shape" || axis.role === "finish") {
      questions[axisKey] = { column: axis.role, values: { ...axis.values } };
    }
  }
  return {
    threshold: spec.threshold,
    questions,
    pool: { columns: ["length", "shape", "finish"], rows: branchingRows(eligible) },
    ...(flowQuestions ? { full: buildFullBranching(spec, eligible, flowQuestions) } : {}),
  };
}

// ---- Full-match branching (fix spec v4) ----
//
// An option shows only if, given every earlier answer, at least `min` sets
// can still match EVERY answer (hard filters, vibe and drama) for some way
// of answering the questions after it. The widget runs the same check
// (fullVisibleBits in gleame-quiz.js, the same algorithm as the one below;
// widget-columnar.test.ts runs both on the real pool).
//
// Why it holds on every path: an option is shown only when some
// completion keeps `min` sets, where a completion answers each later
// question with "open" if it has a select-all option, else with one of its
// options. Any union of shown options keeps every row a single shown
// option keeps; "open" keeps more; and a question left with no option
// shown is answered open, which keeps at least what its single option in
// the completion kept. So each step keeps a completion alive, and the last
// answer leaves `min` sets or more.

/** Row columns, also the order of BranchingBlock.full.columns. */
export const FULL_COLUMNS = COLUMNAR_ROLES;
export type FullColumn = ColumnarRole;

export interface FullBranchQuestion {
  axisKey: string;
  column: FullColumn;
  /** Has a select-all option ("Surprise me", "Open to anything"). */
  any: boolean;
  /** axisValue -> bit index in this column's row mask. */
  values: Record<string, number>;
}

/**
 * `branching.full`, about 7 KB for Glamnetic's 416 sets:
 *   min        fullMatchMin (3): full matches an option must keep reachable
 *   threshold  spec.threshold (6), applied as before to thresholdColumns:
 *              an option there also needs this many rows on the path of
 *              earlier answers to those columns
 *   columns    row layout: vibe, length, shape, color, finish, drama
 *   anyIfEmpty columns where a 0 mask means "no value" (a super short set
 *              has no shape): such a row passes that column's filter but
 *              counts toward none of its options
 *   questions  the flow's mapped questions in flow order
 *   rows       one per eligible set: per column, a bit mask over
 *              ROLE_VOCAB[column] (bit i = vocab[i]); multi-valued columns
 *              (color, vibe, drama) set several bits. Vibe = approved labels
 *              where present, else the tag rules.
 */
export interface FullBranching {
  min: number;
  threshold: number;
  thresholdColumns: FullColumn[];
  anyIfEmpty: FullColumn[];
  columns: FullColumn[];
  questions: FullBranchQuestion[];
  rows: number[][];
}

const bitOf = (role: ColumnarRole, id: string): number => ROLE_VOCAB[role].indexOf(id);
const maskOf = (role: ColumnarRole, ids: Iterable<string | null>): number => {
  let m = 0;
  for (const id of ids) {
    const i = id ? bitOf(role, id) : -1;
    if (i >= 0) m |= 1 << i;
  }
  return m;
};

/** One row per set, columns as FULL_COLUMNS. */
export function fullRow(p: DerivedProduct): number[] {
  return FULL_COLUMNS.map((c) => {
    switch (c) {
      case "vibe":
        return maskOf(c, p.vibes);
      case "length":
        return maskOf(c, [p.length]);
      case "shape":
        return shapeless(p) ? 0 : maskOf(c, [p.shape]);
      case "color":
        return maskOf(c, p.colors);
      case "finish":
        return maskOf(c, [p.finish]);
      case "drama":
        return maskOf(c, p.drama);
    }
  });
}

export function buildFullBranching(
  spec: Pick<ColumnarSpec, "axes" | "threshold"> & Partial<Pick<ColumnarSpec, "fullMatchMin">>,
  eligible: DerivedProduct[],
  flowQuestions: FlowQuestionsForBranching,
): FullBranching {
  const questions: FullBranchQuestion[] = [];
  for (const q of flowQuestions) {
    const axis = Object.prototype.hasOwnProperty.call(spec.axes, q.axisKey) ? spec.axes[q.axisKey] : null;
    if (!axis || questions.some((e) => e.axisKey === q.axisKey)) continue;
    // Only options the flow actually offers (retired vibe tiles are gone
    // by now), so the completion check never leans on a missing option.
    const values: Record<string, number> = {};
    for (const o of q.options) {
      if (o.selectAll || !Object.prototype.hasOwnProperty.call(axis.values, o.axisValue)) continue;
      const bit = bitOf(axis.role, axis.values[o.axisValue]);
      if (bit >= 0) values[o.axisValue] = bit;
    }
    questions.push({ axisKey: q.axisKey, column: axis.role, any: q.options.some((o) => Boolean(o.selectAll)), values });
  }
  return {
    min: spec.fullMatchMin ?? COLUMNAR_DEFAULTS.fullMatchMin,
    threshold: spec.threshold,
    thresholdColumns: ["length", "shape", "finish"],
    anyIfEmpty: ["shape"],
    columns: [...FULL_COLUMNS],
    questions,
    rows: eligible.filter((p) => p.length && p.shape && p.finish).map(fullRow),
  };
}

const uniqueBits = (values: Record<string, number>): number[] =>
  [...new Set(Object.values(values))].sort((a, b) => a - b);

/**
 * Bits of question qi's options to show, given the answers before it:
 * answers[j] is the bit mask of question j's picks (0 = open: surprise,
 * skipped or unanswered). Fewer than two left skips the question (one is
 * recorded for the shopper), as for legacy branching.
 */
export function fullVisibleBits(b: FullBranching, qi: number, answers: ReadonlyArray<number | null | undefined>): number[] {
  const q = b.questions[qi];
  if (!q) return [];
  const col = (name: FullColumn) => b.columns.indexOf(name);
  const empty = b.anyIfEmpty.map(col);
  const passes = (row: number[], c: number, mask: number) =>
    !mask || (row[c] & mask) !== 0 || (row[c] === 0 && empty.includes(c));
  const prior: Array<[number, number]> = [];
  const priorT: Array<[number, number]> = [];
  for (let j = 0; j < qi && j < b.questions.length; j++) {
    const m = answers[j] || 0;
    const c = col(b.questions[j].column);
    if (!m || c < 0) continue;
    prior.push([c, m]);
    if (b.thresholdColumns.includes(b.questions[j].column)) priorT.push([c, m]);
  }
  const ci = col(q.column);
  if (ci < 0) return [];
  const base = b.rows.filter((r) => prior.every(([c, m]) => passes(r, c, m)));
  const thresholded = b.thresholdColumns.includes(q.column);
  const baseT = thresholded ? b.rows.filter((r) => priorT.every(([c, m]) => passes(r, c, m))) : [];
  const later = b.questions
    .slice(qi + 1)
    .filter((x) => !x.any && col(x.column) >= 0)
    .map((x) => ({ c: col(x.column), bits: uniqueBits(x.values) }));
  const feasible = (rows: number[][], k: number): boolean => {
    if (rows.length < b.min) return false;
    if (k === later.length) return true;
    for (const bit of later[k].bits) {
      if (feasible(rows.filter((r) => passes(r, later[k].c, 1 << bit)), k + 1)) return true;
    }
    return false;
  };
  const out: number[] = [];
  for (const bit of uniqueBits(q.values)) {
    const own = (r: number[]) => (r[ci] & (1 << bit)) !== 0;
    if (thresholded && baseT.filter(own).length < b.threshold) continue;
    if (feasible(base.filter(own), 0)) out.push(bit);
  }
  return out;
}

/** An answer as fullVisibleBits takes it: its picks' bits for the
 * question's column, 0 for surprise / skipped. */
export function fullAnswerMask(q: FullBranchQuestion, a: RoleAnswer | undefined): number {
  if (!Array.isArray(a)) return 0;
  return maskOf(q.column, a);
}

/** A prior answer on a branching column: the union of its picks. */
export type BranchPrior = { column: BranchColumn; values: string[] };

/** Rows matching every prior answer (multi-select answers are a union). */
export function countRows(
  rows: Array<[string, string, string]>,
  column: BranchColumn,
  value: string,
  prior: BranchPrior[],
): number {
  const ci = BRANCH_COLUMNS.indexOf(column);
  const pi = prior.map((p) => ({ i: BRANCH_COLUMNS.indexOf(p.column), set: new Set(p.values) }));
  let n = 0;
  for (const row of rows) {
    if (row[ci] !== value) continue;
    if (pi.every(({ i, set }) => set.has(row[i]))) n++;
  }
  return n;
}

/** Contract 3, server side: which specific options a question shows, and
 * whether it is skipped (0 or 1 visible). */
export function branchVisibility(
  rows: Array<[string, string, string]>,
  threshold: number,
  column: BranchColumn,
  optionIds: string[],
  prior: BranchPrior[],
): { counts: Record<string, number>; visible: string[]; skipped: boolean } {
  const counts: Record<string, number> = {};
  for (const id of optionIds) counts[id] = countRows(rows, column, id, prior);
  const visible = optionIds.filter((id) => counts[id] >= threshold);
  return { counts, visible, skipped: visible.length <= 1 };
}

export interface HiddenLogEntry {
  /** Answer IDs chosen so far, e.g. ["short"] or ["short", "almond"]. */
  path: string[];
  question: "shape" | "finish";
  /** 0 or 1 options left: the question is skipped... */
  skipped: boolean;
  /** ...and with exactly 1, that option is recorded as the answer. */
  autoAnswer: string | null;
  hidden: Array<{ id: string; count: number }>;
}

/**
 * What the threshold hides on each single-length path: the shape question,
 * then the finish question per visible shape (or after a skipped shape).
 * Studio shows this so Lisa can see exactly why a tile didn't appear.
 */
export function hiddenOptionsLog(
  spec: Pick<ColumnarSpec, "axes" | "threshold">,
  rows: Array<[string, string, string]>,
): HiddenLogEntry[] {
  const optionsFor = (role: ColumnarRole) => {
    const key = axisForRole(spec, role);
    return key ? vocabSort(role, Object.values(spec.axes[key].values)) : [];
  };
  const lengths = optionsFor("length");
  const shapes = optionsFor("shape");
  const finishes = optionsFor("finish");
  const T = spec.threshold;
  const out: HiddenLogEntry[] = [];
  const entry = (path: string[], question: HiddenLogEntry["question"], v: ReturnType<typeof branchVisibility>, ids: string[]): HiddenLogEntry => ({
    path,
    question,
    skipped: v.skipped,
    autoAnswer: v.visible.length === 1 ? v.visible[0] : null,
    hidden: ids.filter((id) => !v.visible.includes(id)).map((id) => ({ id, count: v.counts[id] })),
  });
  for (const len of lengths) {
    const lengthPrior: BranchPrior = { column: "length", values: [len] };
    let shapePaths: Array<{ path: string[]; prior: BranchPrior[] }> = [{ path: [len], prior: [lengthPrior] }];
    if (shapes.length) {
      const sv = branchVisibility(rows, T, "shape", shapes, [lengthPrior]);
      out.push(entry([len], "shape", sv, shapes));
      if (!sv.skipped) {
        shapePaths = sv.visible.map((s) => ({
          path: [len, s],
          prior: [lengthPrior, { column: "shape", values: [s] }],
        }));
      } else if (sv.visible.length === 1) {
        // One visible shape is recorded as the answer.
        shapePaths = [{ path: [len, sv.visible[0]], prior: [lengthPrior, { column: "shape", values: sv.visible }] }];
      }
    }
    if (!finishes.length) continue;
    for (const sp of shapePaths) {
      const fv = branchVisibility(rows, T, "finish", finishes, sp.prior);
      out.push(entry(sp.path, "finish", fv, finishes));
    }
  }
  return out;
}

/** Labels from the quiz's own options (the shopper's words), keyed by
 * answer ID; the select-all option never names an answer. */
export function labelsFromFlow(
  spec: Pick<ColumnarSpec, "axes">,
  questions: Array<{ axisKey: string; options: Array<{ label: string; axisValue: string; selectAll?: boolean }> }>,
): AnswerLabels {
  const out: AnswerLabels = {};
  for (const q of questions) {
    const axis = spec.axes[q.axisKey];
    if (!axis) continue;
    for (const o of q.options) {
      if (o.selectAll) continue;
      const id = Object.prototype.hasOwnProperty.call(axis.values, o.axisValue) ? axis.values[o.axisValue] : undefined;
      // Strip markdown emphasis, emoji and stray spacing from merchant copy.
      const clean = String(o.label ?? "")
        .replace(/[*_~`]/g, "")
        .replace(/\p{Extended_Pictographic}/gu, "")
        .replace(/\s+/g, " ")
        .trim();
      if (id && clean && !out[id]) out[id] = clean;
    }
  }
  return out;
}

// ---- Assembly: tiers + Step D picks (or fallback) + Step E + copy ----

export interface AssembledItem {
  product: DerivedProduct;
  /** The one-line why: the ranker's when it passes reasonIsValid. */
  reason: string;
  meta: { length: string; shape: string; finish: string };
}

export interface AssembledColumnar {
  rung: Rung;
  exactCount: number;
  header: HeaderCopy;
  bestMatchBadge: boolean;
  results: AssembledItem[];
  alsoMatched: AssembledItem[];
  loosen: "finish" | "shape" | "color" | null;
  /** True when the ranker's picks were used (false = Step C fallback). */
  ranked: boolean;
}

/**
 * Everything after Step D, pure: the ranker's picks when they are exactly
 * the right count from the candidate set (else the top of Step C), held to
 * the tiers; its reasons where they pass the copy rules (else the
 * templated line); and the header.
 */
export function assembleColumnar(
  ladder: LadderResult,
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "resultCount" | "alsoMatchedCount" | "candidateCount" | "vibes">,
  labels: AnswerLabels,
  ranked?: { ids: string[]; reasons: Record<string, string> } | null,
): AssembledColumnar {
  const { results, alsoMatched, usedRanker } = selectResults(ladder, spec, ranked?.ids ?? null);
  const vibe = activeVibe(answers, spec);
  const item = (p: DerivedProduct, llmReason: string | undefined): AssembledItem => ({
    product: p,
    reason: usedRanker && reasonIsValid(llmReason, p) ? llmReason.trim() : whyLine(p, answers, labels, vibe),
    meta: metaFor(p),
  });
  return {
    rung: ladder.rung,
    exactCount: ladder.exactCount,
    header: headerFor(ladder, answers, labels, results.length),
    // #1 matches every answer whenever any set does (tier 1 leads).
    bestMatchBadge: results.length > 0 && tierIn(ladder, results[0]) === 1,
    results: results.map((p) => item(p, ranked?.reasons[p.id])),
    alsoMatched: alsoMatched.map((p) => item(p, undefined)),
    loosen: results.length === 0 ? ladder.loosen : null,
    ranked: usedRanker,
  };
}