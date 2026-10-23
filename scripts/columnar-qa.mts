/**
 * Columnar engine QA (Glamnetic recommendation logic v3, brief section 9,
 * fix spec v4, logic v6.1).
 *
 * Runs against the Oct 17 fixture pool and the live quiz's questions
 * (Oct 21) with no network: the Step D ranker is stubbed with its
 * deterministic fallback (Step C's order), which is exactly what shoppers
 * get when the LLM times out. Prints:
 *   1. derivation vs Aaron's attribute export, per column, with every
 *      disagreement class
 *   2. the excluded products (the brief's eight missing a core tag)
 *   3. the section 6 tables, the Studio hidden-options log, the branching
 *      payload and the v6.1 visibility checks; the Alternative & Edgy rule
 *      change (item 18) and every set whose rule vibes moved
 *   4. the section 9 matrix under v6.1
 *   5. the v6.1 walk: EVERY answer path the widget can show (unions
 *      included), with the checklist metrics; the full pipeline (every
 *      checklist item on the six) on every single-pick path and on every
 *      Nth union path
 *   6. simulated shoppers, v4 visibility vs v6.1 (the v4 results numbers
 *      come from the 4c48248 run kept beside this output)
 *   7. a hostile ranker on every single-pick path: it reverses the
 *      candidates and writes false or echoing reasons; the tiers, the
 *      checklist rules and the copy must still hold
 *
 * The walk follows the widget question by question with hardVisibleBits
 * (the server twin of the widget's check; the vitest suite runs both on
 * this pool). At each question it takes every answer the widget accepts:
 * with nothing shown the step is skipped (open); otherwise every non-empty
 * union of shown options up to the question's max selections (vibe is
 * single-select; length and shape have no max; color 3, finish 2, drama
 * 2), plus "open" where the question has a select-all option. A lone
 * option is never recorded for the shopper (v6.1 item 6).
 *
 * Run: npx tsx scripts/columnar-qa.mts [--sample=N] [--live]
 *   --sample=N  full pipeline on every Nth union path (default 400); the
 *               single-pick paths and the visibility metrics always cover
 *               every path
 *   --live      read-only: the live Glamnetic spec, pool and quiz from the
 *               database instead of the fixtures (needs --env-file=.env).
 *               Sections 1, 2 and 4 are fixture checks and are skipped.
 */

import {
  deriveProduct,
  splitPool,
  vibeMatches,
  vibeRule,
  type DerivedProduct,
  type PoolProductInput,
} from "../app/lib/columnar/attributes";
import {
  HEADER_TEXT,
  TIER_IDS,
  assembleColumnar,
  branchingRows,
  buildBranching,
  cappedCollections,
  countRows,
  criteriaToAnswers,
  decodeResultKey,
  encodeResultKey,
  fullAnswerMask,
  fullVisibleBits,
  hardVisibleBits,
  hiddenOptionsLog,
  labelsFromFlow,
  rankerCandidates,
  reasonIsValid,
  runLadder,
  storewideCollections,
  type ColumnarAnswers,
  type FullBranching,
  type TierId,
} from "../app/lib/columnar/pipeline";
import {
  COLUMNAR_DEFAULTS,
  DEFAULT_ANSWER_LABELS,
  ROLE_VOCAB,
  VIBE_IDS,
  sanitizeColumnarSpec,
  type ColumnarRole,
  type ColumnarSpec,
} from "../app/lib/columnar/spec";
import {
  glamneticSpec,
  loadAttributeExport,
  loadGlamneticFlow,
  loadGlamneticPool,
  MISSING_CORE_TAG,
  type FixtureFlowQuestion,
} from "../app/lib/__tests__/fixtures/glamnetic-columnar";

const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE = Math.max(1, Number(sampleArg?.split("=")[1]) || 400);
const LIVE = process.argv.includes("--live");

let failures = 0;
const fail = (ok: boolean) => {
  if (!ok) failures++;
  return ok ? "PASS" : "FAIL";
};

// ---------------------------------------------------------------------
// Inputs: the fixtures, or (--live) a read-only read of production
// ---------------------------------------------------------------------
let spec: ColumnarSpec;
let flow: FixtureFlowQuestion[];
let inputs: PoolProductInput[];
if (LIVE) {
  const SHOP_DOMAIN = "glamrco.myshopify.com";
  const SHOP_ID = "8121d154-2019-490f-9343-7bddbc1a64be";
  const { supabase, getRecommendationFlow } = await import("../app/lib/supabase.server");
  const { data: cfg, error } = await supabase
    .from("chat_assistant_config")
    .select("recommendation_tuning")
    .eq("shop_domain", SHOP_DOMAIN)
    .maybeSingle();
  if (error) throw error;
  spec = sanitizeColumnarSpec((cfg?.recommendation_tuning as Record<string, unknown> | null)?.columnar)!;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < spec.pool.handles.length; i += 100) {
    const { data, error: e } = await supabase
      .from("products")
      .select("id, shopify_id, handle, product_name, status, product_type, tags, price")
      .eq("shop_id", SHOP_ID)
      .in("handle", spec.pool.handles.slice(i, i + 100));
    if (e) throw e;
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  const byHandle = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const prev = byHandle.get(String(r.handle));
    if (!prev || (prev.status !== "active" && r.status === "active")) byHandle.set(String(r.handle), r);
  }
  inputs = [...byHandle.values()].map((r) => ({
    id: String(r.id),
    shopifyId: String(r.shopify_id ?? ""),
    handle: String(r.handle),
    title: String(r.product_name ?? r.handle),
    productType: typeof r.product_type === "string" ? r.product_type : null,
    status: typeof r.status === "string" ? r.status : null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    price: r.price == null ? null : Number(r.price),
    imageUrl: null,
  }));
  const live = await getRecommendationFlow(SHOP_ID);
  flow = live!.questions.map((q) => ({
    axisKey: q.axisKey,
    prompt: q.prompt ?? null,
    multiSelect: Boolean(q.multiSelect),
    maxSelections: q.maxSelections ?? null,
    options: q.options.map((o) => ({ label: o.label, axisValue: o.axisValue, selectAll: Boolean(o.selectAll) })),
  }));
  console.log(`LIVE (read-only): ${inputs.length} pool rows, ${Object.keys(spec.vibeLabels).length} approved vibe labels, ${flow.length} questions`);
} else {
  spec = glamneticSpec();
  flow = loadGlamneticFlow();
  inputs = loadGlamneticPool();
}
const labels = labelsFromFlow(spec, flow);
const derived = inputs.map((p) => deriveProduct(p, { holidayCollections: spec.holidayCollections, vibeLabels: spec.vibeLabels }));
const { eligible, excluded } = splitPool(derived);
const byHandle = new Map(derived.map((p) => [p.handle, p]));

if (!LIVE) {
  // -------------------------------------------------------------------
  // 1. Derivation vs the export
  // -------------------------------------------------------------------
  console.log("\n=== 1. Attribute derivation vs pool-attributes-v3.csv ===");
  const csv = loadAttributeExport();
  const norm = (v: string) => (v ? v.split("|").map((x) => x.trim()).sort().join("|") : "");
  const ours: Record<string, (p: DerivedProduct) => string> = {
    length: (p) => p.length ?? "",
    shape: (p) => p.shape ?? "",
    color_families: (p) => p.colors.slice().sort().join("|"),
    finish: (p) => p.finish ?? "",
    is_french: (p) => (p.isFrench ? "True" : "False"),
    is_ombre: (p) => (p.isOmbre ? "True" : "False"),
    is_3d: (p) => (p.is3d ? "True" : "False"),
    has_glitter: (p) => (p.hasGlitter ? "True" : "False"),
    has_pattern: (p) => (p.hasPattern ? "True" : "False"),
    is_solid: (p) => (p.isSolid ? "True" : "False"),
    is_chrome: (p) => (p.isChrome ? "True" : "False"),
    drama: (p) => p.drama.slice().sort().join("|"),
    holiday: (p) => (p.holiday ? "True" : "False"),
  };
  for (const [col, get] of Object.entries(ours)) {
    let agree = 0;
    const classes = new Map<string, string[]>();
    for (const row of csv) {
      const p = byHandle.get(row.handle);
      if (!p) {
        const k = "handle missing from pool";
        classes.set(k, [...(classes.get(k) ?? []), row.handle]);
        continue;
      }
      const a = norm(get(p));
      const b = norm(row[col] ?? "");
      if (a === b) agree++;
      else {
        const k = `export "${b}" vs derived "${a}"`;
        classes.set(k, [...(classes.get(k) ?? []), row.handle]);
      }
    }
    console.log(`${col.padEnd(15)} ${agree}/${csv.length} (${((agree / csv.length) * 100).toFixed(1)}%)`);
    for (const [k, handles] of classes) console.log(`    ${k}: ${handles.length} [${handles.slice(0, 4).join(", ")}${handles.length > 4 ? ", ..." : ""}]`);
  }
  // The export ignored the catalog's lowercase "_Nail collection_" tag (5
  // sets in "Snow Place Like Home"); the derivation reads it, which is the
  // only holiday disagreement.
  const lowercaseTag = derived.filter((p) => p.collections.includes("Snow Place Like Home")).map((p) => p.handle);
  console.log(`sets tagged "_Nail collection_Snow Place Like Home" (lowercase c): ${lowercaseTag.length}`);

  // -------------------------------------------------------------------
  // 2. Exclusions
  // -------------------------------------------------------------------
  console.log("\n=== 2. Excluded from matching ===");
  console.log(`pool ${derived.length}, eligible ${eligible.length}, excluded ${excluded.length}`);
  for (const e of excluded) console.log(`    ${e.handle}: ${e.reasons.join(", ")}`);
  const excludedSet = new Set(excluded.map((e) => e.handle));
  const expected = Object.keys(MISSING_CORE_TAG);
  const exclusionOk = expected.every((h) => excludedSet.has(h)) && excluded.length === expected.length;
  console.log(`brief's 8 missing-core-tag products excluded (and nothing else): ${fail(exclusionOk)}`);
}

// ---------------------------------------------------------------------
// 3. Branching tables, payload, visibility checks, vibe rule change
// ---------------------------------------------------------------------
console.log("\n=== 3. Branching (section 6, logic v6.1) ===");
const allRows: Array<[string, string, string]> = derived
  .filter((p) => p.length && p.shape)
  .map((p) => [p.length!, p.shape!, p.finish ?? ""]);
const shapeIds = ["almond", "coffin", "oval", "round", "squoval", "square", "super_short"];
for (const lens of [["super_short"], ["short"], ["medium"], ["short", "medium"]]) {
  const prior = [{ column: "length" as const, values: lens }];
  const total = derived.filter((p) => p.length && lens.includes(p.length)).length;
  const counts = shapeIds.map((s) => `${s} ${countRows(allRows, "shape", s, prior)}`).join(" · ");
  console.log(`${lens.join("+").padEnd(12)} export-equivalent: ${total} products | ${counts}`);
}
const finishIds = ["glossy", "velvet_cateye", "glazed_pearl", "chrome", "matte"];
const lengthRows: Array<[string, string, string]> = derived
  .filter((p) => p.length)
  .map((p) => [p.length!, p.shape ?? "", p.finish ?? ""]);
for (const len of ["super_short", "short", "medium"]) {
  const prior = [{ column: "length" as const, values: [len] }];
  console.log(`finish @ ${len.padEnd(11)} ${finishIds.map((f) => `${f} ${countRows(lengthRows, "finish", f, prior)}`).join(" · ")}`);
}
console.log(`eligible branching rows: ${branchingRows(eligible).length}`);
const block = buildBranching(spec, eligible, flow);
const full: FullBranching = block.full!;
console.log("Studio hidden-options log (v6.1, single-length paths, before colors):");
for (const e of hiddenOptionsLog(spec, block.pool.rows)) {
  const path = e.path.map((id) => DEFAULT_ANSWER_LABELS[id]).join(" > ");
  const hidden = e.hidden.map((h) => `${DEFAULT_ANSWER_LABELS[h.id]} (${h.count})`).join(", ") || "none";
  console.log(`    ${path.padEnd(22)} ${e.question.padEnd(6)} hidden: ${hidden}${e.skipped ? " [skipped]" : ""}`);
}
const bytes = JSON.stringify(block).length;
console.log(
  `payload: branching ${bytes} bytes (legacy rows ${JSON.stringify(block.pool).length}, full ${JSON.stringify(full).length}, hard rules ${JSON.stringify(full.hard).length}); ` +
    `v4 rules kept for widgets before v6.1: min ${full.min}, threshold ${full.threshold} on ${full.thresholdColumns.join("/")}`,
);
console.log(`v6.1 rules: ${JSON.stringify(full.hard)}`);
console.log(`questions: ${full.questions.map((q) => `${q.axisKey} (${q.column}${q.any ? ", has open" : ""})`).join(" > ")}`);

const Q = full.questions;
const idOf = (qi: number, bit: number) => ROLE_VOCAB[Q[qi].column][bit];
const idsOf = (qi: number, mask: number) => ROLE_VOCAB[Q[qi].column].filter((_, i) => mask & (1 << i));
const nameOfId = (id: string) => labels[id] ?? DEFAULT_ANSWER_LABELS[id] ?? id;
const qIndex = (role: ColumnarRole) => Q.findIndex((q) => q.column === role);
const lengthQ = qIndex("length");
const ssBit = 1 << ROLE_VOCAB.length.indexOf("super_short");
const maskOfIds = (role: ColumnarRole, ids: string[] | undefined) =>
  (ids ?? []).reduce((m, id) => m | (1 << ROLE_VOCAB[role].indexOf(id)), 0);
/** Visible answer IDs of a role's question after the given picks (v6.1). */
function visibleIds(role: ColumnarRole, prefix: Partial<Record<ColumnarRole, string[]>>): string[] {
  const qi = qIndex(role);
  const masks = Q.slice(0, qi).map((q) => maskOfIds(q.column, prefix[q.column]));
  return hardVisibleBits(full, qi, masks).map((b) => idOf(qi, b));
}

console.log("\nv6.1 visibility checks:");
const SIX = ["almond", "coffin", "oval", "round", "squoval", "square"];
const visChecks: Array<[string, boolean]> = [
  ["1. Shape is skipped when Super Short is the only length", visibleIds("shape", { length: ["super_short"] }).length === 0],
  ["1. ...and shows for Super Short + Short", visibleIds("shape", { length: ["super_short", "short"] }).length >= 3],
  ["4. Round + Squoval hidden when only Medium (0 sets)", !visibleIds("shape", { length: ["medium"] }).some((s) => s === "round" || s === "squoval")],
  ["4. Coffin + Square hidden when only Short (0 sets)", !visibleIds("shape", { length: ["short"] }).some((s) => s === "coffin" || s === "square")],
  ["All six shapes shown for Short + Medium", SIX.every((s) => visibleIds("shape", { length: ["short", "medium"] }).includes(s))],
  ["Square stays for Medium only (7 sets)", visibleIds("shape", { length: ["medium"] }).includes("square")],
  ["Vibe never narrows: Alt & Edgy + Super Short shows every color", visibleIds("color", { vibe: ["alt_edgy"], length: ["super_short"] }).length === ROLE_VOCAB.color.length],
  ["Every vibe tile shows at the first step", visibleIds("vibe", {}).length === VIBE_IDS.length],
];
for (const [name, ok] of visChecks) console.log(`   ${fail(ok)}  ${name}`);

// Item 18: the Alternative & Edgy collection rule no longer reads "dark"
// (a colorway name); every set whose rule vibes moved.
console.log("\nAlternative & Edgy rule (item 18): the brief's collection keywords were dark / fright / spells; v6.1 drops dark");
const oldAlt = (p: DerivedProduct) =>
  p.colors.includes("dark_moody") || p.collections.some((c) => ["dark", "fright", "spells"].some((k) => c.toLowerCase().includes(k)));
const moved = derived.filter((p) => p.vibeSource === "rules" && oldAlt(p) !== vibeRule(p, "alt_edgy"));
for (const p of moved) {
  console.log(
    `    ${oldAlt(p) ? "loses" : "gains"} Alternative & Edgy: ${p.handle} (${p.colors.join("+")}; ${p.collections.filter((c) => /dark/i.test(c)).join(", ")})${eligible.includes(p) ? "" : " [not matchable]"}`,
  );
}
const berry = derived.find((p) => p.handle === "berry-baby-super-short-press-on-nails");
console.log(`   ${fail(Boolean(berry) && !berry!.vibes.includes("alt_edgy"))}  Berry Baby is not Alternative & Edgy (vibes now: ${berry ? berry.vibes.join(", ") || "none" : "missing"})`);
console.log("vibe counts (eligible pool):");
for (const v of VIBE_IDS) console.log(`    ${v.padEnd(15)} ${eligible.filter((p) => vibeMatches(p, v)).length}`);

// ---------------------------------------------------------------------
// Shared checks, written apart from the pipeline so they don't restate it
// ---------------------------------------------------------------------
const picked = (a: unknown) => (Array.isArray(a) && a.length ? (a as string[]) : null);
function roleOk(p: DerivedProduct, role: ColumnarRole, ids: string[] | null): boolean {
  if (!ids) return true;
  switch (role) {
    case "vibe":
      return ids.some((v) => vibeMatches(p, v));
    case "length":
      return Boolean(p.length) && ids.includes(p.length!);
    case "shape":
      // A super short set has no shape; Super Short must be a picked length.
      return (p.shape === "super_short" && p.length === "super_short") || (Boolean(p.shape) && ids.includes(p.shape!));
    case "color":
      return p.colors.some((c) => ids.includes(c));
    case "finish":
      return Boolean(p.finish) && ids.includes(p.finish!);
    case "drama":
      return p.drama.some((d) => ids.includes(d));
  }
}
const keepOk = (p: DerivedProduct, a: ColumnarAnswers) => roleOk(p, "length", picked(a.length)) && roleOk(p, "shape", picked(a.shape));
/** The tier a set belongs in, by item 9's definitions. */
function expectedTier(p: DerivedProduct, a: ColumnarAnswers): TierId {
  const c = roleOk(p, "color", picked(a.color));
  const f = roleOk(p, "finish", picked(a.finish));
  if (!c) return f ? "color" : "color_finish";
  if (!f) return "finish";
  const v = roleOk(p, "vibe", picked(a.vibe));
  const d = roleOk(p, "drama", picked(a.drama));
  if (v && d) return "perfect";
  if (!v && !d) return "vibe_drama";
  return v ? "drama" : "vibe";
}
/** Item 9's order; French Girl Chic (Lisa's gate) puts drama before vibe. */
function rankOf(t: TierId, a: ColumnarAnswers): number {
  const french = picked(a.vibe)?.[0] === "french_girl";
  if (french && t === "vibe") return 3;
  if (french && t === "drama") return 2;
  return TIER_IDS.indexOf(t) + 1;
}
const ECHO = /\b(as|like) (you )?(asked|picked|chose|wanted|requested|said)\b|\byou (picked|chose|asked for|wanted|requested|selected)\b/i;
const CAP = COLUMNAR_DEFAULTS.collectionCap;
const storewide = storewideCollections(eligible);
console.log(`\ncollections that don't count toward the cap (> ${COLUMNAR_DEFAULTS.storewideCollectionShare * 100}% of the pool): ${[...storewide].join(", ")}`);

type Out = ReturnType<typeof assembleColumnar>;
interface Verdict {
  issue: string | null;
  perfect: number;
  capRelaxed: boolean;
  displaced: boolean;
}
/** Every checklist rule on one result (items 7-15). */
function check(out: Out, a: ColumnarAnswers, ladder: ReturnType<typeof runLadder>, ranker = false): Verdict {
  const res = out.results;
  const perfect = res.filter((i) => i.tier === "perfect").length;
  const v: Verdict = { issue: null, perfect, capRelaxed: false, displaced: false };
  const say = (s: string) => (v.issue ??= s);
  // 7. Always exactly six (when length + shape hold six).
  const keep = eligible.filter((p) => keepOk(p, a));
  if (res.length !== Math.min(6, keep.length)) say(`7: ${res.length} results with ${keep.length} sets on length + shape`);
  // 11. Length and shape never broken.
  const broken = res.find((i) => !keepOk(i.product, a));
  if (broken) say(`11: ${broken.product.handle} breaks length / shape`);
  // 8-9. Tiers right, in order; perfect first.
  for (let k = 0; k < res.length; k++) {
    const t = expectedTier(res[k].product, a);
    if (res[k].tier !== t) say(`9: ${res[k].product.handle} labeled ${res[k].tier}, is ${t}`);
    if (k > 0 && rankOf(res[k].tier, a) < rankOf(res[k - 1].tier, a)) say(`9: ${res[k].tier} after ${res[k - 1].tier}`);
  }
  // A closer set left out while a farther one shows is fine only when the
  // cap or the Super Short rule made room (counted, not failed).
  const shownIds = new Set(res.map((i) => i.product.id));
  const worst = Math.max(0, ...res.map((i) => rankOf(i.tier, a)));
  const closerLeft = keep.find((p) => !shownIds.has(p.id) && rankOf(expectedTier(p, a), a) < worst);
  if (closerLeft) v.displaced = true;
  // 10. A color the shopper didn't pick only with the "Different color" label.
  const colors = picked(a.color);
  for (const i of res) {
    if (colors && !i.product.colors.some((c) => colors.includes(c)) && i.tier !== "color" && i.tier !== "color_finish") {
      say(`10: ${i.product.handle} is off-color without the label`);
    }
  }
  // 12. Header matches the count.
  const h = out.header;
  const wantText =
    res.length === 0
      ? HEADER_TEXT.none
      : perfect === res.length
        ? res.length === 6
          ? HEADER_TEXT.allSix
          : HEADER_TEXT.allFew
        : perfect > 0
          ? (perfect === 1 ? HEADER_TEXT.someOne : HEADER_TEXT.some).replace("{n}", String(perfect))
          : HEADER_TEXT.closest;
  if (h.text !== wantText || (res.length > 0 && h.perfect !== perfect)) say(`12: header "${h.text}" with ${perfect} perfect of ${res.length}`);
  // 13. Super Short + another length: at least two Super Short sets.
  const lens = picked(a.length);
  if (lens && lens.length > 1 && lens.includes("super_short")) {
    const want = Math.min(2, keep.filter((p) => p.length === "super_short").length);
    const have = res.filter((i) => i.product.length === "super_short").length;
    if (have < want) say(`13: ${have} Super Short sets (want ${want})`);
  }
  // 14. At most two from one collection, unless six can't be filled
  // otherwise (or the Super Short rule needs a set the cap would refuse).
  const per = new Map<string, number>();
  for (const i of res) for (const c of cappedCollections(i.product, storewide)) per.set(c, (per.get(c) ?? 0) + 1);
  const over = [...per.entries()].filter(([, n]) => n > CAP);
  if (over.length) {
    v.capRelaxed = true;
    const room = new Map<string, number>();
    let fits = 0;
    for (const p of keep) {
      const cs = cappedCollections(p, storewide);
      if (cs.every((c) => (room.get(c) ?? 0) < CAP)) {
        fits++;
        for (const c of cs) room.set(c, (room.get(c) ?? 0) + 1);
      }
    }
    const ssRule = Boolean(lens && lens.length > 1 && lens.includes("super_short"));
    if (fits >= res.length && !ssRule) say(`14: ${over.map(([c, n]) => `${c} x${n}`).join(", ")} with ${fits} sets that fit the cap`);
  }
  // 15. Why-lines: one true sentence about the set, no echo.
  for (const i of res) {
    const r = i.reason;
    if (!r || /[.!?]\s+\S/.test(r) || ECHO.test(r) || r.split(/\s+/).length > 14) say(`15: "${r}" (${i.product.handle})`);
    else if (!reasonIsValid(r, i.product)) say(`15: "${r}" is not true of ${i.product.handle}`);
    else if (!ranker && !/^A /.test(r)) say(`15: "${r}" is not the set description`);
  }
  // Pipeline agrees with the walk on the perfect count.
  const exact = keep.filter((p) => expectedTier(p, a) === "perfect").length;
  if (ladder.exactCount !== exact) say(`perfect count: pipeline ${ladder.exactCount}, walk ${exact}`);
  return v;
}

// ---------------------------------------------------------------------
// 4. QA matrix (section 9) under v6.1
// ---------------------------------------------------------------------
const run = (criteria: Record<string, string | string[]>) => {
  const answers = criteriaToAnswers(criteria, spec);
  const ladder = runLadder(eligible, answers, spec);
  const out = assembleColumnar(ladder, answers, spec, labels, null);
  return { answers, ladder, out, key: encodeResultKey(answers) };
};
/** Can the live quiz reach these answers under v6.1? null = yes. */
function reach(a: ColumnarAnswers): string | null {
  const masks: number[] = [];
  for (let qi = 0; qi < Q.length; qi++) {
    const q = Q[qi];
    const vis = hardVisibleBits(full, qi, masks);
    const raw = a[q.column];
    const want = fullAnswerMask(q, raw);
    if (vis.length === 0) {
      if (want) return `${q.axisKey}: skipped, ${idsOf(qi, want).join(", ")} can't be picked`;
      masks.push(0);
      continue;
    }
    if (!want) {
      if (!q.any) return `${q.axisKey}: the live quiz has no open option here`;
      masks.push(0);
      continue;
    }
    const hidden = idsOf(qi, want).filter((id) => !vis.includes(ROLE_VOCAB[q.column].indexOf(id)));
    if (hidden.length) return `${q.axisKey}: ${hidden.map(nameOfId).join(", ")} hidden (shown: ${vis.map((b) => nameOfId(idOf(qi, b))).join(", ")})`;
    masks.push(want);
  }
  return null;
}
function fmt(p: DerivedProduct, tier: string) {
  return `${tier.padEnd(12)} ${p.handle.padEnd(48)} ${String(p.length).padEnd(11)} ${String(p.shape).padEnd(11)} ${String(p.finish).padEnd(13)} ${p.colors.join("+")}`;
}
if (!LIVE) {
  console.log("\n=== 4. QA matrix (section 9) under v6.1, ranker stubbed with the Step C fallback ===");
  type Row = {
    n: number;
    label: string;
    criteria: Record<string, string | string[]>;
    expect: string;
    /** Item 4: an option with no set on the path never shows, so the live
     * quiz can't post this; the engine still answers a forged post. */
    unreachable?: string;
    check?: (r: ReturnType<typeof run>) => string | null;
  };
  const rows: Row[] = [
    { n: 1, label: "Alt & Edgy · Super Short · (skipped) · Pinks & purples · Glossy · A little extra", criteria: { vibe: "option_7", length: ["super_short"], color_family: ["pinks_pastels"], question_6: ["option_1"], style_tier: ["extra"] }, expect: "reachable now (v4 skipped 4 steps); 6 super short sets, the pink glossy ones first" },
    { n: 2, label: "French Girl · Short · Almond · Nudes · Glossy · Clean & classic", criteria: { vibe: "french_girl", length: ["short"], shape: ["almond"], color_family: ["nudes_neutrals"], question_6: ["option_1"], style_tier: ["clean"] }, expect: "6 perfect French tip / ombre nude sets", check: (r) => (r.out.results.every((i) => i.tier === "perfect") ? null : "not all perfect") },
    { n: 3, label: "French Girl · Medium · Coffin · Dark & moody · Matte · Full art", criteria: { vibe: "french_girl", length: ["medium"], shape: ["coffin"], color_family: ["dark_moody"], question_6: ["option_5"], style_tier: ["art"] }, expect: "6 medium coffin sets, closest first, each labeled", unreachable: "Matte has no medium coffin set with a dark color" },
    { n: 4, label: "Holiday · Short · Oval · Reds & berries · Chrome · Statement", criteria: { vibe: "option_8", length: ["short"], shape: ["oval"], color_family: ["reds_berries"], question_6: ["option_4"], style_tier: ["statement"] }, expect: "6 short oval sets; any non-red labeled Different color" },
    { n: 5, label: "Clean Girl · Short+Medium · Almond+Oval · Nudes+White · Glossy+Glazed · Clean & classic", criteria: { vibe: "model_off_duty", length: ["short", "medium"], shape: ["almond", "oval"], color_family: ["nudes_neutrals", "white"], question_6: ["option_1", "option_2"], style_tier: ["clean"] }, expect: "6 perfect" },
    { n: 6, label: "Surprise · Super Short · (skipped) · Surprise · Surprise · Statement", criteria: { vibe: "_any", length: ["super_short"], color_family: ["_any"], question_6: ["_any"], style_tier: ["statement"] }, expect: "6 super short sets" },
    { n: 7, label: "Main Character · Medium · Square · Bold & bright · Glossy · Full art", criteria: { vibe: "main_character", length: ["medium"], shape: ["square"], color_family: ["bold_bright"], question_6: ["option_1"], style_tier: ["art"] }, expect: "6 of the 7 medium square sets, never another shape", unreachable: "no medium square set is bold & bright" },
    { n: 8, label: "Clean Girl · Short · (open) · Nudes · Glossy · Clean & classic (Aaron: v4 skipped Drama)", criteria: { vibe: "model_off_duty", length: ["short"], shape: ["_any"], color_family: ["nudes_neutrals"], question_6: ["option_1"], style_tier: ["clean"] }, expect: "Drama shows; 6 perfect" },
    {
      n: 9,
      label: "Holiday · Medium · Oval (v4 auto-picked Oval) · Reds · Glossy · A little extra",
      criteria: { vibe: "option_8", length: ["medium"], shape: ["oval"], color_family: ["reds_berries"], question_6: ["option_1"], style_tier: ["extra"] },
      expect: "Shape shows 4 options, so Oval is the shopper's tap",
      check: () => {
        const shapes = visibleIds("shape", { vibe: ["holiday"], length: ["medium"] });
        return shapes.length === 4 ? null : `shapes ${shapes.join(", ")}`;
      },
    },
    { n: 10, label: "Vacay · Super Short + Medium · Coffin · Oranges · Glossy · Statement", criteria: { vibe: "vacation", length: ["super_short", "medium"], shape: ["coffin"], color_family: ["oranges_yellows"], question_6: ["option_1"], style_tier: ["statement"] }, expect: "at least 2 Super Short sets (item 13)" },
  ];
  for (const row of rows) {
    const r = run(row.criteria);
    const roundTrip = JSON.stringify(decodeResultKey(r.key)) === JSON.stringify(r.answers);
    const reachable = reach(r.answers);
    const v = check(r.out, r.answers, r.ladder);
    console.log(`\n#${row.n} ${row.label}`);
    console.log(`   expect: ${row.expect}`);
    console.log(`   live quiz: ${reachable ? `unreachable (${reachable})${row.unreachable ? `, as item 4 wants: ${row.unreachable}` : ""}` : "reachable"}`);
    console.log(`   rung ${r.out.rung} · perfect in pool ${r.ladder.exactCount} · length+shape ${r.ladder.keepCount} · shown ${r.out.results.length} · header "${r.out.header.text}"`);
    for (const i of r.out.results) console.log(`     ${fmt(i.product, i.tier)}  why: ${i.reason}`);
    const why =
      v.issue ??
      (reachable && !row.unreachable ? `unreachable: ${reachable}` : null) ??
      (!reachable && row.unreachable ? "reachable, but the option has no set on this path" : null) ??
      row.check?.(r) ??
      (roundTrip ? null : "resultKey round trip");
    console.log(`   ${fail(!why)}${why ? `: ${why}` : ""}`);
  }
}

// ---------------------------------------------------------------------
// 5. The v6.1 walk: every path the widget can show
// ---------------------------------------------------------------------
console.log("\n=== 5. v6.1 walk: every answer path the widget can show ===");
const maxSel = Q.map((q) => {
  const fq = flow.find((f) => f.axisKey === q.axisKey)!;
  return fq.multiSelect ? fq.maxSelections ?? ROLE_VOCAB[q.column].length : 1;
});
function unions(bits: number[], max: number): number[] {
  const out: number[] = [];
  for (let m = 1; m < 1 << bits.length; m++) {
    let count = 0;
    let mask = 0;
    for (let i = 0; i < bits.length; i++) {
      if (m & (1 << i)) {
        count++;
        mask |= 1 << bits[i];
      }
    }
    if (count <= max) out.push(mask);
  }
  return out;
}
function answersOf(masks: number[], vis: number[][]): ColumnarAnswers {
  const a: ColumnarAnswers = {};
  masks.forEach((m, qi) => {
    if (m) a[Q[qi].column] = idsOf(qi, m);
    else if (vis[qi].length > 0 && Q[qi].any) a[Q[qi].column] = "surprise";
  });
  return a;
}
/** Why a step after Length shows fewer than three options. */
function fewReason(qi: number, masks: number[], vis: number[]): string {
  const col = Q[qi].column;
  if (vis.length === 0) return `${col}: skipped (Super Short alone has no shape)`;
  const h = full.hard!;
  if (h.keepColumns.includes(col)) return `${col}: only ${vis.length} with ${h.threshold}+ sets on this length`;
  return `${col}: only ${vis.length} with any set on this length / shape`;
}

type Tally = {
  paths: number;
  skipPaths: number;
  steps: number;
  fewSteps: number;
  fewWhy: Map<string, number>;
  finishLe2: number;
  checked: number;
  six: number;
  perfect3: number;
  perfectDist: number[];
  issues: number;
  capRelaxed: number;
  displaced: number;
  tierCounts: Map<string, number>;
  ss: number;
  ssOk: number;
  firstIssues: string[];
  /** 3+ shown sets with every answer but vibe / with the four filters. */
  drama3: number;
  filters3: number;
  /** 3+ perfect matches in the pool for the answers (shown or not). */
  avail3: number;
  /** Steps after Length the top-up filled (fewer than 3 had a set on the
   * full hard path), and paths where the shopper picked a topped-up one. */
  topUpSteps: number;
  pickedTopUp: number;
};
const mkTally = (): Tally => ({
  paths: 0,
  skipPaths: 0,
  steps: 0,
  fewSteps: 0,
  fewWhy: new Map(),
  finishLe2: 0,
  checked: 0,
  six: 0,
  perfect3: 0,
  perfectDist: [0, 0, 0, 0, 0, 0, 0],
  issues: 0,
  capRelaxed: 0,
  displaced: 0,
  tierCounts: new Map(),
  ss: 0,
  ssOk: 0,
  firstIssues: [],
  drama3: 0,
  filters3: 0,
  avail3: 0,
  topUpSteps: 0,
  pickedTopUp: 0,
});
/** The v6.1 rules without the top-up: options with a set on the full hard path. */
const strictFull: FullBranching = { ...full, hard: { ...full.hard!, minOptions: 0 } };
function runPath(t: Tally, a: ColumnarAnswers) {
  t.checked++;
  const ladder = runLadder(eligible, a, spec);
  const out = assembleColumnar(ladder, a, spec, labels, null);
  const v = check(out, a, ladder);
  if (out.results.length === 6) t.six++;
  if (v.perfect >= 3) t.perfect3++;
  if (out.results.filter((i) => i.tier === "perfect" || i.tier === "vibe").length >= 3) t.drama3++;
  if (out.results.filter((i) => i.tier !== "color" && i.tier !== "finish" && i.tier !== "color_finish").length >= 3) t.filters3++;
  if (ladder.exactCount >= 3) t.avail3++;
  t.perfectDist[Math.min(6, v.perfect)]++;
  if (v.capRelaxed) t.capRelaxed++;
  if (v.displaced) t.displaced++;
  for (const i of out.results) t.tierCounts.set(i.tier, (t.tierCounts.get(i.tier) ?? 0) + 1);
  const lens = picked(a.length);
  if (lens && lens.length > 1 && lens.includes("super_short")) {
    t.ss++;
    if (out.results.filter((i) => i.product.length === "super_short").length >= 2) t.ssOk++;
  }
  if (v.issue) {
    t.issues++;
    if (t.firstIssues.length < 10) t.firstIssues.push(`${encodeResultKey(a)}: ${v.issue}`);
  }
}
/** Visibility + (sampled) pipeline over every path. `single` = one option
 * (or open) per step, every such path through the pipeline. */
function walk(single: boolean, t: Tally, sampleEvery: number) {
  // Shared stacks (push / pop): the union walk runs to tens of millions of
  // leaves.
  const masks: number[] = [];
  const vis: number[][] = [];
  const few: string[] = [];
  const rec = (qi: number, skipped: boolean, finishFew: boolean, topUps: number, pickedTop: boolean) => {
    if (qi === Q.length) {
      t.paths++;
      if (skipped) t.skipPaths++;
      t.steps += Q.length - lengthQ - 1;
      t.fewSteps += few.length;
      t.topUpSteps += topUps;
      if (pickedTop) t.pickedTopUp++;
      for (const w of few) t.fewWhy.set(w, (t.fewWhy.get(w) ?? 0) + 1);
      if (finishFew) t.finishLe2++;
      if (t.paths % sampleEvery === 0) runPath(t, answersOf(masks, vis));
      return;
    }
    const q = Q[qi];
    const shown = hardVisibleBits(full, qi, masks);
    const ssOnly = q.column === "shape" && masks[lengthQ] === ssBit;
    const isSkip = shown.length === 0 && !ssOnly;
    const isFew = qi > lengthQ && shown.length < 3 && !ssOnly;
    const ff = q.column === "finish" && shown.length <= 2;
    const strict = qi > lengthQ ? hardVisibleBits(strictFull, qi, masks) : shown;
    const topped = strict.length < shown.length ? 1 : 0;
    const strictMask = strict.reduce((m, b) => m | (1 << b), 0);
    let choices: number[];
    if (shown.length === 0) choices = [0];
    else choices = [...(single ? shown.map((b) => 1 << b) : unions(shown, maxSel[qi])), ...(q.any ? [0] : [])];
    if (isFew) few.push(fewReason(qi, masks, shown));
    vis.push(shown);
    for (const mask of choices) {
      masks.push(mask);
      rec(qi + 1, skipped || isSkip, finishFew || ff, topUps + topped, pickedTop || (mask & ~strictMask) !== 0);
      masks.pop();
    }
    vis.pop();
    if (isFew) few.pop();
  };
  rec(0, false, false, 0, false);
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
function report(name: string, t: Tally) {
  console.log(`\n${name}: ${t.paths} paths; full pipeline on ${t.checked}`);
  console.log(`  any step skipped (Super-Short-only Shape excepted): ${t.skipPaths} (${pct(t.skipPaths, t.paths)})`);
  console.log(`  steps after Length with < 3 options: ${t.fewSteps}/${t.steps} (${pct(t.fewSteps, t.steps)})`);
  for (const [w, n] of [...t.fewWhy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)) console.log(`      ${n} x ${w}`);
  console.log(`  Finish step shows <= 2 finishes: ${pct(t.finishLe2, t.paths)}`);
  console.log(`  exactly 6 results: ${pct(t.six, t.checked)} · 3+ perfect matches: ${pct(t.perfect3, t.checked)}`);
  console.log(
    `  for scale: 3+ perfect in the pool ${pct(t.avail3, t.checked)} · 3+ shown matching all but vibe ${pct(t.drama3, t.checked)} · 3+ shown passing the four filters ${pct(t.filters3, t.checked)}`,
  );
  console.log(`  top-up: ${t.topUpSteps} steps filled up to three (${pct(t.topUpSteps, t.steps)} of steps after Length); paths with a topped-up option picked ${pct(t.pickedTopUp, t.paths)}`);
  console.log(`  perfect matches shown 0..6: ${t.perfectDist.map((n, i) => `${i}: ${pct(n, t.checked)}`).join(" · ")}`);
  console.log(`  tiers shown: ${[...t.tierCounts.entries()].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`  Super Short + another length: ${t.ssOk}/${t.ss} paths show 2+ Super Short sets`);
  console.log(`  collection cap relaxed to fill six: ${t.capRelaxed} · a closer set left out for the cap or Super Short rule: ${t.displaced}`);
  console.log(`  checklist violations (items 7-15): ${t.issues}`);
  for (const s of t.firstIssues) console.log(`    ISSUE ${s}`);
}
const started = Date.now();
const singles = mkTally();
walk(true, singles, 1);
report("single-pick paths (one option or open per step), all through the pipeline", singles);
const unionsT = mkTally();
walk(false, unionsT, SAMPLE);
report(`every path (unions included), pipeline on every ${SAMPLE}th`, unionsT);
console.log(`  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
const walkOk = singles.issues === 0 && unionsT.issues === 0 && singles.skipPaths === 0 && unionsT.skipPaths === 0;
console.log(`walk: ${fail(walkOk)}`);

// ---------------------------------------------------------------------
// 6. Simulated shoppers: v4 visibility vs v6.1
// ---------------------------------------------------------------------
console.log("\n=== 6. Simulated shoppers (20,000, seeded) ===");
console.log("model: at each step with options, open with p = 0.15 where the step has it, else 1 to min(3, max picks, shown) options, uniform");
function simulate(v6: boolean) {
  let seed = 20261022;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const N = 20000;
  const t = mkTally();
  let auto = 0;
  for (let s = 0; s < N; s++) {
    const masks: number[] = [];
    const vis: number[][] = [];
    const strictMasks: number[] = [];
    let sk = false;
    let au = false;
    let ff = false;
    for (let qi = 0; qi < Q.length; qi++) {
      const q = Q[qi];
      const shown = v6 ? hardVisibleBits(full, qi, masks) : fullVisibleBits(full, qi, masks);
      const ssOnly = q.column === "shape" && masks[lengthQ] === ssBit;
      // v4 skipped a step with fewer than two and recorded a lone option.
      const skipped = v6 ? shown.length === 0 : shown.length < 2;
      if (skipped && !ssOnly) sk = true;
      if (!v6 && shown.length === 1) au = true;
      if (qi > lengthQ && !ssOnly) {
        t.steps++;
        if (shown.length < 3 || (!v6 && shown.length < 2)) t.fewSteps++;
      }
      if (q.column === "finish" && shown.length <= 2) ff = true;
      if (v6 && qi > lengthQ) {
        const strict = hardVisibleBits(strictFull, qi, masks);
        if (strict.length < shown.length) t.topUpSteps++;
        strictMasks[qi] = strict.reduce((m, b) => m | (1 << b), 0);
      } else strictMasks[qi] = -1;
      let mask = 0;
      if (!v6 && shown.length === 1) mask = 1 << shown[0];
      else if (shown.length >= 1 && !(v6 ? false : shown.length < 2)) {
        if (q.any && rnd() < 0.15) mask = 0;
        else {
          const k = 1 + Math.floor(rnd() * Math.min(3, maxSel[qi], shown.length));
          const pool = shown.slice();
          for (let i = 0; i < k; i++) mask |= 1 << pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        }
      }
      masks.push(mask);
      vis.push(v6 || shown.length >= 2 ? shown : []);
    }
    t.paths++;
    if (sk) t.skipPaths++;
    if (au) auto++;
    if (ff) t.finishLe2++;
    if (masks.some((m, qi) => strictMasks[qi] >= 0 && (m & ~strictMasks[qi]) !== 0)) t.pickedTopUp++;
    if (v6) runPath(t, answersOf(masks, vis));
  }
  return { t, auto, N };
}
const v4sim = simulate(false);
console.log(
  `v4 visibility: step auto-skipped ${pct(v4sim.t.skipPaths, v4sim.N)} · answer auto-picked ${pct(v4sim.auto, v4sim.N)} · Finish shows <= 2 ${pct(v4sim.t.finishLe2, v4sim.N)} · steps after Length with < 3 options ${pct(v4sim.t.fewSteps, v4sim.t.steps)}`,
);
console.log("   (v4 results, from the 4c48248 run: 3+ perfect 100.0% · exactly 6 84.6%; see qa-v4-baseline-metrics.txt)");
const v6sim = simulate(true);
console.log(
  `v6.1:          step skipped ${pct(v6sim.t.skipPaths, v6sim.N)} · answer auto-picked 0.0% · Finish shows <= 2 ${pct(v6sim.t.finishLe2, v6sim.N)} · steps after Length with < 3 options ${pct(v6sim.t.fewSteps, v6sim.t.steps)} · 3+ perfect ${pct(v6sim.t.perfect3, v6sim.N)} · exactly 6 ${pct(v6sim.t.six, v6sim.N)} · violations ${v6sim.t.issues}`,
);
console.log(`   perfect matches shown 0..6: ${v6sim.t.perfectDist.map((n, i) => `${i}: ${pct(n, v6sim.N)}`).join(" · ")}`);
console.log(
  `   for scale: 3+ perfect in the pool ${pct(v6sim.t.avail3, v6sim.N)} · 3+ shown matching all but vibe ${pct(v6sim.t.drama3, v6sim.N)} · 3+ shown passing the four filters ${pct(v6sim.t.filters3, v6sim.N)} · ` +
    `shoppers who picked a topped-up option ${pct(v6sim.t.pickedTopUp, v6sim.N)} · Super Short + another length with 2+ Super Short ${v6sim.t.ssOk}/${v6sim.t.ss} · cap relaxed ${v6sim.t.capRelaxed}`,
);
for (const s of v6sim.t.firstIssues) console.log(`    ISSUE ${s}`);
console.log(`simulated shoppers: ${fail(v6sim.t.issues === 0 && v6sim.t.skipPaths === 0)}`);

// ---------------------------------------------------------------------
// 7. A hostile ranker
// ---------------------------------------------------------------------
console.log("\n=== 7. Hostile ranker: reversed candidates, false and echoing reasons, every single-pick path ===");
const FALSE_REASONS = [
  "A little extra, made for Vacay Mode.",
  "Full-on nail art in red, perfect for Holiday-Ready.",
  "Clean & classic medium coffin in black.",
  "Glossy and gorgeous, just like you asked.",
  "The nudes you picked, as asked.",
  "Statement chrome for your Main Character Energy.",
];
let hostileRuns = 0;
let hostileIssues = 0;
let kept = 0;
let replaced = 0;
const hostileFirst: string[] = [];
function hostileWalk(qi: number, masks: number[], vis: number[][]) {
  if (qi === Q.length) {
    hostileRuns++;
    const a = answersOf(masks, vis);
    const ladder = runLadder(eligible, a, spec);
    const candidates = rankerCandidates(ladder, spec, a);
    const n = Math.min(spec.resultCount, ladder.ordered.length);
    const ids = candidates.slice().reverse().slice(0, n).map((p) => p.id);
    const reasons = Object.fromEntries(candidates.map((p, i) => [p.id, FALSE_REASONS[i % FALSE_REASONS.length]]));
    const out = assembleColumnar(ladder, a, spec, labels, { ids, reasons });
    for (const i of out.results) {
      if (reasons[i.product.id] === i.reason) kept++;
      else replaced++;
    }
    const v = check(out, a, ladder, true);
    const issue = v.issue ?? (n > 0 && !out.ranked ? "a valid ranking was not used" : null);
    if (issue) {
      hostileIssues++;
      if (hostileFirst.length < 5) hostileFirst.push(`${encodeResultKey(a)}: ${issue}`);
    }
    return;
  }
  const q = Q[qi];
  const shown = hardVisibleBits(full, qi, masks);
  const choices = shown.length === 0 ? [0] : [...shown.map((b) => 1 << b), ...(q.any ? [0] : [])];
  for (const mask of choices) hostileWalk(qi + 1, [...masks, mask], [...vis, shown]);
}
hostileWalk(0, [], []);
console.log(`every single-pick path: ${hostileRuns} · issues ${hostileIssues} · ranker lines kept ${kept}, replaced ${replaced}`);
for (const s of hostileFirst) console.log(`    ISSUE ${s}`);
console.log(`hostile ranker: ${fail(hostileIssues === 0)}`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
