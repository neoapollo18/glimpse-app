// Columnar matching pipeline (Glamnetic recommendation logic v3, brief
// sections 4-6). Pure functions of (answers, pool): Step A hard filters,
// Step B vibe gate, Step C soft scoring, the section 5 relaxation ladder,
// Step E "also matched", the branching availability rows and the resultKey
// permalink encoding. The server module (engine.server.ts) adds I/O: the
// pool load, stock, the Step D ranker and caching.
//
// Length, shape and finish are never relaxed. Only color, drama and the
// French Girl Chic gate step down, in that order.

import type { DerivedProduct } from "./attributes";
import { vibeMatches } from "./attributes";
import {
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

/** Step A: exact length, shape and finish. Never relaxed. */
export function passesHardFilters(p: DerivedProduct, answers: ColumnarAnswers): boolean {
  const lengths = specific(answers.length);
  if (lengths && !(p.length && lengths.includes(p.length))) return false;
  const shapes = specific(answers.shape);
  if (shapes && !(p.shape && shapes.includes(p.shape))) return false;
  const finishes = specific(answers.finish);
  if (finishes && !(p.finish && finishes.includes(p.finish))) return false;
  return true;
}

/** Step B: French Girl Chic is the only gate; every other vibe boosts. */
export function passesVibeGate(p: DerivedProduct, vibe: string | null): boolean {
  return vibe === "french_girl" ? vibeMatches(p, vibe) : true;
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
  rung: Rung;
  /** Products passing Step A + B. */
  exactCount: number;
  /** Products passing Step A alone (exact length, shape, finish). */
  hardCount: number;
  /** The rung's set in Step C order: the ranker's candidates come from here. */
  ordered: DerivedProduct[];
  /** Other exact-on-length/shape/finish products (Step C order) that back
   * the "Also matched" row once the rung's set runs out. */
  backfill: DerivedProduct[];
  /** Which answer one tap loosens when nothing matches. */
  loosen: "finish" | "shape" | null;
}

/**
 * Brief section 5. Rung 1 = exact on everything (A + B + a picked color +
 * a picked drama level), 2 drops drama, 3 drops color, 4 lifts the French
 * Girl Chic gate, 5 shows whatever exists. Stops at the first rung with at
 * least resultCount products.
 */
export function runLadder(
  pool: DerivedProduct[],
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "weights" | "vibes" | "resultCount">,
): LadderResult {
  const vibe = activeVibe(answers, spec);
  const hard = pool.filter((p) => passesHardFilters(p, answers));
  const gated = hard.filter((p) => passesVibeGate(p, vibe));
  const colors = specific(answers.color);
  const dramas = specific(answers.drama);
  const colorOk = (p: DerivedProduct) => !colors || p.colors.some((c) => colors.includes(c));
  const dramaOk = (p: DerivedProduct) => !dramas || p.drama.some((d) => dramas.includes(d));
  const need = spec.resultCount;
  // The first rung that admits a product: 1 = a picked color and drama
  // level, 2 = a picked color, 3 = through the vibe gate, 4 = gate lifted.
  // A relaxed set lists every closer set first, so "a few step outside
  // your picks" stays true whenever the ranker falls back to this order.
  const tierOf = (p: DerivedProduct) => (!passesVibeGate(p, vibe) ? 4 : !colorOk(p) ? 3 : !dramaOk(p) ? 2 : 1);

  const sets: Array<[Rung, DerivedProduct[]]> = [
    [1, gated.filter((p) => colorOk(p) && dramaOk(p))],
    [2, gated.filter(colorOk)],
    [3, gated],
  ];
  // Rung 4 only exists where a gate does; elsewhere it equals rung 3.
  if (vibe === "french_girl") sets.push([4, hard]);

  let rung: Rung = 5;
  let set = hard;
  for (const [r, s] of sets) {
    if (s.length >= need) {
      rung = r;
      set = s;
      break;
    }
  }
  // At rung 5 the French gate stays lifted (rung 4 already lifted it), so
  // the shopper sees every set that is exact on length, shape and finish.
  // Only the set widens: color and drama keep their full weight in the
  // score at every rung, and the tier keeps French and ombre sets first.
  const ordered = stepCOrder(set, answers, vibe, spec.weights, tierOf).map((s) => s.product);
  const inSet = new Set(ordered.map((p) => p.id));
  const backfillPool = (rung <= 3 ? gated : hard).filter((p) => !inSet.has(p.id));
  const backfill = stepCOrder(backfillPool, answers, vibe, spec.weights, tierOf).map((s) => s.product);

  let loosen: LadderResult["loosen"] = null;
  if (ordered.length === 0) {
    const without = (role: "finish" | "shape") => {
      const a = { ...answers };
      delete a[role];
      return pool.some((p) => passesHardFilters(p, a));
    };
    const candidates = (["finish", "shape"] as const).filter((r) => specific(answers[r]));
    loosen = candidates.find((r) => without(r)) ?? candidates[0] ?? null;
  }

  return { rung, exactCount: gated.length, hardCount: hard.length, ordered, backfill, loosen };
}

/** Step D result (or the deterministic fallback) plus Step E. */
export function selectResults(
  ladder: Pick<LadderResult, "ordered" | "backfill">,
  spec: Pick<ColumnarSpec, "resultCount" | "alsoMatchedCount">,
  rankedIds?: string[] | null,
): { results: DerivedProduct[]; alsoMatched: DerivedProduct[] } {
  const n = Math.min(spec.resultCount, ladder.ordered.length);
  const byId = new Map(ladder.ordered.map((p) => [p.id, p]));
  let results: DerivedProduct[];
  if (rankedIds && rankedIds.length === n && rankedIds.every((id) => byId.has(id)) && new Set(rankedIds).size === n) {
    results = rankedIds.map((id) => byId.get(id)!);
  } else {
    results = ladder.ordered.slice(0, n);
  }
  const picked = new Set(results.map((p) => p.id));
  const alsoMatched = ladder.ordered
    .filter((p) => !picked.has(p.id))
    .concat(ladder.backfill)
    .slice(0, spec.alsoMatchedCount);
  return { results, alsoMatched };
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
  ladder: Pick<LadderResult, "rung" | "ordered">,
  answers: ColumnarAnswers,
  labels: AnswerLabels,
  shown: number,
): HeaderCopy {
  if (shown === 0) return { kind: "none", text: "We don't have that combination yet." };
  if (ladder.rung === 5) {
    return {
      kind: "fewer",
      text: `${shown} ${shown === 1 ? "set matches" : "sets match"} exactly. Change an answer above to see more.`,
    };
  }
  if (ladder.rung === 1) return { kind: "normal", text: null };
  // What stepped down at this rung: drama at 2, color at 3, the vibe gate
  // at 4. Never length, shape or finish.
  const outside = ladder.rung === 2 ? "style" : ladder.rung === 3 ? "color" : "vibe";
  const path = pathPhrase(answers, labels);
  return {
    kind: "relaxed",
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
 * has, and never hedges on length, shape or finish.
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
  const lines: string[] = [];
  if (vibe === "french_girl" && (p.isFrench || p.isOmbre)) {
    lines.push(`${p.isFrench ? "French tips" : "Soft ombre"}, ${fit}, made for ${label(labels, vibe)}.`);
  }
  if (color && drama) lines.push(`${fit} in ${color}, ${drama} as asked.`);
  if (color) lines.push(`${fit} in the ${color} you picked.`);
  if (drama) lines.push(`${fit}, ${drama} like you asked.`);
  if (vibe && vibeMatches(p, vibe)) lines.push(`${fit}, made for ${label(labels, vibe)}.`);
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
  dark_moody: /\bblack\b|\bgr[ae]y\b/i,
  metallics: /\bgold\b|\bsilver\b|\bmetallics?\b/i,
  oranges_yellows: /\boranges?\b|\byellows?\b|\bcoral\b|\bpeach\b/i,
  white: /\bwhite\b|\bmilky\b/i,
};
const BANNED_HEDGES = /\b(closest|similar|almost|nearly|close to)\b/i;

/**
 * Hard constraints on a ranker reason: short, no hedging, and every length,
 * shape, finish, color or design word it uses must be true of this set.
 * Anything else is swapped for the templated line.
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
  // "French Girl Chic" is the shopper's vibe, not a claim about the set.
  if (/\bfrench\b(?!\s+girl)/i.test(text) && !p.isFrench) return false;
  if (/\bombre\b/i.test(text) && !p.isOmbre) return false;
  if (/\b3d\b|\bgems?\b/i.test(text) && !p.is3d) return false;
  if (/\bglitter\b/i.test(text) && !p.hasGlitter) return false;
  return true;
}

// ---- Branching (brief section 6, contract 2/3) ----

export const BRANCH_COLUMNS = ["length", "shape", "finish"] as const;
export type BranchColumn = (typeof BRANCH_COLUMNS)[number];

export interface BranchingBlock {
  threshold: number;
  questions: Record<string, { column: BranchColumn; values: Record<string, string> }>;
  pool: { columns: ["length", "shape", "finish"]; rows: Array<[string, string, string]> };
}

export function branchingRows(eligible: DerivedProduct[]): Array<[string, string, string]> {
  return eligible
    .filter((p) => p.length && p.shape && p.finish)
    .map((p) => [p.length!, p.shape!, p.finish!]);
}

/** The block recommendation-config serves: one row per eligible product. */
export function buildBranching(spec: Pick<ColumnarSpec, "axes" | "threshold">, eligible: DerivedProduct[]): BranchingBlock {
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
  };
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

// ---- Assembly: ladder + Step D picks (or fallback) + Step E + copy ----

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
  loosen: "finish" | "shape" | null;
  /** True when the ranker's order was used (false = Step C fallback). */
  ranked: boolean;
}

/** The Step D candidate set: the top of the rung's Step C order. */
export const rankerCandidates = (ladder: Pick<LadderResult, "ordered">, spec: Pick<ColumnarSpec, "candidateCount">) =>
  ladder.ordered.slice(0, spec.candidateCount);

/**
 * Everything after Step D, pure: the ranker's picks when they are exactly
 * the right count from the candidate set (else the top of Step C), its
 * reasons where they pass the copy rules (else the templated line), and
 * the header per brief section 5.
 */
export function assembleColumnar(
  ladder: LadderResult,
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "resultCount" | "alsoMatchedCount" | "candidateCount" | "vibes">,
  labels: AnswerLabels,
  ranked?: { ids: string[]; reasons: Record<string, string> } | null,
): AssembledColumnar {
  const candidates = rankerCandidates(ladder, spec);
  const { results, alsoMatched } = selectResults(
    { ordered: candidates, backfill: ladder.ordered.slice(spec.candidateCount).concat(ladder.backfill) },
    spec,
    ranked?.ids ?? null,
  );
  const usedRanker = Boolean(
    ranked && results.length > 0 && ranked.ids.length === results.length && ranked.ids.every((id, i) => results[i].id === id),
  );
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
    bestMatchBadge: ladder.rung === 1 && results.length > 0,
    results: results.map((p) => item(p, ranked?.reasons[p.id])),
    alsoMatched: alsoMatched.map((p) => item(p, undefined)),
    loosen: results.length === 0 ? ladder.loosen : null,
    ranked: usedRanker,
  };
}
