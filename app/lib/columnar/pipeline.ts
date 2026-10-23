// Columnar matching pipeline (Glamnetic recommendation logic v3, brief
// sections 4-6, fix spec v4, logic v6.1). Pure functions of (answers,
// pool): the length / shape filter, the result tiers, Step C soft
// scoring, the six picks, the branching blocks and the resultKey permalink
// encoding. The server module (engine.server.ts) adds I/O: the pool load,
// stock, the Step D ranker and caching.
//
// v6.1 (Aaron, 2026-10-22): length and shape are never broken. Every
// result passes them; the six are filled tier by tier: perfect matches
// (every answer), then all filters with drama, all filters with vibe,
// filters only, a different color, a different finish (TIER_IDS). The
// ranker only reorders inside a tier. Branching never counts vibe or
// drama: an option shows when the hard answers so far leave it any set
// (length and shape: spec.threshold sets, so six can always be filled),
// topped up to three choices where the data has them.

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

/** Length and shape: never broken (v6.1). Every result passes these. */
export function passesKeepFilters(p: DerivedProduct, answers: ColumnarAnswers): boolean {
  const lengths = specific(answers.length);
  if (lengths && !(p.length && lengths.includes(p.length))) return false;
  const shapes = specific(answers.shape);
  if (shapes && !shapeless(p) && !(p.shape && shapes.includes(p.shape))) return false;
  return true;
}

/** The picked colors (at least one family) and finish: what the "Different
 * color" and "Different finish" tiers relax. */
export function colorFits(p: DerivedProduct, answers: ColumnarAnswers): boolean {
  const colors = specific(answers.color);
  return !colors || p.colors.some((c) => colors.includes(c));
}
export function finishFits(p: DerivedProduct, answers: ColumnarAnswers): boolean {
  const finishes = specific(answers.finish);
  return !finishes || Boolean(p.finish && finishes.includes(p.finish));
}

/** All four hard filters: length, shape, finish and color. */
export function passesHardFilters(p: DerivedProduct, answers: ColumnarAnswers): boolean {
  return passesKeepFilters(p, answers) && finishFits(p, answers) && colorFits(p, answers);
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
 * Vibe / drama closeness: 1 = both fit, 2 = drama only, 3 = vibe only,
 * 4 = neither. Drama outranks vibe: it is the look the shopper asked for
 * in so many words (solid vs full nail art), it shows on the card, and it
 * comes straight from tags, where a vibe is a softer read. A gate vibe
 * swaps the two, since Lisa made French Girl Chic "French tips and ombres
 * only".
 */
export function tierOf(p: DerivedProduct, answers: ColumnarAnswers, vibe: string | null): Tier {
  const m = softMatch(p, answers, vibe);
  if (m.vibe && m.drama) return 1;
  const gate = vibe !== null && GATE_VIBES.includes(vibe);
  if (gate ? m.vibe : m.drama) return 2;
  if (gate ? m.drama : m.vibe) return 3;
  return 4;
}

/**
 * v6.1 result tiers, named for what the set steps outside of. Every one
 * keeps length and shape.
 *   perfect       every answer
 *   vibe          all four filters and drama; another vibe
 *   drama         all four filters and vibe; another drama level
 *   vibe_drama    all four filters only
 *   color         length, shape and finish; none of the picked colors
 *   finish        length, shape and color; another finish
 *   color_finish  length and shape only
 * Order: as listed (Aaron's item 9), except that a gate vibe (French Girl
 * Chic) puts "drama" before "vibe", as tierOf does.
 */
export const TIER_IDS = ["perfect", "vibe", "drama", "vibe_drama", "color", "finish", "color_finish"] as const;
export type TierId = (typeof TIER_IDS)[number];

export function tierIdOf(p: DerivedProduct, answers: ColumnarAnswers, vibe: string | null): TierId {
  const color = colorFits(p, answers);
  const finish = finishFits(p, answers);
  if (!color) return finish ? "color" : "color_finish";
  if (!finish) return "finish";
  const m = softMatch(p, answers, vibe);
  if (m.vibe && m.drama) return "perfect";
  if (!m.vibe && !m.drama) return "vibe_drama";
  return m.vibe ? "drama" : "vibe";
}

/** 1 (perfect) to 7 (length and shape only). */
export function tierRank(id: TierId, vibe: string | null): number {
  const gate = vibe !== null && GATE_VIBES.includes(vibe);
  if (gate && id === "vibe") return 3;
  if (gate && id === "drama") return 2;
  return TIER_IDS.indexOf(id) + 1;
}

/** Sort key: the tier, then (in the color / finish tiers, which mix every
 * vibe and drama fit) the vibe / drama closeness. The ranker never moves a
 * set across keys. */
export function tierKeyOf(p: DerivedProduct, answers: ColumnarAnswers, vibe: string | null): number {
  const rank = tierRank(tierIdOf(p, answers, vibe), vibe);
  return rank * 10 + (rank >= 5 ? tierOf(p, answers, vibe) : 0);
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
  /** Sets matching every answer (all four filters, vibe and drama). */
  exactCount: number;
  /** Sets passing all four hard filters (length, shape, finish, color). */
  hardCount: number;
  /** Sets passing length and shape: everything the six can come from. */
  keepCount: number;
  /** The length / shape set in tier, then Step C order. The ranker's
   * candidates and the six both come from here. */
  ordered: DerivedProduct[];
  /** Tier sort key of every set in `ordered` (tierKeyOf), by id. */
  tiers: Map<string, number>;
  /** Tier of every set in `ordered`, by id. */
  tierIds: Map<string, TierId>;
  /** Collections too broad to count toward the per-collection cap. */
  storewide: Set<string>;
  /** Which answer one tap loosens when nothing passes length and shape. */
  loosen: "finish" | "shape" | "color" | null;
}

/** Results from one collection (v6.1 item 14). */
export const COLLECTION_CAP = COLUMNAR_DEFAULTS.collectionCap;
/** Super Short sets a Super Short + another length shopper always sees
 * (item 13), when the pool has them. */
export const SUPER_SHORT_MIN = COLUMNAR_DEFAULTS.superShortMin;

/**
 * Collections that don't count toward the cap: the ones holding more than
 * storewideCollectionShare of the pool. Glamnetic tags every set with
 * shop-wide groupings ("Summer Shop 2026", 180 of 416 sets; the "Glam
 * Icons" core line, 102) next to its real drop or colorway ("Love Notes",
 * "Velvet Pink"). Capping a 40%-of-the-store grouping at two would only
 * push perfect matches out; the drops and colorways are what repeats.
 */
export function storewideCollections(pool: DerivedProduct[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pool) for (const c of p.collections) counts.set(c, (counts.get(c) ?? 0) + 1);
  const limit = pool.length * COLUMNAR_DEFAULTS.storewideCollectionShare;
  const out = new Set<string>();
  for (const [c, n] of counts) if (n > limit) out.add(c);
  return out;
}

/** The collections a set counts toward for the cap. */
export const cappedCollections = (p: DerivedProduct, storewide: Set<string>): string[] =>
  p.collections.filter((c) => !storewide.has(c));

/**
 * v6.1: every set passing length and shape, in tier order (tierKeyOf),
 * Step C's score inside each tier. The French Girl Chic gate becomes the
 * tier swap: French or ombre sets passing all four filters come before the
 * others that do.
 */
export function runLadder(
  pool: DerivedProduct[],
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "weights" | "vibes" | "resultCount">,
): LadderResult {
  const vibe = activeVibe(answers, spec);
  const keep = pool.filter((p) => passesKeepFilters(p, answers));
  const tierIds = new Map<string, TierId>(keep.map((p) => [p.id, tierIdOf(p, answers, vibe)]));
  const tiers = new Map<string, number>(keep.map((p) => [p.id, tierKeyOf(p, answers, vibe)]));
  const ordered = stepCOrder(keep, answers, vibe, spec.weights, (p) => tiers.get(p.id)!).map((s) => s.product);

  let loosen: LadderResult["loosen"] = null;
  if (ordered.length === 0 && specific(answers.shape)) {
    const a = { ...answers };
    delete a.shape;
    if (pool.some((p) => passesKeepFilters(p, a))) loosen = "shape";
  }

  let exactCount = 0;
  for (const t of tierIds.values()) if (t === "perfect") exactCount++;
  return {
    exactCount,
    hardCount: keep.filter((p) => passesHardFilters(p, answers)).length,
    keepCount: keep.length,
    ordered,
    tiers,
    tierIds,
    storewide: storewideCollections(pool),
    loosen,
  };
}

const keyIn = (ladder: Pick<LadderResult, "tiers">, p: DerivedProduct): number => ladder.tiers.get(p.id) ?? 99;

export type ReservedRole = "length" | "shape" | "finish" | "color" | "drama";
export interface Seat {
  role: ReservedRole;
  value: string;
  /** Sets with this value the six must hold once this seat is filled. */
  count: number;
}

/**
 * Seats a multi-pick shopper is owed (Aaron, 2026-10-23): with 2+ answers
 * on a question, every pick shows in the six. In order: one per picked
 * length, one per picked shape, a second per picked length, then one per
 * picked finish, color and drama. A single answer needs no seat (length
 * and shape hold for every result; the rest rank).
 */
export function reservedSeats(answers: ColumnarAnswers): Seat[] {
  const multi = (role: ReservedRole): string[] => {
    const picked = specific(answers[role]);
    return picked && picked.length > 1 ? picked : [];
  };
  const seats: Seat[] = [];
  for (const value of multi("length")) seats.push({ role: "length", value, count: 1 });
  for (const value of multi("shape")) seats.push({ role: "shape", value, count: 1 });
  for (const value of multi("length")) seats.push({ role: "length", value, count: 2 });
  for (const role of ["finish", "color", "drama"] as const) {
    for (const value of multi(role)) seats.push({ role, value, count: 1 });
  }
  return seats;
}

/** Does the set carry this answer? A super short set has no shape. */
export function hasValue(p: DerivedProduct, role: ReservedRole, value: string): boolean {
  switch (role) {
    case "length":
      return p.length === value;
    case "shape":
      return !shapeless(p) && p.shape === value;
    case "finish":
      return p.finish === value;
    case "color":
      return p.colors.includes(value);
    case "drama":
      return p.drama.includes(value);
  }
}

/**
 * The six, from a tier-ordered list:
 *   - first the reserved seats (reservedSeats), each from the sets passing
 *     all four hard filters: the one that also fills the most open seats,
 *     then the closest in the list;
 *   - then first come first served;
 *   - no more than COLLECTION_CAP from one (counted) collection, unless the
 *     list can't fill the grid otherwise (or a seat has no other set);
 *   - a Super Short + another length shopper gets SUPER_SHORT_MIN Super
 *     Short sets when the list has them: the best ones replace the lowest
 *     picks that hold no seat.
 * Returned in list order, so the grid never shows a farther tier above a
 * closer one.
 */
export function pickResults(
  order: DerivedProduct[],
  answers: ColumnarAnswers,
  n: number,
  storewide: Set<string>,
): DerivedProduct[] {
  const pos = new Map(order.map((p, i) => [p.id, i]));
  const per = new Map<string, number>();
  const counted = (p: DerivedProduct) => cappedCollections(p, storewide);
  const fits = (p: DerivedProduct) => counted(p).every((c) => (per.get(c) ?? 0) < COLLECTION_CAP);
  const add = (p: DerivedProduct, picks: DerivedProduct[]) => {
    picks.push(p);
    for (const c of counted(p)) per.set(c, (per.get(c) ?? 0) + 1);
  };
  const drop = (i: number, picks: DerivedProduct[]) => {
    const [p] = picks.splice(i, 1);
    for (const c of counted(p)) per.set(c, (per.get(c) ?? 0) - 1);
  };
  const picks: DerivedProduct[] = [];
  const reserved = new Set<string>();
  const seats = reservedSeats(answers);
  if (seats.length > 0) {
    const held = (s: Seat) => picks.filter((p) => hasValue(p, s.role, s.value)).length;
    const open = (p: DerivedProduct) => seats.filter((s) => held(s) < s.count && hasValue(p, s.role, s.value)).length;
    const hard = order.filter((p) => passesHardFilters(p, answers));
    for (const seat of seats) {
      while (picks.length < n && held(seat) < seat.count) {
        let best: DerivedProduct | null = null;
        let bestFits = false;
        let bestOpen = -1;
        for (const p of hard) {
          if (reserved.has(p.id) || !hasValue(p, seat.role, seat.value)) continue;
          const f = fits(p);
          const o = open(p);
          if ((f && !bestFits) || (f === bestFits && o > bestOpen)) {
            best = p;
            bestFits = f;
            bestOpen = o;
          }
        }
        if (!best) break;
        add(best, picks);
        reserved.add(best.id);
      }
    }
  }
  const capped: DerivedProduct[] = [];
  for (const p of order) {
    if (picks.length >= n) break;
    if (reserved.has(p.id)) continue;
    if (fits(p)) add(p, picks);
    else capped.push(p);
  }
  // Six beats the cap: only when the list ran out.
  for (const p of capped) {
    if (picks.length >= n) break;
    add(p, picks);
  }
  picks.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);

  const lengths = specific(answers.length);
  if (lengths && lengths.length > 1 && lengths.includes("super_short")) {
    const isSS = (p: DerivedProduct) => p.length === "super_short";
    const want = Math.min(SUPER_SHORT_MIN, order.filter(isSS).length);
    const queue = order.filter((p) => isSS(p) && !picks.includes(p));
    for (let have = picks.filter(isSS).length; have < want && queue.length; have++) {
      if (picks.length >= n) {
        let k = picks.length - 1;
        while (k >= 0 && (isSS(picks[k]) || reserved.has(picks[k].id))) k--;
        if (k < 0) break;
        drop(k, picks);
      }
      const ok = queue.findIndex(fits);
      add(queue.splice(ok >= 0 ? ok : 0, 1)[0], picks);
      picks.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    }
  }
  return picks;
}

/**
 * The Step D candidate set: every set of a tier the grid reaches (up to the
 * tier of the last Step C pick), capped at candidateCount. The ranker
 * never sees a set it could only place above a closer one.
 */
export function rankerCandidates(
  ladder: Pick<LadderResult, "ordered" | "tiers" | "storewide">,
  spec: Pick<ColumnarSpec, "candidateCount" | "resultCount">,
  answers: ColumnarAnswers = {},
): DerivedProduct[] {
  const n = Math.min(spec.resultCount, ladder.ordered.length);
  if (n === 0) return [];
  const picks = pickResults(ladder.ordered, answers, n, ladder.storewide);
  const boundary = Math.max(...picks.map((p) => keyIn(ladder, p)));
  const window = ladder.ordered.filter((p) => keyIn(ladder, p) <= boundary).slice(0, Math.max(spec.candidateCount, n));
  // A reserved seat can sit past the window: the ranker sees it too.
  const ids = new Set([...window, ...picks].map((p) => p.id));
  return ladder.ordered.filter((p) => ids.has(p.id));
}

/**
 * Step D's picks (or the Step C fallback). A valid ranking is exactly n
 * distinct candidates; it then orders the sets inside each tier (its picks
 * first, in its order), never across tiers, and pickResults applies the
 * collection cap and the Super Short rule to that order like any other.
 */
export function selectResults(
  ladder: Pick<LadderResult, "ordered" | "tiers" | "storewide">,
  spec: Pick<ColumnarSpec, "resultCount" | "alsoMatchedCount" | "candidateCount">,
  rankedIds?: string[] | null,
  answers: ColumnarAnswers = {},
): { results: DerivedProduct[]; alsoMatched: DerivedProduct[]; usedRanker: boolean } {
  const n = Math.min(spec.resultCount, ladder.ordered.length);
  let order = ladder.ordered;
  let usedRanker = false;
  if (n > 0 && rankedIds && rankedIds.length === n && new Set(rankedIds).size === n) {
    const candidates = new Set(rankerCandidates(ladder, spec, answers).map((p) => p.id));
    if (rankedIds.every((id) => candidates.has(id))) {
      const pref = new Map(rankedIds.map((id, i) => [id, i]));
      const base = new Map(ladder.ordered.map((p, i) => [p.id, i]));
      const rankOf = (p: DerivedProduct) => pref.get(p.id) ?? n;
      order = [...ladder.ordered].sort(
        (a, b) => keyIn(ladder, a) - keyIn(ladder, b) || rankOf(a) - rankOf(b) || base.get(a.id)! - base.get(b.id)!,
      );
      usedRanker = true;
    }
  }
  const results = pickResults(order, answers, n, ladder.storewide);
  const shown = new Set(results.map((p) => p.id));
  const alsoMatched = order.filter((p) => !shown.has(p.id)).slice(0, spec.alsoMatchedCount);
  return { results, alsoMatched, usedRanker };
}

// ---- Copy (brief section 5 "Copy rules on the results page", v6.1) ----

export type AnswerLabels = Record<string, string>;
const lower = (s: string) => s.toLowerCase();

export interface HeaderCopy {
  /** What a widget deployed before v6.1 reads: "normal" shows the
   * merchant's own headline, any other kind shows `text`. */
  kind: "normal" | "relaxed" | "fewer" | "none";
  text: string | null;
  /** v6.1: "all" = every shown set is a perfect match, "some" = perfect
   * matches first, then next-best picks, "closest" = none is. The widget
   * words it from Text & labels; absent when nothing shows. */
  match?: "all" | "some" | "closest";
  /** Perfect matches shown. */
  perfect?: number;
}

/** The results header lines (v6.1 item 12, copy from the 2026-10-23
 * Trello card). The widget's Text & labels entries (quiz-ui-text.ts)
 * default to the same strings; `text` carries them for widgets deployed
 * before v6.1. */
export const HEADER_TEXT = {
  allSix: "Your perfect six. Made for your vibe.",
  /** Every shown set is perfect, but sold-out sets left fewer than six. */
  allFew: "Every set here matches everything you picked",
  some: "Your perfect matches, plus a few more that would look amazing on you.",
  someOne: "Your perfect match, plus a few more that would look amazing on you.",
  closest: "Hand-picked for you. Six sets we think you’ll love.",
  none: "We don't have that combination yet.",
} as const;

/** Card labels per tier (v6.1 items 8-9); same defaults as the widget's
 * Text & labels entries. "Different color" and "Different finish" are
 * Aaron's; the other fallback labels name what differs the same way. */
export const TIER_LABELS: Record<TierId, string> = {
  perfect: "Perfect match",
  vibe: "Different vibe",
  drama: "Different drama",
  vibe_drama: "Different vibe and drama",
  color: "Different color",
  finish: "Different finish",
  color_finish: "Different color and finish",
};

export function headerFor(perfect: number, shown: number, resultCount: number): HeaderCopy {
  if (shown === 0) return { kind: "none", text: HEADER_TEXT.none };
  const fewer = shown < resultCount;
  if (perfect >= shown) {
    return {
      kind: fewer ? "fewer" : "normal",
      text: shown === 6 ? HEADER_TEXT.allSix : HEADER_TEXT.allFew,
      match: "all",
      perfect: shown,
    };
  }
  const kind = fewer ? "fewer" : "relaxed";
  if (perfect > 0) {
    return {
      kind,
      text: (perfect === 1 ? HEADER_TEXT.someOne : HEADER_TEXT.some).replace("{n}", String(perfect)),
      match: "some",
      perfect,
    };
  }
  return { kind, text: HEADER_TEXT.closest, match: "closest", perfect: 0 };
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

const joinAnd = (words: string[]): string =>
  words.length <= 1 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/**
 * The why-line under a card when the ranker's is missing or fails the
 * rules (v6.1 item 15): one plain sentence about the set itself, from its
 * tags: finish, length, shape, colors and one standout detail, e.g. "A
 * glossy short almond set in nude and white with French tips." It never
 * echoes the shopper's answers back ("as asked", "you picked"), so it
 * reads true on every tier, a "Different color" card included.
 */
export function describeSet(p: DerivedProduct): string {
  const m = metaFor(p);
  const head = ["A", lower(m.finish), lower(m.length), lower(m.shape), "set"].filter(Boolean).join(" ");
  const names = p.colorNames.filter((c) => c !== "multicolor");
  const colors = p.colorNames.includes("multicolor") || names.length > 3 ? "mixed colors" : joinAnd(names);
  const detail = p.isFrench
    ? "French tips"
    : p.isOmbre
      ? "an ombre fade"
      : p.is3d
        ? "3D details"
        : p.hasGlitter
          ? "glitter"
          : p.hasPattern
            ? "a pattern"
            : null;
  const lines = [
    colors && detail ? `${head} in ${colors} with ${detail}.` : null,
    colors ? `${head} in ${colors}.` : null,
    `${head}.`,
  ].filter((l): l is string => Boolean(l));
  return lines.find((l) => wordCount(l) <= MAX_REASON_WORDS) ?? lines[lines.length - 1];
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
// v6.1 item 15: a reason describes the set; it never parrots the answers
// back ("as asked", "like you asked", "the nudes you picked").
const ANSWER_ECHO = /\b(as|like) (you )?(asked|picked|chose|wanted|requested|said)\b|\byou (picked|chose|asked for|wanted|requested|selected)\b/i;

/**
 * Hard constraints on a ranker reason: one short sentence, no hedging, no
 * echo of the answers, and every length, shape, finish, color, drama, vibe
 * or design word it uses must be true of this set (a vibe only where
 * claimableVibes allows it). Anything else is swapped for describeSet.
 */
export function reasonIsValid(reason: unknown, p: DerivedProduct): reason is string {
  if (typeof reason !== "string") return false;
  const full = reason.trim();
  if (!full || wordCount(full) > MAX_REASON_WORDS || BANNED_HEDGES.test(full) || ANSWER_ECHO.test(full)) return false;
  // One sentence: nothing after a full stop.
  if (/[.!?]\s+\S/.test(full)) return false;
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
  /** Fix spec v4 full-match branching, plus the v6.1 rules in full.hard
   * (see FullBranching). */
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
 *   hard       logic v6.1 (HardBranchRules, hardVisibleBits). A widget
 *              deployed before v6.1 ignores it and keeps min / threshold /
 *              thresholdColumns (the v4 rules); a v6.1 widget uses only
 *              this, with the same rows, columns and questions.
 */
export interface FullBranching {
  min: number;
  threshold: number;
  thresholdColumns: FullColumn[];
  anyIfEmpty: FullColumn[];
  columns: FullColumn[];
  questions: FullBranchQuestion[];
  rows: number[][];
  hard?: HardBranchRules;
}

/**
 * Logic v6.1 option visibility. Vibe and drama answers never narrow it.
 *   filterColumns  earlier answers that narrow the count: the hard ones
 *                  (length, shape, color, finish)
 *   keepColumns    never broken in results (length, shape): an option of
 *                  these needs `threshold` sets on the path of earlier
 *                  answers to them, so six can always be filled
 *   threshold      spec.threshold (6)
 *   minOptions     any other step shows each option with at least one set
 *                  on the filter path, then tops up to this many (3) with
 *                  the options that have the most sets on the keep path;
 *                  an option with no set on the keep path never shows
 * A step is skipped only with nothing to show (Shape after Super Short
 * alone: a super short set has no shape), and nothing is ever recorded
 * for the shopper.
 */
export interface HardBranchRules {
  filterColumns: FullColumn[];
  keepColumns: FullColumn[];
  threshold: number;
  minOptions: number;
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
    hard: {
      filterColumns: ["length", "shape", "color", "finish"],
      keepColumns: ["length", "shape"],
      threshold: spec.threshold,
      minOptions: COLUMNAR_DEFAULTS.minOptions,
    },
  };
}

const uniqueBits = (values: Record<string, number>): number[] =>
  [...new Set(Object.values(values))].sort((a, b) => a - b);

/**
 * Fix spec v4 (what widgets deployed before v6.1 run): bits of question
 * qi's options to show, given the answers before it: answers[j] is the bit
 * mask of question j's picks (0 = open: surprise, skipped or unanswered).
 * Such a widget skips a question with fewer than two left and records a
 * lone one for the shopper.
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

/**
 * Logic v6.1: bits of question qi's options to show, given the answers
 * before it (as for fullVisibleBits). The widget runs the same algorithm
 * (hardVisibleBits in gleame-quiz.js; widget-columnar.test.ts lifts it out
 * and compares the two on the real pool). [] without b.hard.
 */
export function hardVisibleBits(b: FullBranching, qi: number, answers: ReadonlyArray<number | null | undefined>): number[] {
  const h = b.hard;
  const q = b.questions[qi];
  if (!h || !q) return [];
  const col = (name: FullColumn) => b.columns.indexOf(name);
  const empty = b.anyIfEmpty.map(col);
  const passes = (row: number[], c: number, mask: number) =>
    !mask || (row[c] & mask) !== 0 || (row[c] === 0 && empty.includes(c));
  const filterConds: Array<[number, number]> = [];
  const keepConds: Array<[number, number]> = [];
  for (let j = 0; j < qi && j < b.questions.length; j++) {
    const m = answers[j] || 0;
    const c = col(b.questions[j].column);
    if (!m || c < 0) continue;
    if (h.filterColumns.includes(b.questions[j].column)) filterConds.push([c, m]);
    if (h.keepColumns.includes(b.questions[j].column)) keepConds.push([c, m]);
  }
  const ci = col(q.column);
  if (ci < 0) return [];
  const filtered = b.rows.filter((r) => filterConds.every(([c, m]) => passes(r, c, m)));
  const kept = b.rows.filter((r) => keepConds.every(([c, m]) => passes(r, c, m)));
  const count = (rows: number[][], bit: number) => {
    let n = 0;
    for (const r of rows) if ((r[ci] & (1 << bit)) !== 0) n++;
    return n;
  };
  const isKeep = h.keepColumns.includes(q.column);
  const bits = uniqueBits(q.values);
  const out = bits.filter((bit) => (isKeep ? count(kept, bit) >= h.threshold : count(filtered, bit) >= 1));
  if (!isKeep && out.length < h.minOptions) {
    const extra = bits
      .filter((bit) => !out.includes(bit))
      .map((bit) => [bit, count(kept, bit)])
      .filter(([, n]) => n >= 1)
      .sort((x, y) => y[1] - x[1] || x[0] - y[0])
      .slice(0, h.minOptions - out.length);
    for (const [bit] of extra) out.push(bit);
    out.sort((x, y) => x - y);
  }
  return out;
}

/** An answer as fullVisibleBits / hardVisibleBits take it: its picks' bits
 * for the question's column, 0 for surprise / skipped. */
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
 * whether it is skipped (nothing visible; v6.1 never records a lone option
 * for the shopper, it shows it). */
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
  return { counts, visible, skipped: visible.length === 0 };
}

export interface HiddenLogEntry {
  /** Answer IDs chosen so far, e.g. ["short"] or ["short", "almond"]. */
  path: string[];
  question: "shape" | "finish";
  /** Nothing left: the question is skipped. */
  skipped: boolean;
  /** Always null since v6.1: a lone option is shown, never recorded. */
  autoAnswer: string | null;
  hidden: Array<{ id: string; count: number }>;
}

/**
 * What v6.1 hides on each single-length path before any color is picked:
 * shapes under the threshold, then per shown shape (or after a skipped
 * shape) the finishes with no set at all. Color picks can narrow the
 * finish step further. Studio shows this so Lisa can see why a tile
 * didn't appear.
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
    autoAnswer: null,
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
      }
    }
    if (!finishes.length) continue;
    for (const sp of shapePaths) {
      // A finish shows with any set on the path (color and the fallback
      // tiers take it from there).
      const fv = branchVisibility(rows, 1, "finish", finishes, sp.prior);
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

// ---- Assembly: tiers + Step D picks (or fallback) + copy ----

export interface AssembledItem {
  product: DerivedProduct;
  /** The one-line why: the ranker's when it passes reasonIsValid, else
   * describeSet. */
  reason: string;
  meta: { length: string; shape: string; finish: string };
  /** What the set steps outside of (v6.1); "perfect" for none. */
  tier: TierId;
}

export interface AssembledColumnar {
  /** Analytics: 1 = every shown set is a perfect match; 2 = some step
   * outside vibe or drama only; 3 = some show another color; 4 = some show
   * another finish; 5 = fewer than resultCount shown. */
  rung: Rung;
  /** Perfect matches in the pool for these answers (shown or not). */
  exactCount: number;
  header: HeaderCopy;
  /** Widgets before v6.1: "Best match" on the first card when it is a
   * perfect match. A v6.1 widget badges every perfect card instead. */
  bestMatchBadge: boolean;
  results: AssembledItem[];
  alsoMatched: AssembledItem[];
  loosen: "finish" | "shape" | "color" | null;
  /** True when the ranker's order was used (false = Step C fallback). */
  ranked: boolean;
}

/** The rung (analytics) of a shown result. */
export function rungOf(tiers: TierId[], resultCount: number): Rung {
  if (tiers.length < resultCount) return 5;
  if (tiers.some((t) => t === "finish" || t === "color_finish")) return 4;
  if (tiers.includes("color")) return 3;
  return tiers.every((t) => t === "perfect") ? 1 : 2;
}

/**
 * Everything after Step D, pure: the six from the tiers (the ranker's
 * order inside each tier when it is valid, else Step C's), its reasons
 * where they pass the copy rules (else describeSet), the tier of each,
 * and the header.
 */
export function assembleColumnar(
  ladder: LadderResult,
  answers: ColumnarAnswers,
  spec: Pick<ColumnarSpec, "resultCount" | "alsoMatchedCount" | "candidateCount" | "vibes">,
  _labels: AnswerLabels,
  ranked?: { ids: string[]; reasons: Record<string, string> } | null,
): AssembledColumnar {
  const { results, alsoMatched, usedRanker } = selectResults(ladder, spec, ranked?.ids ?? null, answers);
  const item = (p: DerivedProduct, llmReason: string | undefined): AssembledItem => ({
    product: p,
    reason: usedRanker && reasonIsValid(llmReason, p) ? llmReason.trim() : describeSet(p),
    meta: metaFor(p),
    tier: ladder.tierIds.get(p.id) ?? "color_finish",
  });
  const items = results.map((p) => item(p, ranked?.reasons[p.id]));
  const perfect = items.filter((i) => i.tier === "perfect").length;
  return {
    rung: rungOf(
      items.map((i) => i.tier),
      spec.resultCount,
    ),
    exactCount: ladder.exactCount,
    header: headerFor(perfect, items.length, spec.resultCount),
    bestMatchBadge: items.length > 0 && items[0].tier === "perfect",
    results: items,
    alsoMatched: alsoMatched.map((p) => item(p, undefined)),
    loosen: results.length === 0 ? ladder.loosen : null,
    ranked: usedRanker,
  };
}
