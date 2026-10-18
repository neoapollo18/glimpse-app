/**
 * Columnar engine QA (Glamnetic recommendation logic v3, brief section 9).
 *
 * Runs against the Oct 17 fixture pool with no network: the Step D ranker
 * is stubbed with its deterministic fallback (the top of Step C), which is
 * exactly what shoppers get when the LLM times out. Prints:
 *   1. derivation vs Aaron's attribute export, per column, with every
 *      disagreement class
 *   2. the excluded products (the brief's eight missing a core tag)
 *   3. the section 6 branching tables and the hidden-options log
 *   4. the section 9 matrix: rung, exactCount, the six handles with their
 *      length / shape / finish, pass/fail against the row's expectation
 *   5. a sweep over every answer path branching lets a shopper reach:
 *      hard filters, closer sets first, honest "you chose" lines
 *
 * Run: npx tsx scripts/columnar-qa.mts
 */

import { deriveProduct, splitPool, vibeMatches, type DerivedProduct } from "../app/lib/columnar/attributes";
import {
  assembleColumnar,
  branchingRows,
  branchVisibility,
  buildBranching,
  countRows,
  criteriaToAnswers,
  decodeResultKey,
  encodeResultKey,
  hiddenOptionsLog,
  passesHardFilters,
  runLadder,
  type ColumnarAnswers,
} from "../app/lib/columnar/pipeline";
import { COLOR_IDS, DEFAULT_ANSWER_LABELS, DRAMA_IDS, VIBE_IDS } from "../app/lib/columnar/spec";
import {
  glamneticSpec,
  loadAttributeExport,
  loadGlamneticPool,
  MISSING_CORE_TAG,
} from "../app/lib/__tests__/fixtures/glamnetic-columnar";

let failures = 0;
const spec = glamneticSpec();
const inputs = loadGlamneticPool();
const derived = inputs.map((p) => deriveProduct(p, { holidayCollections: spec.holidayCollections }));
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
const block = buildBranching(spec, eligible);
console.log(`served rows (eligible): ${block.pool.rows.length}, threshold ${block.threshold}`);
console.log("hidden options on the single-length paths (eligible rows):");
for (const e of hiddenOptionsLog(spec, block.pool.rows)) {
  const path = e.path.map((id) => DEFAULT_ANSWER_LABELS[id]).join(" > ");
  const hidden = e.hidden.map((h) => `${DEFAULT_ANSWER_LABELS[h.id]} (${h.count})`).join(", ") || "none";
  const skip = e.skipped ? (e.autoAnswer ? ` [skipped, auto-answer ${e.autoAnswer}]` : " [skipped]") : "";
  console.log(`    ${path.padEnd(22)} ${e.question.padEnd(6)} hidden: ${hidden}${skip}`);
}

console.log("\nvibe rule counts (eligible pool; brief's Oct 17 figure in brackets):");
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

// ---------------------------------------------------------------------
// 4. QA matrix (section 9)
// ---------------------------------------------------------------------
console.log("\n=== 4. QA matrix (section 9), ranker stubbed with the Step C fallback ===");
type Row = {
  n: number;
  label: string;
  criteria: Record<string, string | string[]>;
  expect: string;
  check: (r: ReturnType<typeof run>) => string | null;
  /** The pool can't meet the brief's expectation without widening length,
   * shape or finish: reported as DATA, not a failure, when the invariant
   * (exact on every hard filter, every exact set shown) holds. */
  dataNote?: (r: ReturnType<typeof run>) => string | null;
};
const run = (criteria: Record<string, string | string[]>) => {
  const answers = criteriaToAnswers(criteria, spec);
  const ladder = runLadder(eligible, answers, spec);
  const out = assembleColumnar(ladder, answers, spec, {}, null);
  return { answers, ladder, out, key: encodeResultKey(answers) };
};
const shapeVisible = (len: string[], shape: string) =>
  branchVisibility(block.pool.rows, block.threshold, "shape", ["almond", "coffin", "oval", "round", "squoval", "square"], [
    { column: "length", values: len },
  ]).visible.includes(shape);

const rows: Row[] = [
  {
    n: 1,
    label: "Alt & Edgy · Super Short · (skipped) · Pinks & purples · Glossy · A little extra",
    criteria: { vibe: "option_7", length: ["super_short"], color_family: ["pinks_pastels"], question_6: ["option_1"], style_tier: ["extra"] },
    expect: "6 Super Short, no Short/Medium; rung 2-3",
    check: (r) =>
      r.out.results.length !== 6
        ? `${r.out.results.length} results`
        : r.out.results.some((i) => i.product.length !== "super_short")
          ? "non super short result"
          : r.out.rung < 2 || r.out.rung > 3
            ? `rung ${r.out.rung}`
            : null,
  },
  {
    n: 2,
    label: "French Girl · Short · Almond · Nudes · Glossy · Clean & classic",
    criteria: { vibe: "french_girl", length: ["short"], shape: ["almond"], color_family: ["nudes_neutrals"], question_6: ["option_1"], style_tier: ["clean"] },
    expect: "6 French tip or ombre, Short Almond; no relaxation (rung 1)",
    check: (r) =>
      r.out.results.length !== 6
        ? `${r.out.results.length} results`
        : r.out.results.some((i) => !(i.product.isFrench || i.product.isOmbre))
          ? "non french/ombre result"
          : r.out.rung !== 1
            ? `rung ${r.out.rung}`
            : null,
  },
  {
    n: 3,
    label: "French Girl · Medium · Coffin · Dark & moody · Matte · Full art",
    criteria: { vibe: "french_girl", length: ["medium"], shape: ["coffin"], color_family: ["dark_moody"], question_6: ["option_5"], style_tier: ["art"] },
    expect: "starved: gate lifts (rung 4/5) before any length/shape/finish widening",
    check: (r) => (r.out.rung < 4 ? `rung ${r.out.rung}` : null),
  },
  {
    n: 4,
    label: "Holiday · Short · Oval · Reds & berries · Chrome · Statement",
    criteria: { vibe: "option_8", length: ["short"], shape: ["oval"], color_family: ["reds_berries"], question_6: ["option_4"], style_tier: ["statement"] },
    expect: "thin path: only Short Oval Chrome, no Medium",
    check: (r) => (r.out.results.some((i) => i.product.length === "medium") ? "medium leaked" : null),
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
    expect: "6 results inside the union; both lengths across results + also matched",
    check: (r) => {
      if (r.out.results.length !== 6) return `${r.out.results.length} results`;
      const lens = new Set([...r.out.results, ...r.out.alsoMatched].map((i) => i.product.length));
      return lens.has("short") && lens.has("medium") ? null : `lengths ${[...lens].join("+")}`;
    },
  },
  {
    n: 6,
    label: "Surprise · Super Short · (skipped) · Surprise · Surprise · Surprise",
    criteria: { vibe: "_any", length: ["super_short"], color_family: ["_any"], question_6: ["_any"], style_tier: ["_any"] },
    expect: "6 Super Short, no two identical colorways",
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
    expect: "Square visible for Medium-only; rung reported",
    check: () => (shapeVisible(["medium"], "square") ? null : "Square hidden for Medium-only"),
  },
  {
    n: 8,
    label: "Soft & Sweet · Short · Round · Pinks & purples · Velvet / cat eye · A little extra",
    criteria: { vibe: "soft_sweet", length: ["short"], shape: ["round"], color_family: ["pinks_pastels"], question_6: ["option_3"], style_tier: ["extra"] },
    expect: "rung 1-2; shape stays Round",
    check: (r) =>
      r.out.results.some((i) => i.product.shape !== "round")
        ? "non round result"
        : r.out.rung > 2 && r.ladder.hardCount >= spec.resultCount
          ? `rung ${r.out.rung}`
          : null,
    dataNote: (r) =>
      r.ladder.hardCount < spec.resultCount
        ? `only ${r.ladder.hardCount} Short Round Velvet sets exist, so rung 1-2 can't fill 6; branching hides Velvet on this path (${r.ladder.hardCount} < ${block.threshold})`
        : null,
  },
  {
    n: 9,
    label: "Vacay · Short · Squoval · Oranges & yellows · Glossy · Statement",
    criteria: { vibe: "vacation", length: ["short"], shape: ["squoval"], color_family: ["oranges_yellows"], question_6: ["option_1"], style_tier: ["statement"] },
    expect: "not identical to row 7's candidate set",
    check: (r) => {
      const row7 = run(rows[6].criteria);
      const a = r.ladder.ordered.map((p) => p.id).join();
      const b = row7.ladder.ordered.map((p) => p.id).join();
      return a === b ? "same candidate set as row 7" : null;
    },
  },
  {
    n: 10,
    label: "Any · Short · Almond · Nudes · Glossy · Clean & classic, then Edit color to Reds",
    criteria: { vibe: "_any", length: ["short"], shape: ["almond"], color_family: ["nudes_neutrals"], question_6: ["option_1"], style_tier: ["clean"] },
    expect: "edit: new key, new picks, same length/shape/finish",
    check: (r) => {
      const edited = run({ ...rows[9].criteria, color_family: ["reds_berries"] });
      console.log(`      edit -> key ${edited.key}, rung ${edited.out.rung}`);
      for (const i of edited.out.results) console.log(`        ${fmt(i.product)}`);
      if (edited.key === r.key) return "same key after edit";
      const before = r.out.results.map((i) => i.product.id).join();
      if (before === edited.out.results.map((i) => i.product.id).join()) return "same picks after edit";
      return edited.out.results.some((i) => !passesHardFilters(i.product, r.answers)) ? "edit widened L/S/F" : null;
    },
  },
];

// Checks every row (and the sweep below) shares, written apart from the
// pipeline so they don't just restate it:
//   - closer sets lead: in the fallback order, no set that steps outside
//     the shopper's picks (French gate, then color, then drama) comes
//     before one that doesn't
//   - a templated "exactly the ... you chose" names only answers the
//     shopper gave, and the set really has them
const picked = (a: ColumnarAnswers[keyof ColumnarAnswers]) => (Array.isArray(a) && a.length ? a : null);
function closeness(p: DerivedProduct, a: ColumnarAnswers): number {
  if (picked(a.vibe)?.[0] === "french_girl" && !(p.isFrench || p.isOmbre)) return 4;
  const colors = picked(a.color);
  if (colors && !p.colors.some((c) => colors.includes(c))) return 3;
  const dramas = picked(a.drama);
  if (dramas && !p.drama.some((d) => dramas.includes(d))) return 2;
  return 1;
}
function orderIssue(out: ReturnType<typeof run>["out"], a: ColumnarAnswers): string | null {
  const shown = [...out.results, ...out.alsoMatched];
  for (let i = 1; i < shown.length; i++) {
    if (closeness(shown[i].product, a) < closeness(shown[i - 1].product, a)) {
      return `${shown[i].product.handle} (closer) ranks behind ${shown[i - 1].product.handle}`;
    }
  }
  return null;
}
function whyIssue(out: ReturnType<typeof run>["out"], a: ColumnarAnswers): string | null {
  for (const i of [...out.results, ...out.alsoMatched]) {
    const m = /exactly the (.+) you chose/.exec(i.reason);
    if (!m) continue;
    for (const role of m[1].split(/, | and /) as Array<"length" | "shape" | "finish">) {
      const have = i.product[role];
      if (!have || !picked(a[role])?.includes(have)) return `"${i.reason}" claims a ${role} pick on ${i.product.handle}`;
    }
  }
  return null;
}

function fmt(p: DerivedProduct) {
  return `${p.handle.padEnd(52)} ${String(p.length).padEnd(11)} ${String(p.shape).padEnd(11)} ${String(p.finish).padEnd(13)} ${p.colors.join("+")}`;
}

for (const row of rows) {
  const r = run(row.criteria);
  const roundTrip = JSON.stringify(decodeResultKey(r.key)) === JSON.stringify(r.answers);
  console.log(`\n#${row.n} ${row.label}`);
  console.log(`   expect: ${row.expect}`);
  console.log(
    `   rung ${r.out.rung} · exactCount ${r.out.exactCount} · shown ${r.out.results.length} · header ${r.out.header.kind}${r.out.header.text ? ` "${r.out.header.text}"` : ""}${r.out.loosen ? ` · loosen ${r.out.loosen}` : ""} · key ${r.key}${roundTrip ? "" : " (round trip FAILED)"}`,
  );
  for (const i of r.out.results) console.log(`     ${fmt(i.product)}  why: ${i.reason}`);
  // Pass = every result satisfies the hard filters AND the row expectation.
  const hardFail = r.out.results.find((i) => !passesHardFilters(i.product, r.answers));
  const why = hardFail
    ? `hard filter violated by ${hardFail.product.handle}`
    : orderIssue(r.out, r.answers) ?? whyIssue(r.out, r.answers) ?? row.check(r);
  const data = !why && roundTrip ? row.dataNote?.(r) ?? null : null;
  if (why || !roundTrip) failures++;
  console.log(`   ${why || !roundTrip ? `FAIL: ${why ?? "resultKey round trip"}` : data ? `PASS (DATA: ${data})` : "PASS"}`);
}

// Answers the brief calls out under "Also verify".
console.log("\n=== Also verify ===");
const alsoChecks: Array<[string, boolean]> = [
  ["Shape step skipped when only Super Short", branchVisibility(block.pool.rows, block.threshold, "shape", ["almond", "coffin", "oval", "round", "squoval", "square"], [{ column: "length", values: ["super_short"] }]).skipped],
  ["Round + Squoval hidden when only Medium", !shapeVisible(["medium"], "round") && !shapeVisible(["medium"], "squoval")],
  ["Coffin + Square hidden when only Short", !shapeVisible(["short"], "coffin") && !shapeVisible(["short"], "square")],
  ["All six shapes shown for Short + Medium", ["almond", "coffin", "oval", "round", "squoval", "square"].every((s) => shapeVisible(["short", "medium"], s))],
  ["Matte hidden for Short (5 < 6)", !branchVisibility(block.pool.rows, block.threshold, "finish", ["matte"], [{ column: "length", values: ["short"] }]).visible.includes("matte")],
];
for (const [name, ok] of alsoChecks) {
  if (!ok) failures++;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${name}`);
}

// ---------------------------------------------------------------------
// 5. Sweep: every path a shopper can reach through branching
// ---------------------------------------------------------------------
// Each single length, then each shape and finish the branching block shows
// on that path (a skipped question is unanswered, a one-option question is
// recorded for the shopper, "surprise" whenever 2+ options show), crossed
// with every vibe, every single color and every single drama level, each
// plus surprise. Ranker stubbed with the fallback, as above.
console.log("\n=== 5. Sweep over every branching path ===");
const SHAPES6 = ["almond", "coffin", "oval", "round", "squoval", "square"];
const visibleFor = (column: "shape" | "finish", ids: string[], prior: Array<{ column: "length" | "shape"; values: string[] }>) => {
  const v = branchVisibility(block.pool.rows, block.threshold, column, ids, prior);
  if (v.visible.length === 0) return [undefined];
  if (v.visible.length === 1) return [[v.visible[0]]];
  return [...v.visible.map((id) => [id]), "surprise" as const];
};
const paths: ColumnarAnswers[] = [];
for (const len of ["super_short", "short", "medium"]) {
  const lp = { column: "length" as const, values: [len] };
  for (const shape of visibleFor("shape", SHAPES6, [lp])) {
    const sp = Array.isArray(shape) ? [lp, { column: "shape" as const, values: shape }] : [lp];
    for (const finish of visibleFor("finish", ["glossy", "glazed_pearl", "velvet_cateye", "chrome", "matte"], sp)) {
      const a: ColumnarAnswers = { length: [len] };
      if (shape) a.shape = shape;
      if (finish) a.finish = finish;
      paths.push(a);
    }
  }
}
const sweepVibes: Array<ColumnarAnswers["vibe"]> = [...VIBE_IDS.map((v) => [v]), "surprise"];
const sweepColors: Array<ColumnarAnswers["color"]> = [...COLOR_IDS.map((c) => [c]), "surprise"];
const sweepDramas: Array<ColumnarAnswers["drama"]> = [...DRAMA_IDS.map((d) => [d]), "surprise"];
const tally = { runs: 0, hard: 0, order: 0, why: 0, short: 0, rungs: [0, 0, 0, 0, 0, 0] };
const firstIssue: string[] = [];
for (const p of paths) {
  for (const vibe of sweepVibes) {
    for (const color of sweepColors) {
      for (const drama of sweepDramas) {
        const a: ColumnarAnswers = { ...p, vibe, color, drama };
        const ladder = runLadder(eligible, a, spec);
        const out = assembleColumnar(ladder, a, spec, {}, null);
        tally.runs++;
        tally.rungs[out.rung]++;
        if (out.results.length < spec.resultCount) tally.short++;
        const hard = [...out.results, ...out.alsoMatched].find((i) => !passesHardFilters(i.product, a));
        const order = orderIssue(out, a);
        const why = whyIssue(out, a);
        if (hard) tally.hard++;
        if (order) tally.order++;
        if (why) tally.why++;
        const issue = hard ? `hard filter: ${hard.product.handle}` : order ?? why;
        if (issue && firstIssue.length < 5) firstIssue.push(`${encodeResultKey(a)}: ${issue}`);
      }
    }
  }
}
console.log(`paths ${paths.length} x vibes ${sweepVibes.length} x colors ${sweepColors.length} x drama ${sweepDramas.length} = ${tally.runs} runs`);
console.log(`rungs: ${[1, 2, 3, 4, 5].map((r) => `${r}: ${tally.rungs[r]}`).join(" · ")} · fewer than ${spec.resultCount}: ${tally.short}`);
console.log(`hard-filter violations ${tally.hard} · closer set behind a farther one ${tally.order} · false "you chose" ${tally.why}`);
for (const s of firstIssue) console.log(`    ${s}`);
const sweepOk = tally.hard === 0 && tally.order === 0 && tally.why === 0;
if (!sweepOk) failures++;
console.log(`sweep: ${sweepOk ? "PASS" : "FAIL"}`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
