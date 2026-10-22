/**
 * Columnar engine QA (Glamnetic recommendation logic v3, brief section 9,
 * fix spec v4).
 *
 * Runs against the Oct 17 fixture pool and the live quiz's questions
 * (Oct 21) with no network: the Step D ranker is stubbed with its
 * deterministic fallback (the top of Step C), which is exactly what
 * shoppers get when the LLM times out. Prints:
 *   1. derivation vs Aaron's attribute export, per column, with every
 *      disagreement class
 *   2. the excluded products (the brief's eight missing a core tag)
 *   3. the section 6 tables, the legacy hidden-options log, the v4
 *      full-match block and the brief's "also verify" visibility checks
 *   4. the section 9 matrix under v4: whether the live quiz can still
 *      reach each row, rung, matches, the six handles, and what v3 did
 *   5. the v4 walk: EVERY answer path the widget can show (see below),
 *      each asserted to leave >= fullMatchMin sets matching every answer,
 *      with no hard-filter violation, the tiers in order and no false
 *      why-line
 *   6. a hostile ranker on a sample of paths: it reverses the candidates
 *      and writes false reasons; tiers and copy must still hold
 *
 * The walk (section 5) follows the widget question by question, using
 * fullVisibleBits (the server twin of the widget's check; the vitest
 * suite runs both on this pool). At each question it takes every answer
 * the widget can accept: with 0 options shown, the question is skipped
 * (open); with 1, that option is recorded; with 2 or more, every
 * non-empty union of shown options up to the question's max selections
 * (vibe is single-select; length and shape have no max; color 3, finish
 * 2, drama 2), plus "open" where the question has a select-all option.
 * That is every path, unions included: about 2.95M on the Oct 17 pool.
 *
 * Run: npx tsx scripts/columnar-qa.mts [--sample=N]
 *   --sample=N  run the full pipeline (ladder, picks, copy) on every Nth
 *               path instead of all of them; the >= fullMatchMin check
 *               always covers every path
 */

import { claimableVibes, deriveProduct, splitPool, vibeMatches, type DerivedProduct } from "../app/lib/columnar/attributes";
import {
  assembleColumnar,
  branchingRows,
  buildBranching,
  countRows,
  criteriaToAnswers,
  decodeResultKey,
  encodeResultKey,
  fullAnswerMask,
  fullVisibleBits,
  hiddenOptionsLog,
  labelsFromFlow,
  rankerCandidates,
  reasonIsValid,
  runLadder,
  type ColumnarAnswers,
  type FullBranching,
  type RoleAnswer,
} from "../app/lib/columnar/pipeline";
import { DEFAULT_ANSWER_LABELS, ROLE_VOCAB, VIBE_IDS, type ColumnarRole } from "../app/lib/columnar/spec";
import {
  glamneticSpec,
  loadAttributeExport,
  loadGlamneticFlow,
  loadGlamneticPool,
  MISSING_CORE_TAG,
} from "../app/lib/__tests__/fixtures/glamnetic-columnar";

const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE = Math.max(1, Number(sampleArg?.split("=")[1]) || 1);

let failures = 0;
const spec = glamneticSpec();
const flow = loadGlamneticFlow();
const labels = labelsFromFlow(spec, flow);
const inputs = loadGlamneticPool();
const derived = inputs.map((p) => deriveProduct(p, { holidayCollections: spec.holidayCollections, vibeLabels: spec.vibeLabels }));
const { eligible, excluded } = splitPool(derived);
const byHandle = new Map(derived.map((p) => [p.handle, p]));

// ---------------------------------------------------------------------
// 1. Derivation vs the export
// ---------------------------------------------------------------------
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
// The export ignored the catalog's lowercase "_Nail collection_" tag (5 sets
// in "Snow Place Like Home"); the derivation reads it, which is the only
// holiday disagreement.
const lowercaseTag = derived.filter((p) => p.collections.includes("Snow Place Like Home")).map((p) => p.handle);
console.log(`sets tagged "_Nail collection_Snow Place Like Home" (lowercase c): ${lowercaseTag.length}`);

// ---------------------------------------------------------------------
// 2. Exclusions
// ---------------------------------------------------------------------
console.log("\n=== 2. Excluded from matching ===");
console.log(`pool ${derived.length}, eligible ${eligible.length}, excluded ${excluded.length}`);
for (const e of excluded) console.log(`    ${e.handle}: ${e.reasons.join(", ")}`);
const excludedSet = new Set(excluded.map((e) => e.handle));
const expected = Object.keys(MISSING_CORE_TAG);
const exclusionOk = expected.every((h) => excludedSet.has(h)) && excluded.length === expected.length;
if (!exclusionOk) failures++;
console.log(`brief's 8 missing-core-tag products excluded (and nothing else): ${exclusionOk ? "PASS" : "FAIL"}`);

// ---------------------------------------------------------------------
// 3. Branching tables (section 6)
// ---------------------------------------------------------------------
console.log("\n=== 3. Branching (section 6) ===");
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
// The brief's finish table counts every length-tagged set (red-legacy has
// no shape tag but still counts as Super Short Glazed there).
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
console.log(`served rows (eligible): ${block.pool.rows.length}, threshold ${block.threshold}`);
console.log("legacy hidden-options log (threshold only, single-length paths):");
for (const e of hiddenOptionsLog(spec, block.pool.rows)) {
  const path = e.path.map((id) => DEFAULT_ANSWER_LABELS[id]).join(" > ");
  const hidden = e.hidden.map((h) => `${DEFAULT_ANSWER_LABELS[h.id]} (${h.count})`).join(", ") || "none";
  const skip = e.skipped ? (e.autoAnswer ? ` [skipped, auto-answer ${e.autoAnswer}]` : " [skipped]") : "";
  console.log(`    ${path.padEnd(22)} ${e.question.padEnd(6)} hidden: ${hidden}${skip}`);
}

console.log("\nvibe counts (eligible pool; brief's Oct 17 figure in brackets):");
const briefCounts: Record<string, string> = {
  french_girl: "165",
  main_character: "141",
  alt_edgy: "58",
  holiday: "70 by collection",
};
for (const v of VIBE_IDS) {
  const all = derived.filter((p) => vibeMatches(p, v)).length;
  const el = eligible.filter((p) => vibeMatches(p, v)).length;
  console.log(`    ${v.padEnd(15)} all ${String(all).padStart(3)} · eligible ${String(el).padStart(3)}${briefCounts[v] ? ` [${briefCounts[v]}]` : ""}`);
}
console.log(`    holiday by collection only: ${derived.filter((p) => p.holiday).length}`);
const labeled = eligible.filter((p) => p.vibeSource === "labels").length;
console.log(`    sets with approved vibe labels: ${labeled} of ${eligible.length} (the rest use the tag rules)`);

const legacyBytes = JSON.stringify({ ...block, full: undefined }).length;
console.log(
  `\nv4 full-match block: ${full.rows.length} rows, ${JSON.stringify(full).length} bytes (legacy part ${legacyBytes}), ` +
    `min ${full.min}, threshold ${full.threshold} on ${full.thresholdColumns.join("/")}`,
);
console.log(`questions: ${full.questions.map((q) => `${q.axisKey} (${q.column}${q.any ? ", has open" : ""})`).join(" > ")}`);

const idOf = (qi: number, bit: number) => ROLE_VOCAB[full.questions[qi].column][bit];
const nameOfId = (id: string) => labels[id] ?? DEFAULT_ANSWER_LABELS[id] ?? id;
const qIndex = (role: ColumnarRole) => full.questions.findIndex((q) => q.column === role);
/** Visible answer IDs of a role's question after the given picks (any role
 * not given is open). */
function visibleIds(role: ColumnarRole, prefix: Partial<Record<ColumnarRole, string[]>>): string[] {
  const qi = qIndex(role);
  const masks = full.questions.slice(0, qi).map((q) => fullAnswerMask(q, prefix[q.column]));
  return fullVisibleBits(full, qi, masks).map((b) => idOf(qi, b));
}

console.log("\nbrief 'also verify' under v4 branching (vibe left open):");
const SIX = ["almond", "coffin", "oval", "round", "squoval", "square"];
const alsoChecks: Array<[string, boolean]> = [
  ["Shape step skipped when only Super Short", visibleIds("shape", { length: ["super_short"] }).length < 2],
  ["Round + Squoval hidden when only Medium", !visibleIds("shape", { length: ["medium"] }).some((s) => s === "round" || s === "squoval")],
  ["Coffin + Square hidden when only Short", !visibleIds("shape", { length: ["short"] }).some((s) => s === "coffin" || s === "square")],
  ["All six shapes shown for Short + Medium", SIX.every((s) => visibleIds("shape", { length: ["short", "medium"] }).includes(s))],
  ["Square stays for Medium only (7 sets)", visibleIds("shape", { length: ["medium"] }).includes("square")],
  ["Matte hidden for Short (5 < 6)", !visibleIds("finish", { length: ["short"] }).includes("matte")],
  ["Every vibe tile shows at the first step", visibleIds("vibe", {}).length === VIBE_IDS.length],
];
for (const [name, ok] of alsoChecks) {
  if (!ok) failures++;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`   shapes after Super Short + Medium: ${visibleIds("shape", { length: ["super_short", "medium"] }).join(", ")}`);

// ---------------------------------------------------------------------
// Shared checks, written apart from the pipeline so they don't restate it
// ---------------------------------------------------------------------
const picked = (a: RoleAnswer | undefined) => (Array.isArray(a) && a.length ? a : null);
/** Does the set satisfy one answer? The v4 rules as the spec states them. */
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
const HARD: ColumnarRole[] = ["length", "shape", "finish", "color"];
const hardOk = (p: DerivedProduct, a: ColumnarAnswers) => HARD.every((r) => roleOk(p, r, picked(a[r])));
const fullOk = (p: DerivedProduct, a: ColumnarAnswers) =>
  hardOk(p, a) && roleOk(p, "vibe", picked(a.vibe)) && roleOk(p, "drama", picked(a.drama));
/** 1 = vibe and drama fit, then drama only, vibe only, neither (French
 * Girl Chic swaps the middle two). */
function closeness(p: DerivedProduct, a: ColumnarAnswers): number {
  const v = picked(a.vibe)?.[0] ?? null;
  const vibeOk = roleOk(p, "vibe", v ? [v] : null);
  const dramaOk = roleOk(p, "drama", picked(a.drama));
  if (vibeOk && dramaOk) return 1;
  if (v === "french_girl") return vibeOk ? 2 : dramaOk ? 3 : 4;
  return dramaOk ? 2 : vibeOk ? 3 : 4;
}
type Out = ReturnType<typeof assembleColumnar>;
function orderIssue(out: Out, a: ColumnarAnswers): string | null {
  const shown = [...out.results, ...out.alsoMatched];
  for (let i = 1; i < shown.length; i++) {
    if (closeness(shown[i].product, a) < closeness(shown[i - 1].product, a)) {
      return `${shown[i].product.handle} (closer) ranks behind ${shown[i - 1].product.handle}`;
    }
  }
  return null;
}
// Every answer label the copy could echo, longest first.
const LABELS: Array<[string, ColumnarRole, string]> = [];
for (const role of ["color", "drama", "vibe"] as const) {
  for (const id of ROLE_VOCAB[role]) {
    for (const l of new Set([labels[id], DEFAULT_ANSWER_LABELS[id]].filter(Boolean))) LABELS.push([l.toLowerCase(), role, id]);
  }
}
LABELS.sort((x, y) => y[0].length - x[0].length);
/** A false or unearned why-line. Templated lines (echo = true) may only
 * echo the shopper's own picks; a ranker's line only has to be true. */
function whyIssue(reason: string, p: DerivedProduct, a: ColumnarAnswers, echo: boolean): string | null {
  let text = reason.toLowerCase();
  for (const [l, role, id] of LABELS) {
    if (!text.includes(l)) continue;
    text = text.split(l).join(" ");
    if (echo && !picked(a[role])?.includes(id)) return `"${reason}" echoes ${role} "${l}" the shopper didn't pick (${p.handle})`;
    const has = role === "color" ? p.colors.includes(id) : role === "drama" ? p.drama.includes(id) : claimableVibes(p).includes(id);
    if (!has) return `"${reason}" claims ${role} "${l}" that ${p.handle} doesn't have`;
  }
  if (/french tips/i.test(reason) && !p.isFrench) return `"${reason}" claims French tips on ${p.handle}`;
  if (/soft ombre/i.test(reason) && !p.isOmbre) return `"${reason}" claims ombre on ${p.handle}`;
  const m = /exactly the (.+) you chose/.exec(reason);
  for (const role of (m?.[1].split(/, | and /) ?? []) as Array<"length" | "shape" | "finish">) {
    const have = p[role];
    if (!have || !picked(a[role])?.includes(have)) return `"${reason}" claims a ${role} pick on ${p.handle}`;
  }
  if (!reasonIsValid(reason, p)) return `"${reason}" fails reasonIsValid on ${p.handle}`;
  return null;
}
/** Everything a v4 result must hold, given its answers. */
function resultIssue(out: Out, a: ColumnarAnswers, ladder: ReturnType<typeof runLadder>, ranker = false): string | null {
  const shown = [...out.results, ...out.alsoMatched];
  const hard = shown.find((i) => !hardOk(i.product, a));
  if (hard) return `hard filter: ${hard.product.handle}`;
  const order = orderIssue(out, a);
  if (order) return order;
  for (const i of shown) {
    const why = whyIssue(i.reason, i.product, a, !ranker);
    if (why) return why;
  }
  // French Girl Chic stays a gate while it can fill the grid.
  if (picked(a.vibe)?.[0] === "french_girl" && eligible.filter((p) => hardOk(p, a) && vibeMatches(p, "french_girl")).length >= spec.resultCount) {
    const off = shown.find((i) => !vibeMatches(i.product, "french_girl"));
    if (off) return `French gate: ${off.product.handle}`;
  }
  if (out.results.length < Math.min(spec.resultCount, ladder.hardCount)) return `${out.results.length} results with ${ladder.hardCount} sets passing`;
  return null;
}

/** Can the live quiz reach these answers? null = yes, else why not. */
function reach(a: ColumnarAnswers): string | null {
  const masks: number[] = [];
  for (let qi = 0; qi < full.questions.length; qi++) {
    const q = full.questions[qi];
    const vis = fullVisibleBits(full, qi, masks);
    const want = fullAnswerMask(q, a[q.column]);
    const names = (bits: number[]) => bits.map((b) => nameOfId(idOf(qi, b))).join(", ");
    const wantBits = ROLE_VOCAB[q.column].map((_, i) => i).filter((i) => want & (1 << i));
    if (vis.length === 0) {
      if (want) return `${q.axisKey}: skipped (nothing left keeps ${full.min} full matches), ${names(wantBits)} can't be picked`;
      masks.push(0);
      continue;
    }
    if (vis.length === 1) {
      if (want !== 1 << vis[0]) return `${q.axisKey}: only ${names(vis)} is left (recorded for the shopper)`;
      masks.push(want);
      continue;
    }
    if (!want) {
      if (!q.any) return `${q.axisKey}: the live quiz has no open option here`;
      masks.push(0);
      continue;
    }
    const hidden = wantBits.filter((b) => !vis.includes(b));
    if (hidden.length) return `${q.axisKey}: ${names(hidden)} hidden (shown: ${names(vis)})`;
    masks.push(want);
  }
  return null;
}

// ---------------------------------------------------------------------
// 4. QA matrix (section 9)
// ---------------------------------------------------------------------
console.log("\n=== 4. QA matrix (section 9) under v4, ranker stubbed with the Step C fallback ===");
const run = (criteria: Record<string, string | string[]>) => {
  const answers = criteriaToAnswers(criteria, spec);
  const ladder = runLadder(eligible, answers, spec);
  const out = assembleColumnar(ladder, answers, spec, labels, null);
  return { answers, ladder, out, key: encodeResultKey(answers) };
};
type Run = ReturnType<typeof run>;
const all = (r: Run, f: (p: DerivedProduct) => boolean) => r.out.results.every((i) => f(i.product));
type Row = {
  n: number;
  label: string;
  criteria: Record<string, string | string[]>;
  /** What v3 (Oct 17, color soft) returned, for the deltas. */
  was: string;
  expect: string;
  /** The brief calls this a normal path: the live quiz must reach it. */
  mustReach?: boolean;
  check: (r: Run) => string | null;
};
function fmt(p: DerivedProduct, a: ColumnarAnswers) {
  return `${p.handle.padEnd(50)} ${String(p.length).padEnd(11)} ${String(p.shape).padEnd(11)} ${String(p.finish).padEnd(13)} ${p.colors.join("+").padEnd(32)} tier ${closeness(p, a)}`;
}
const rows: Row[] = [
  {
    n: 1,
    label: "Alt & Edgy · Super Short · (skipped) · Pinks & purples · Glossy · A little extra",
    criteria: { vibe: "option_7", length: ["super_short"], color_family: ["pinks_pastels"], question_6: ["option_1"], style_tier: ["extra"] },
    was: "rung 3: 4 pink solids, then 2 off-color (unbothered: black/nude/orange; berry-baby: red, 'made for Alternative & Edgy')",
    expect: "only super short glossy sets with pink; nothing off-color; branching keeps the shopper off this path",
    check: (r) =>
      r.out.results.length === 0
        ? "no results"
        : all(r, (p) => p.length === "super_short" && p.finish === "glossy" && p.colors.includes("pinks_purples"))
          ? null
          : "a result outside super short / glossy / pink",
  },
  {
    n: 2,
    label: "French Girl · Short · Almond · Nudes · Glossy · Clean & classic",
    criteria: { vibe: "french_girl", length: ["short"], shape: ["almond"], color_family: ["nudes_neutrals"], question_6: ["option_1"], style_tier: ["clean"] },
    was: "rung 1: 6 French tip nude sets",
    expect: "reachable; 6 French tip or ombre nude sets, every one a full match (rung 1)",
    mustReach: true,
    check: (r) =>
      r.out.results.length !== 6
        ? `${r.out.results.length} results`
        : r.out.rung !== 1
          ? `rung ${r.out.rung}`
          : all(r, (p) => (p.isFrench || p.isOmbre) && p.colors.includes("nudes"))
            ? null
            : "non French / non nude result",
  },
  {
    n: 3,
    label: "French Girl · Medium · Coffin · Dark & moody · Matte · Full art",
    criteria: { vibe: "french_girl", length: ["medium"], shape: ["coffin"], color_family: ["dark_moody"], question_6: ["option_5"], style_tier: ["art"] },
    was: "rung 5: 1 set (lace-blush: pink + white, off-color)",
    expect: "never off-color: zero results plus a loosen tap, or dark sets only; unreachable in the live quiz",
    check: (r) => (all(r, (p) => p.colors.includes("dark_moody")) ? (r.out.results.length === 0 && !r.out.loosen ? "zero results without a loosen tap" : null) : "off-color result"),
  },
  {
    n: 4,
    label: "Holiday · Short · Oval · Reds & berries · Chrome · Statement",
    criteria: { vibe: "option_8", length: ["short"], shape: ["oval"], color_family: ["reds_berries"], question_6: ["option_4"], style_tier: ["statement"] },
    was: "rung 5: 3 sets, 2 of them off-color (silver-siren, siren)",
    expect: "no Medium, nothing off-color (Chrome is hidden for Short Oval: 3 < 6)",
    check: (r) => (all(r, (p) => p.length === "short" && p.shape === "oval" && p.finish === "chrome" && p.colors.includes("reds_berries")) ? null : "a result outside short oval chrome reds"),
  },
  {
    n: 5,
    label: "Clean Girl · Short+Medium · Almond+Oval · Nudes+White · Glossy+Glazed · Clean & classic",
    criteria: {
      vibe: "model_off_duty",
      length: ["short", "medium"],
      shape: ["almond", "oval"],
      color_family: ["nudes_neutrals", "white"],
      question_6: ["option_1", "option_2"],
      style_tier: ["clean"],
    },
    was: "rung 1: 6 results, both lengths across results + also matched",
    expect: "reachable; 6 full matches inside the union; both lengths across results + also matched",
    mustReach: true,
    check: (r) => {
      if (r.out.results.length !== 6) return `${r.out.results.length} results`;
      if (r.out.rung !== 1) return `rung ${r.out.rung}`;
      const lens = new Set([...r.out.results, ...r.out.alsoMatched].map((i) => i.product.length));
      return lens.has("short") && lens.has("medium") ? null : `lengths ${[...lens].join("+")}`;
    },
  },
  {
    n: 6,
    label: "Surprise · Super Short · (skipped) · Surprise · Surprise · Surprise",
    criteria: { vibe: "_any", length: ["super_short"], color_family: ["_any"], question_6: ["_any"], style_tier: ["_any"] },
    was: "rung 1: 6 super short sets, 6 distinct colorways",
    expect: "6 super short, no two identical colorways (the live Style step has no Surprise option)",
    check: (r) => {
      if (r.out.results.length !== 6) return `${r.out.results.length} results`;
      const ways = new Set(r.out.results.map((i) => i.product.colors.join("+")));
      return ways.size === 6 ? null : `${ways.size} distinct colorways`;
    },
  },
  {
    n: 7,
    label: "Main Character · Medium · Square · Bold & bright · Glossy · Full art",
    criteria: { vibe: "main_character", length: ["medium"], shape: ["square"], color_family: ["bold_bright"], question_6: ["option_1"], style_tier: ["art"] },
    was: "rung 5: 4 nude / white medium square glossy sets (all off-color)",
    expect: "Square visible for Medium only; nothing off-color",
    check: (r) =>
      !visibleIds("shape", { length: ["medium"] }).includes("square")
        ? "Square hidden for Medium only"
        : all(r, (p) => p.colors.includes("bold_bright"))
          ? null
          : "off-color result",
  },
  {
    n: 8,
    label: "Soft & Sweet · Short · Round · Pinks & purples · Velvet / cat eye · A little extra",
    criteria: { vibe: "soft_sweet", length: ["short"], shape: ["round"], color_family: ["pinks_pastels"], question_6: ["option_3"], style_tier: ["extra"] },
    was: "rung 5: 3 sets, 1 off-color (pure-intentions: metallics + white)",
    expect: "shape stays Round, pinks only (Velvet is hidden for Short Round: 3 < 6)",
    check: (r) => (all(r, (p) => p.shape === "round" && p.colors.includes("pinks_purples")) ? null : "a non round or off-color result"),
  },
  {
    n: 9,
    label: "Vacay · Short · Squoval · Oranges & yellows · Glossy · Statement",
    criteria: { vibe: "vacation", length: ["short"], shape: ["squoval"], color_family: ["oranges_yellows"], question_6: ["option_1"], style_tier: ["statement"] },
    was: "rung 3: 4 orange sets, then 2 off-color (blue-a-kiss, light-sage)",
    expect: "oranges only; not identical to row 7's set",
    check: (r) => {
      if (!all(r, (p) => p.colors.includes("oranges_yellows"))) return "off-color result";
      const row7 = run(rows[6].criteria);
      return r.ladder.ordered.map((p) => p.id).join() === row7.ladder.ordered.map((p) => p.id).join() ? "same set as row 7" : null;
    },
  },
  {
    n: 10,
    label: "Any · Short · Almond · Nudes · Glossy · Clean & classic, then Edit color to Reds",
    criteria: { vibe: "_any", length: ["short"], shape: ["almond"], color_family: ["nudes_neutrals"], question_6: ["option_1"], style_tier: ["clean"] },
    was: "rung 1 before and after the edit",
    expect: "reachable; edit: new key, new picks, same length/shape/finish, reds only",
    mustReach: true,
    check: (r) => {
      const edited = run({ ...rows[9].criteria, color_family: ["reds_berries"] });
      console.log(`      edit -> key ${edited.key}, rung ${edited.out.rung}, full matches ${edited.ladder.exactCount}`);
      for (const i of edited.out.results) console.log(`        ${fmt(i.product, edited.answers)}`);
      if (edited.key === r.key) return "same key after edit";
      if (r.out.results.map((i) => i.product.id).join() === edited.out.results.map((i) => i.product.id).join()) return "same picks after edit";
      if (edited.out.results.some((i) => !(i.product.length === "short" && i.product.shape === "almond" && i.product.finish === "glossy"))) return "edit widened L/S/F";
      return edited.out.results.every((i) => i.product.colors.includes("reds_berries")) ? null : "off-color after edit";
    },
  },
];

for (const row of rows) {
  const r = run(row.criteria);
  const roundTrip = JSON.stringify(decodeResultKey(r.key)) === JSON.stringify(r.answers);
  const reachable = reach(r.answers);
  console.log(`\n#${row.n} ${row.label}`);
  console.log(`   v3 was: ${row.was}`);
  console.log(`   expect: ${row.expect}`);
  console.log(`   live quiz: ${reachable ? `unreachable (${reachable})` : "reachable"}`);
  console.log(
    `   rung ${r.out.rung} · full matches ${r.ladder.exactCount} · pass hard filters ${r.ladder.hardCount} · shown ${r.out.results.length} · header ${r.out.header.kind}${r.out.header.text ? ` "${r.out.header.text}"` : ""}${r.out.loosen ? ` · loosen ${r.out.loosen}` : ""} · key ${r.key}${roundTrip ? "" : " (round trip FAILED)"}`,
  );
  for (const i of r.out.results) console.log(`     ${fmt(i.product, r.answers)}  why: ${i.reason}`);
  const why =
    resultIssue(r.out, r.answers, r.ladder) ??
    (row.mustReach && reachable ? `must be reachable: ${reachable}` : null) ??
    (!reachable && r.ladder.exactCount < full.min ? `reachable with only ${r.ladder.exactCount} full matches` : null) ??
    row.check(r);
  if (why || !roundTrip) failures++;
  console.log(`   ${why || !roundTrip ? `FAIL: ${why ?? "resultKey round trip"}` : "PASS"}`);
}

// ---------------------------------------------------------------------
// 5. The v4 walk: every path the widget can show
// ---------------------------------------------------------------------
console.log("\n=== 5. v4 walk: every answer path the widget can show ===");
const maxSel = full.questions.map((q) => {
  const fq = flow.find((f) => f.axisKey === q.axisKey)!;
  return fq.multiSelect ? fq.maxSelections ?? ROLE_VOCAB[q.column].length : 1;
});
/** Every non-empty union of the shown bits, up to max picks. */
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
const idsOf = (qi: number, mask: number) => ROLE_VOCAB[full.questions[qi].column].filter((_, i) => mask & (1 << i));
// What v4 hides on top of the legacy rule (threshold on length / shape /
// finish, every option elsewhere): the same check with no full-match floor.
const legacy: FullBranching = { ...full, min: 0 };
const hiddenByV4 = full.questions.map(() => ({ nodes: 0, hidden: 0, skipped: 0 }));
const hiddenExamples: string[] = [];
const tally = {
  paths: 0,
  minFull: Infinity,
  below: 0,
  checked: 0,
  exactMismatch: 0,
  topNotFull: 0,
  issues: 0,
  rungs: [0, 0, 0, 0, 0, 0],
  fewer: 0,
  fullCounts: new Map<number, number>(),
};
const firstIssues: string[] = [];
const started = Date.now();
function leaf(answers: ColumnarAnswers, fullSets: DerivedProduct[]) {
  tally.paths++;
  const n = fullSets.length;
  tally.minFull = Math.min(tally.minFull, n);
  const bucket = n >= 50 ? 50 : n >= 10 ? 10 : n;
  tally.fullCounts.set(bucket, (tally.fullCounts.get(bucket) ?? 0) + 1);
  if (n < full.min) {
    tally.below++;
    if (firstIssues.length < 8) firstIssues.push(`${encodeResultKey(answers)}: ${n} full matches`);
  }
  if (tally.paths % SAMPLE !== 0) return;
  tally.checked++;
  const ladder = runLadder(eligible, answers, spec);
  const out = assembleColumnar(ladder, answers, spec, labels, null);
  tally.rungs[out.rung]++;
  if (out.results.length < spec.resultCount) tally.fewer++;
  let issue: string | null = null;
  if (ladder.exactCount !== n) {
    tally.exactMismatch++;
    issue = `pipeline counts ${ladder.exactCount} full matches, the walk ${n}`;
  }
  const topCount = Math.min(full.min, out.results.length);
  if (!issue && out.results.slice(0, topCount).some((i) => !fullOk(i.product, answers))) {
    tally.topNotFull++;
    issue = `a top-${full.min} result is not a full match`;
  }
  issue ??= resultIssue(out, answers, ladder);
  if (issue) {
    tally.issues++;
    if (firstIssues.length < 8) firstIssues.push(`${encodeResultKey(answers)}: ${issue}`);
  }
}
function walk(qi: number, masks: number[], answers: ColumnarAnswers, sets: DerivedProduct[]) {
  if (qi === full.questions.length) return leaf(answers, sets);
  const q = full.questions[qi];
  const vis = fullVisibleBits(full, qi, masks);
  const was = fullVisibleBits(legacy, qi, masks);
  const h = hiddenByV4[qi];
  h.nodes++;
  const extra = was.filter((b) => !vis.includes(b));
  h.hidden += extra.length;
  if (vis.length < 2 && was.length >= 2) h.skipped++;
  if (extra.length && hiddenExamples.length < 6 && qi <= 3) {
    const path = full.questions
      .slice(0, qi)
      .map((x, j) => (masks[j] ? idsOf(j, masks[j]).join("+") : "open"))
      .join(" > ");
    hiddenExamples.push(`after ${path || "(start)"}: ${q.axisKey} hides ${extra.map((b) => idOf(qi, b)).join(", ")}`);
  }
  let choices: number[];
  if (vis.length === 0) choices = [0];
  else if (vis.length === 1) choices = [1 << vis[0]];
  else choices = [...unions(vis, maxSel[qi]), ...(q.any ? [0] : [])];
  for (const mask of choices) {
    const ids = mask ? idsOf(qi, mask) : null;
    const next: ColumnarAnswers = { ...answers };
    // Open where the shopper could pick it = surprise; a skipped step stays unanswered.
    if (ids) next[q.column] = ids;
    else if (vis.length >= 2) next[q.column] = "surprise";
    walk(qi + 1, [...masks, mask], next, sets.filter((p) => roleOk(p, q.column, ids)));
  }
}
walk(0, [], {}, eligible);
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`paths ${tally.paths} (unions included) in ${secs}s; full pipeline run on ${tally.checked}${SAMPLE > 1 ? ` (every ${SAMPLE}th)` : " (all)"}`);
console.log(`fewest full matches on any path: ${tally.minFull} (floor ${full.min}); paths below the floor: ${tally.below}`);
console.log(
  `full matches per path: ${[...tally.fullCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k === 50 ? "50+" : k === 10 ? "10-49" : k}: ${v}`)
    .join(" · ")}`,
);
console.log(`rungs: ${[1, 2, 4, 5].map((r) => `${r}: ${tally.rungs[r]}`).join(" · ")} (3 retired) · fewer than ${spec.resultCount} shown: ${tally.fewer}`);
console.log(
  `pipeline vs walk full-match count mismatches ${tally.exactMismatch} · top-${full.min} not a full match ${tally.topNotFull} · ` +
    `other issues (hard filter, tier order, French gate, false why-line) ${tally.issues - tally.exactMismatch - tally.topNotFull}`,
);
console.log("what the full-match floor hides beyond the legacy rule (per question, over every reachable prefix):");
full.questions.forEach((q, i) => {
  const h = hiddenByV4[i];
  console.log(`    ${q.axisKey.padEnd(13)} prefixes ${String(h.nodes).padStart(7)} · options hidden ${String(h.hidden).padStart(7)} · steps it skips ${h.skipped}`);
});
for (const s of hiddenExamples) console.log(`    e.g. ${s}`);
for (const s of firstIssues) console.log(`    ISSUE ${s}`);
const walkOk = tally.below === 0 && tally.issues === 0;
if (!walkOk) failures++;
console.log(`walk: ${walkOk ? "PASS" : "FAIL"}`);

// ---------------------------------------------------------------------
// 6. A hostile ranker
// ---------------------------------------------------------------------
console.log("\n=== 6. Hostile ranker: reversed candidates, false reasons, every single-pick path ===");
const FALSE_REASONS = [
  "A little extra, made for Vacay Mode.",
  "Full-on nail art in red, perfect for Holiday-Ready.",
  "Clean & classic medium coffin in black.",
  "Statement chrome for your Main Character Energy.",
];
let hostileRuns = 0;
let hostileIssues = 0;
let llmLinesKept = 0;
let llmLinesReplaced = 0;
const hostileFirst: string[] = [];
function hostileWalk(qi: number, masks: number[], answers: ColumnarAnswers) {
  if (qi === full.questions.length) {
    hostileRuns++;
    const ladder = runLadder(eligible, answers, spec);
    const candidates = rankerCandidates(ladder, spec);
    const n = Math.min(spec.resultCount, ladder.ordered.length);
    const ids = candidates.slice().reverse().slice(0, n).map((p) => p.id);
    const reasons = Object.fromEntries(candidates.map((p, i) => [p.id, FALSE_REASONS[i % FALSE_REASONS.length]]));
    const out = assembleColumnar(ladder, answers, spec, labels, { ids, reasons });
    const fallback = assembleColumnar(ladder, answers, spec, labels, null);
    for (const i of out.results) {
      if (reasons[i.product.id] === i.reason) llmLinesKept++;
      else llmLinesReplaced++;
    }
    const tiers = (o: Out) => o.results.map((i) => closeness(i.product, answers)).join();
    const issue =
      resultIssue(out, answers, ladder, true) ??
      (tiers(out) !== tiers(fallback) ? `tiers ${tiers(out)} vs fallback ${tiers(fallback)}` : null) ??
      (n > 0 && !out.ranked ? "a valid ranking was not used" : null);
    if (issue) {
      hostileIssues++;
      if (hostileFirst.length < 5) hostileFirst.push(`${encodeResultKey(answers)}: ${issue}`);
    }
    return;
  }
  const q = full.questions[qi];
  const vis = fullVisibleBits(full, qi, masks);
  const choices = vis.length === 0 ? [0] : vis.length === 1 ? [1 << vis[0]] : [...vis.map((b) => 1 << b), ...(q.any ? [0] : [])];
  for (const mask of choices) {
    const next: ColumnarAnswers = { ...answers };
    if (mask) next[q.column] = idsOf(qi, mask);
    else if (vis.length >= 2) next[q.column] = "surprise";
    hostileWalk(qi + 1, [...masks, mask], next);
  }
}
hostileWalk(0, [], {});
console.log(
  `every single-pick path: ${hostileRuns} · issues ${hostileIssues} · ranker lines kept (true of the set) ${llmLinesKept}, replaced ${llmLinesReplaced}`,
);
for (const s of hostileFirst) console.log(`    ISSUE ${s}`);
if (hostileIssues) failures++;
console.log(`hostile ranker: ${hostileIssues ? "FAIL" : "PASS"}`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;