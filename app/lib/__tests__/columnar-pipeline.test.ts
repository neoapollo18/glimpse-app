import { describe, it, expect } from "vitest";
import { deriveProduct, splitPool, vibeMatches, type DerivedProduct } from "../columnar/attributes";
import {
  ANY_VALUE,
  answersToCriteria,
  assembleColumnar,
  branchVisibility,
  buildBranching,
  countRows,
  criteriaToAnswers,
  decodeResultKey,
  encodeResultKey,
  fullAnswerMask,
  fullVisibleBits,
  headerFor,
  hiddenOptionsLog,
  labelsFromFlow,
  passesHardFilters,
  rankerCandidates,
  reasonIsValid,
  runLadder,
  selectResults,
  whyLine,
  type ColumnarAnswers,
} from "../columnar/pipeline";
import { COLOR_IDS, DRAMA_IDS, FINISH_IDS, ROLE_VOCAB, SHAPE_IDS, VIBE_IDS, type ColumnarRole } from "../columnar/spec";
import { glamneticSpec, loadGlamneticFlow, loadGlamneticPool } from "./fixtures/glamnetic-columnar";

// The columnar pipeline (brief sections 4-6, fix spec v4) on Glamnetic's
// real Oct 17 pool: length, shape, finish and color are never widened,
// vibe and drama rank in tiers the ranker can't break, branching
// reproduces the section 6 tables and keeps three full matches on every
// path, and a resultKey decodes back to the answers it was made from.

const spec = glamneticSpec();
const flow = loadGlamneticFlow();
const labels = labelsFromFlow(spec, flow);
const all = loadGlamneticPool().map((p) => deriveProduct(p, { holidayCollections: spec.holidayCollections }));
const { eligible } = splitPool(all);

// Deterministic PRNG (mulberry32) so a failing case reproduces.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomAnswers(r: () => number): ColumnarAnswers {
  const pick = (ids: readonly string[], max: number) => {
    const out = ids.filter(() => r() < 0.35).slice(0, max);
    return out.length ? out : [ids[Math.floor(r() * ids.length)]];
  };
  const role = (ids: readonly string[], max: number) => {
    const x = r();
    return x < 0.15 ? undefined : x < 0.3 ? ("surprise" as const) : pick(ids, max);
  };
  const a: ColumnarAnswers = {
    vibe: r() < 0.2 ? "surprise" : [VIBE_IDS[Math.floor(r() * VIBE_IDS.length)]],
    length: pick(["super_short", "short", "medium"], 3),
    shape: role(SHAPE_IDS.slice(0, 6), 6),
    color: role(COLOR_IDS, 3),
    finish: role(FINISH_IDS, 2),
    drama: role(DRAMA_IDS, 2),
  };
  for (const k of Object.keys(a) as ColumnarRole[]) if (a[k] === undefined) delete a[k];
  return a;
}

// Written apart from the pipeline, from the spec's words.
const picks = (a: ColumnarAnswers[ColumnarRole]) => (Array.isArray(a) && a.length ? a : null);
/** Length, shape (a super short set has none), finish and color. */
function hardOk(p: DerivedProduct, a: ColumnarAnswers): boolean {
  const ok = (have: string | null, want: string[] | null) => !want || (have !== null && want.includes(have));
  const shapeless = p.shape === "super_short" && p.length === "super_short";
  return (
    ok(p.length, picks(a.length)) &&
    (shapeless || ok(p.shape, picks(a.shape))) &&
    ok(p.finish, picks(a.finish)) &&
    (!picks(a.color) || p.colors.some((c) => picks(a.color)!.includes(c)))
  );
}
/** 1 = vibe and drama fit, 2 = drama only, 3 = vibe only, 4 = neither;
 * French Girl Chic swaps 2 and 3. */
function closeness(p: DerivedProduct, a: ColumnarAnswers): number {
  const v = picks(a.vibe)?.[0] ?? null;
  const vibeOk = !v || vibeMatches(p, v);
  const dramas = picks(a.drama);
  const dramaOk = !dramas || p.drama.some((d) => dramas.includes(d));
  if (vibeOk && dramaOk) return 1;
  if (v === "french_girl") return vibeOk ? 2 : dramaOk ? 3 : 4;
  return dramaOk ? 2 : vibeOk ? 3 : 4;
}

describe("hard filters are never violated", () => {
  it("every result and every Also matched set has a picked length, shape, finish and color (2,000 random answer sets)", () => {
    const r = rng(20261017);
    for (let i = 0; i < 2000; i++) {
      const answers = randomAnswers(r);
      const key = encodeResultKey(answers);
      const ladder = runLadder(eligible, answers, spec);
      const out = assembleColumnar(ladder, answers, spec, labels, null);
      const shown = [...out.results, ...out.alsoMatched];
      for (const item of shown) {
        expect(hardOk(item.product, answers), `${key} -> ${item.product.handle}`).toBe(true);
        expect(passesHardFilters(item.product, answers)).toBe(true);
      }
      // The French gate holds while it can fill the grid.
      const french = eligible.filter((p) => hardOk(p, answers) && vibeMatches(p, "french_girl")).length;
      if (picks(answers.vibe)?.[0] === "french_girl" && french >= spec.resultCount) {
        for (const item of shown) expect(item.product.isFrench || item.product.isOmbre, key).toBe(true);
      }
      // Fewer than six only when fewer than six sets pass.
      if (out.results.length < spec.resultCount) {
        expect(out.rung).toBe(5);
        expect(ladder.hardCount).toBe(out.results.length);
      }
      expect(ladder.exactCount).toBe(eligible.filter((p) => hardOk(p, answers) && closeness(p, answers) === 1).length);
      expect(out.bestMatchBadge).toBe(out.results.length > 0 && closeness(out.results[0].product, answers) === 1);
      for (const item of out.results) {
        expect(item.reason.split(/\s+/).length).toBeLessThanOrEqual(14);
        expect(reasonIsValid(item.reason, item.product), `${key}: ${item.reason}`).toBe(true);
      }
      // Tiers in order across results, then Also matched.
      const tiers = shown.map((x) => closeness(x.product, answers));
      for (let t = 1; t < tiers.length; t++) expect(tiers[t], key).toBeGreaterThanOrEqual(tiers[t - 1]);
      // "Exactly the ... you chose" names only questions the shopper answered.
      for (const item of shown) {
        const claimed = /exactly the (.+) you chose/.exec(item.reason)?.[1].split(/, | and /) ?? [];
        for (const role of claimed as Array<"length" | "shape" | "finish">) {
          const asked = answers[role];
          expect(Array.isArray(asked) && asked.includes(item.product[role]!), `${item.reason} / ${key}`).toBe(true);
        }
      }
    }
  }, 60_000);

  it("a ranker pick outside the candidate set, a repeat or a short list falls back to Step C order", () => {
    const answers: ColumnarAnswers = { length: ["short"], shape: ["almond"], finish: ["glossy"] };
    const ladder = runLadder(eligible, answers, spec);
    const top = ladder.ordered.slice(0, 6).map((p) => p.id);
    const medium = eligible.find((p) => p.length === "medium")!.id;
    for (const ids of [[...top.slice(0, 5), medium], [...top.slice(0, 5), top[0]], top.slice(0, 5)]) {
      const s = selectResults(ladder, spec, ids);
      expect(s.results.map((p) => p.id)).toEqual(top);
      expect(s.usedRanker).toBe(false);
    }
    // A valid reordering is used as-is.
    const reordered = [...top].reverse();
    expect(selectResults(ladder, spec, reordered).results.map((p) => p.id)).toEqual(reordered);
  });
});

// Hand-built sets: every one short almond glossy. `vibes` (approved
// labels) pins the vibe; without it the tag rules decide.
function set(id: string, extra: string[], vibes?: string[]): DerivedProduct {
  return deriveProduct(
    {
      id,
      shopifyId: `gid://shopify/Product/${id.length}${id.charCodeAt(0)}`,
      handle: id,
      title: id,
      productType: "Nails",
      status: "active",
      tags: ["Nail Length_Short", "Nail Shape_Almond", "Finish_Glossy", ...extra],
      price: 20,
      imageUrl: null,
    },
    vibes ? { vibeLabels: { [id]: vibes } } : {},
  );
}
const many = (prefix: string, n: number, tags: string[], vibes?: string[]) =>
  Array.from({ length: n }, (_, i) => set(`${prefix}-${i}`, tags, vibes));
const base: ColumnarAnswers = { length: ["short"], shape: ["almond"], finish: ["glossy"], color: ["reds_berries"], drama: ["clean_classic"] };

describe("tiers and hard filters (fix spec v4)", () => {
  it("rung 1 when six sets match every answer", () => {
    const pool = [...many("red-solid", 6, ["Color_Red", "_Is Solid_TRUE"]), ...many("red-art", 4, ["Color_Red", "_Is 3D_TRUE"])];
    const l = runLadder(pool, base, spec);
    expect([l.rung, l.ordered.length, l.exactCount, l.hardCount]).toEqual([1, 10, 6, 10]);
    expect(l.ordered.slice(0, 6).every((p) => p.handle.startsWith("red-solid"))).toBe(true);
    expect(headerFor(l, base, {}, 6)).toEqual({ kind: "normal", text: null });
  });

  it("color is a hard filter: an off-color set never shows, even to fill the grid", () => {
    // v3 relaxed color at rung 3 and showed these pinks for a red pick.
    const pool = [...many("red-solid", 2, ["Color_Red", "_Is Solid_TRUE"]), ...many("pink-solid", 7, ["Color_Pink", "_Is Solid_TRUE"])];
    const l = runLadder(pool, base, spec);
    expect(l.ordered.map((p) => p.handle).sort()).toEqual(["red-solid-0", "red-solid-1"]);
    expect([l.rung, l.hardCount]).toEqual([5, 2]);
    const out = assembleColumnar(l, base, spec, {}, null);
    expect(out.alsoMatched).toEqual([]);
    const none = runLadder(many("pink", 7, ["Color_Pink", "_Is Solid_TRUE"]), base, spec);
    expect(none.ordered).toEqual([]);
    expect(none.loosen).toBe("color");
  });

  it("vibe and drama rank in tiers: both, drama only, vibe only, neither", () => {
    const answers: ColumnarAnswers = { ...base, vibe: ["alt_edgy"] };
    const pool = [
      ...many("neither", 2, ["Color_Red", "_Is 3D_TRUE"], []),
      ...many("vibe-only", 2, ["Color_Red", "_Is 3D_TRUE"], ["alt_edgy"]),
      ...many("drama-only", 2, ["Color_Red", "_Is Solid_TRUE"], ["soft_sweet"]),
      ...many("both", 2, ["Color_Red", "_Is Solid_TRUE"], ["alt_edgy"]),
    ];
    const l = runLadder(pool, answers, spec);
    expect(l.ordered.map((p) => p.handle.replace(/-\d$/, ""))).toEqual([
      "both", "both", "drama-only", "drama-only", "vibe-only", "vibe-only", "neither", "neither",
    ]);
    expect([...l.tiers.values()].sort()).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(l.exactCount).toBe(2);
    // The six shown reach the vibe-only tier: some step outside both picks.
    expect(l.rung).toBe(4);
    expect(l.outside).toEqual({ vibe: true, drama: true });
    expect(headerFor(l, answers, {}, 6).text).toBe("Here's what we have in short almond. A few step outside your vibe and style picks.");
  });

  it("a score never lifts a set over a closer tier (v3: color outweighed vibe and drama)", () => {
    // Nude-only reds score higher on color overlap than the multi-color
    // full-art sets, but the shopper asked for nail art.
    const answers: ColumnarAnswers = { ...base, color: ["reds_berries"], drama: ["full_art"], vibe: ["main_character"] };
    const pool = [
      ...many("red-solid", 6, ["Color_Red", "_Is Solid_TRUE"], ["main_character"]),
      ...many("art", 3, ["Color_Red", "Color_Blue", "Color_Green", "_Is 3D_TRUE"], ["main_character"]),
    ];
    const l = runLadder(pool, answers, spec);
    expect(l.ordered.slice(0, 3).map((p) => p.handle.replace(/-\d$/, ""))).toEqual(["art", "art", "art"]);
    expect(l.rung).toBe(2);
    expect(headerFor(l, answers, {}, 6).text).toBe("Here's what we have in short almond. A few step outside your style picks.");
  });

  it("French Girl Chic stays a gate while it fills the grid, then the rest follow the French sets", () => {
    // French tips read clean & classic; the 3D sets are full nail art.
    const french = many("french", 7, ["Color_Nude", "_Is French Tip_TRUE"]);
    const art = many("art", 6, ["Color_Nude", "_Is 3D_TRUE"]);
    const answers: ColumnarAnswers = { ...base, color: ["nudes"], drama: ["full_art"], vibe: ["french_girl"] };
    // Seven French sets (wrong drama) beat six non-French with the right
    // drama: Lisa's "French tips & ombres only".
    const gated = runLadder([...french, ...art], answers, spec);
    expect(gated.ordered).toHaveLength(7);
    expect(gated.ordered.every((p) => p.isFrench)).toBe(true);
    expect(gated.rung).toBe(2);
    // Two French sets can't fill six: the others fill in after them.
    const lifted = runLadder([...french.slice(0, 2), ...art], answers, spec);
    expect([lifted.rung, lifted.exactCount, lifted.ordered.length]).toEqual([4, 0, 8]);
    expect(lifted.ordered.slice(0, 2).every((p) => p.isFrench)).toBe(true);
    // Any other vibe never filters: drama outranks it.
    const clean = runLadder([...french.slice(0, 2), ...art], { ...answers, vibe: ["clean_girl"] }, spec);
    expect(clean.ordered.slice(0, 6).every((p) => p.handle.startsWith("art"))).toBe(true);
  });

  it("rung 5 shows what exists, never widening length, shape, finish or color", () => {
    const pool = [...many("exact", 3, ["Color_Red", "_Is Solid_TRUE"]), set("long-one", ["Color_Red", "Nail Length_Medium"])];
    const l = runLadder(pool, base, spec);
    expect(l.rung).toBe(5);
    expect(l.ordered.map((p) => p.handle).sort()).toEqual(["exact-0", "exact-1", "exact-2"]);
    expect(headerFor(l, base, {}, 3)).toEqual({
      kind: "fewer",
      text: "3 sets match exactly. Change an answer above to see more.",
    });
    // Fewer, and some miss the drama pick: the header says so.
    const mixed = runLadder([...many("exact", 2, ["Color_Red", "_Is Solid_TRUE"]), set("art", ["Color_Red", "_Is 3D_TRUE"])], base, spec);
    expect(headerFor(mixed, base, {}, 3)).toEqual({
      kind: "fewer",
      text: "Here's what we have in short almond. A few step outside your style picks.",
    });
  });

  it("nothing at all: offers to loosen finish first, then shape, then color", () => {
    const pool = many("glossy", 8, ["Color_Red"]);
    const matte = runLadder(pool, { ...base, finish: ["matte"], shape: ["coffin"] }, spec);
    expect(matte.ordered).toEqual([]);
    // Dropping matte alone still leaves coffin unmatched, dropping coffin
    // alone leaves matte: neither helps, so finish (first) is offered.
    expect(matte.loosen).toBe("finish");
    const coffinOnly = runLadder(pool, { ...base, shape: ["coffin"] }, spec);
    expect(coffinOnly.loosen).toBe("shape");
    expect(headerFor(coffinOnly, base, {}, 0)).toEqual({ kind: "none", text: "We don't have that combination yet." });
  });

  it("copy never uses em dashes or hedges", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const answers = randomAnswers(r);
      const out = assembleColumnar(runLadder(eligible, answers, spec), answers, spec, labels, null);
      const text = [out.header.text ?? "", ...out.results.map((x) => x.reason), ...out.alsoMatched.map((x) => x.reason)].join(" ");
      expect(text).not.toMatch(/\u2014|closest|similar|almost/i);
    }
  });
});

describe("the ranker reorders inside a tier, never across", () => {
  const answers: ColumnarAnswers = { ...base, vibe: ["alt_edgy"] };
  const pool = [
    ...many("both", 4, ["Color_Red", "_Is Solid_TRUE"], ["alt_edgy"]),
    ...many("drama-only", 5, ["Color_Red", "_Is Solid_TRUE"], []),
    ...many("vibe-only", 5, ["Color_Red", "_Is 3D_TRUE"], ["alt_edgy"]),
  ];
  const l = runLadder(pool, answers, spec);

  it("candidates stop at the tier of the last grid slot", () => {
    const c = rankerCandidates(l, spec);
    expect(c.map((p) => p.handle.replace(/-\d$/, ""))).toEqual([...Array(4).fill("both"), ...Array(5).fill("drama-only")]);
  });

  it("a pick list that drops closer sets gets them back ahead, keeping the ranker's order inside each tier", () => {
    const c = rankerCandidates(l, spec);
    // Reversed: five drama-only sets first, then one tier-1 set.
    const ids = [...c].reverse().slice(0, 6).map((p) => p.id);
    const s = selectResults(l, spec, ids);
    expect(s.usedRanker).toBe(true);
    const names = s.results.map((p) => p.handle);
    expect(names.slice(0, 4).every((h) => h.startsWith("both"))).toBe(true);
    // The one tier-1 set it picked leads its tier.
    expect(names[0]).toBe(c[3].handle);
    // The boundary tier keeps the ranker's first two picks, in its order.
    expect(names.slice(4)).toEqual([c[8].handle, c[7].handle]);
  });

  it("valid picks inside the tiers are used as-is", () => {
    const c = rankerCandidates(l, spec);
    const ids = [c[2], c[0], c[3], c[1], c[6], c[4]].map((p) => p.id);
    expect(selectResults(l, spec, ids).results.map((p) => p.id)).toEqual(ids);
  });
});
describe("branching (section 6 tables from the real pool)", () => {
  // The brief's counts come from the export, before exclusions.
  const tagged: Array<[string, string, string]> = all
    .filter((p) => p.length)
    .map((p) => [p.length!, p.shape ?? "", p.finish ?? ""]);
  const lengthPrior = (values: string[]) => [{ column: "length" as const, values }];

  it("shape counts per length path", () => {
    const shapes = ["almond", "coffin", "oval", "round", "squoval", "square", "super_short"];
    const counts = (len: string[]) => Object.fromEntries(shapes.map((s) => [s, countRows(tagged, "shape", s, lengthPrior(len))]));
    expect(counts(["super_short"])).toMatchObject({ super_short: 24, almond: 0, coffin: 0, oval: 0, round: 0, squoval: 0, square: 0 });
    expect(counts(["short"])).toMatchObject({ almond: 188, oval: 69, squoval: 43, round: 26, coffin: 0, square: 0 });
    expect(counts(["medium"])).toMatchObject({ coffin: 24, almond: 23, oval: 18, square: 7, round: 0, squoval: 0 });
    expect(tagged.filter((r) => r[0] === "short" || r[0] === "medium")).toHaveLength(398);
    expect(tagged.filter((r) => r[0] === "super_short")).toHaveLength(25);
  });

  it("finish counts per length", () => {
    const finish = (len: string) =>
      Object.fromEntries(FINISH_IDS.map((f) => [f, countRows(tagged, "finish", f, lengthPrior([len]))]));
    expect(finish("super_short")).toEqual({ glossy: 11, velvet_cateye: 3, glazed_pearl: 8, chrome: 3, matte: 0 });
    expect(finish("short")).toEqual({ glossy: 166, velvet_cateye: 81, glazed_pearl: 50, chrome: 22, matte: 5 });
    expect(finish("medium")).toEqual({ glossy: 36, velvet_cateye: 16, glazed_pearl: 16, chrome: 3, matte: 1 });
  });

  it("serves one row per eligible product and the brief's visibility outcomes", () => {
    const block = buildBranching(spec, eligible);
    expect(block.pool.rows).toHaveLength(416);
    expect(block.threshold).toBe(6);
    expect(Object.keys(block.questions).sort()).toEqual(["length", "question_6", "shape"]);
    expect(block.questions.question_6).toEqual({ column: "finish", values: spec.axes.question_6.values });
    const six = SHAPE_IDS.slice(0, 6) as unknown as string[];
    const shapesFor = (len: string[]) => branchVisibility(block.pool.rows, 6, "shape", six, lengthPrior(len));
    expect(shapesFor(["super_short"]).skipped).toBe(true);
    expect(shapesFor(["short"]).visible).toEqual(["almond", "oval", "round", "squoval"]);
    expect(shapesFor(["medium"]).visible).toEqual(["almond", "coffin", "oval", "square"]);
    // Multi-select is a union: Coffin shows for Short + Medium via Medium.
    expect(shapesFor(["short", "medium"]).visible).toEqual(six);
    // Matte: hidden after Short alone.
    expect(branchVisibility(block.pool.rows, 6, "finish", [...FINISH_IDS], lengthPrior(["short"])).visible).not.toContain("matte");
  });

  it("the Studio hidden-options log names the brief's hidden shapes", () => {
    const log = hiddenOptionsLog(spec, buildBranching(spec, eligible).pool.rows);
    const shape = (len: string) => log.find((e) => e.question === "shape" && e.path.join() === len)!;
    expect(shape("super_short").skipped).toBe(true);
    expect(shape("short").hidden).toEqual([{ id: "coffin", count: 0 }, { id: "square", count: 0 }]);
    expect(shape("medium").hidden).toEqual([{ id: "round", count: 0 }, { id: "squoval", count: 0 }]);
    // Short > Round leaves only Glossy: skipped and answered for the shopper.
    const round = log.find((e) => e.question === "finish" && e.path.join() === "short,round")!;
    expect([round.skipped, round.autoAnswer]).toEqual([true, "glossy"]);
  });
});

describe("answers and the resultKey", () => {
  it("criteria map to answer IDs; select-all is surprise; unmapped values leave the axis open", () => {
    const a = criteriaToAnswers(
      {
        vibe: ANY_VALUE,
        length: ["medium", "short"],
        shape: [ANY_VALUE],
        color_family: ["pinks_pastels", "nudes_neutrals"],
        question_6: ["option_6"], // live "Surprise Me!" row, not select-all
        style_tier: ["clean", "nope"],
        unrelated: "x",
      },
      spec,
    );
    expect(a).toEqual({
      vibe: "surprise",
      length: ["short", "medium"],
      shape: "surprise",
      color: ["nudes", "pinks_purples"],
      drama: ["clean_classic"],
    });
    expect(answersToCriteria(a, spec)).toEqual({
      vibe: [ANY_VALUE],
      length: ["short", "medium"],
      shape: [ANY_VALUE],
      color_family: ["nudes_neutrals", "pinks_pastels"],
      style_tier: ["clean"],
    });
  });

  it("round-trips every answer set and stays URL-safe", () => {
    const r = rng(42);
    for (let i = 0; i < 1000; i++) {
      const a = randomAnswers(r);
      // Canonical form: vocabulary order, as criteriaToAnswers builds it.
      for (const role of Object.keys(a) as ColumnarRole[]) {
        const v = a[role];
        if (Array.isArray(v)) a[role] = [...new Set(v)].sort((x, y) => ROLE_VOCAB[role].indexOf(x) - ROLE_VOCAB[role].indexOf(y));
      }
      const key = encodeResultKey(a);
      expect(key).toMatch(/^[a-z0-9.]+$/);
      expect(decodeResultKey(key)).toEqual(a);
    }
    expect(encodeResultKey({})).toBe("c1.x.x.x.x.x.x");
  });

  it("rejects malformed keys", () => {
    for (const bad of ["", "c2.x.x.x.x.x.x", "c1.x.x.x.x.x", "c1.zzzzz.x.x.x.x.x", "c1.3.x.x.x.x.x", "c1.x.0.x.x.x.x", "<script>", 42, null]) {
      expect(decodeResultKey(bad)).toBeNull();
    }
  });

  it("an edit that changes only the color gives a new key and new picks on the same path", () => {
    const nudes = criteriaToAnswers({ length: ["short"], shape: ["almond"], question_6: ["option_1"], color_family: ["nudes_neutrals"] }, spec);
    const reds = { ...nudes, color: ["reds_berries"] };
    expect(encodeResultKey(reds)).not.toBe(encodeResultKey(nudes));
    const a = assembleColumnar(runLadder(eligible, nudes, spec), nudes, spec, {}, null);
    const b = assembleColumnar(runLadder(eligible, reds, spec), reds, spec, {}, null);
    expect(a.results.map((x) => x.product.id)).not.toEqual(b.results.map((x) => x.product.id));
    expect(b.results.every((x) => x.product.length === "short" && x.product.shape === "almond" && x.product.finish === "glossy")).toBe(true);
  });
});

describe("why-lines", () => {
  const p = eligible.find((x) => x.length === "short" && x.shape === "almond" && x.finish === "glossy" && x.colors.includes("nudes"))!;

  it("rejects ranker reasons that hedge, run long, or claim what the set isn't", () => {
    expect(reasonIsValid("Glossy short almond in the nudes you love.", p)).toBe(true);
    expect(reasonIsValid("The closest thing to your almond pick.", p)).toBe(false);
    expect(reasonIsValid("A medium coffin you'll love.", p)).toBe(false);
    expect(reasonIsValid("Matte and moody.", p)).toBe(false);
    expect(reasonIsValid("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen", p)).toBe(false);
  });

  it("accepts wear words and the set's own name; still rejects a false finish", () => {
    expect(reasonIsValid("Long-lasting glossy shine in your nudes.", p)).toBe(true);
    const scarlet = eligible.find((x) => /pearl/i.test(x.title) && x.finish !== "glazed_pearl")!;
    expect(reasonIsValid(`${scarlet.title} is the bold pop you wanted.`, scarlet)).toBe(true);
    expect(reasonIsValid("A pearl finish you'll love.", scarlet)).toBe(false);
  });

  it("claims only the answers the shopper gave", () => {
    const ss = eligible.find((x) => x.length === "super_short" && x.finish === "glossy")!;
    // Surprise finish, shape never asked: the length is all they chose.
    expect(whyLine(ss, { length: ["super_short"], finish: "surprise" }, {}, null)).toBe("Glossy super short: exactly the length you chose.");
    expect(whyLine(ss, { length: ["super_short"], finish: ["glossy"] }, {}, null)).toBe(
      "Glossy super short: exactly the length and finish you chose.",
    );
    // Nothing specific answered: just what the set is.
    expect(whyLine(ss, { vibe: "surprise", length: "surprise" }, {}, null)).toBe("Glossy super short.");
    expect(whyLine(p, { length: ["short"], shape: ["almond"], finish: ["glossy"] }, {}, null)).toBe(
      "Glossy short almond: exactly the length, shape and finish you chose.",
    );
  });

  it("echoes the shopper's own option labels", () => {
    const labels = labelsFromFlow(spec, [
      {
        axisKey: "color_family",
        options: [
          { label: "🎨 Nudes & **neutrals**", axisValue: "nudes_neutrals" },
          { label: "Surprise me", axisValue: "nudes_neutrals", selectAll: true },
        ],
      },
    ]);
    expect(labels).toEqual({ nudes: "Nudes & neutrals" });
    expect(whyLine(p, { color: ["nudes"] }, labels, null)).toBe("Glossy short almond in the nudes & neutrals you picked.");
  });
});

describe("Super Short has no shape (fix spec v4, item 1)", () => {
  const superShort = eligible.filter((p) => p.length === "super_short");

  it("Super Short + another length + a shape keeps the super short sets", () => {
    // v3: 63 of 63 live runs returned no super short set here.
    const answers: ColumnarAnswers = { length: ["super_short", "short"], shape: ["almond"] };
    const passing = eligible.filter((p) => passesHardFilters(p, answers));
    expect(passing.filter((p) => p.length === "super_short")).toHaveLength(superShort.length);
    expect(passing.filter((p) => p.length === "short").every((p) => p.shape === "almond")).toBe(true);
    const ordered = runLadder(eligible, answers, spec).ordered;
    expect(ordered.filter((p) => p.length === "super_short")).toHaveLength(superShort.length);
    // With a color they lead on their own merits.
    const pink: ColumnarAnswers = { ...answers, color: ["pinks_purples"], finish: ["glossy"] };
    const lens = new Set(runLadder(eligible, pink, spec).ordered.map((p) => p.length));
    expect([...lens].sort()).toEqual(["short", "super_short"]);
  });

  it("the shape filter still applies to every other length", () => {
    const answers: ColumnarAnswers = { length: ["short", "medium"], shape: ["almond"] };
    expect(eligible.filter((p) => passesHardFilters(p, answers)).every((p) => p.shape === "almond")).toBe(true);
  });

  it("branching counts agree: shapes count only their own sets, later questions count the super short sets too", () => {
    const block = buildBranching(spec, eligible, flow).full!;
    const qi = (axisKey: string) => block.questions.findIndex((q) => q.axisKey === axisKey);
    const len = block.questions[qi("length")];
    const shape = block.questions[qi("shape")];
    const ssShort = fullAnswerMask(len, ["super_short", "short"]);
    // Round shows for Super Short + Short through the short round sets...
    const shapes = fullVisibleBits(block, qi("shape"), [0, ssShort]).map((b) => SHAPE_IDS[b]);
    expect(shapes).toEqual(["almond", "oval", "round", "squoval"]);
    // ...and Super Short + Medium never offers Round (no medium round set),
    // although a super short set would pass a Round pick.
    const ssMedium = fullAnswerMask(len, ["super_short", "medium"]);
    expect(fullVisibleBits(block, qi("shape"), [0, ssMedium]).map((b) => SHAPE_IDS[b])).not.toContain("round");
    // The super short rows have no shape bit and pass any shape pick.
    const row = (h: string) => block.rows[eligible.findIndex((p) => p.handle === h)];
    expect(row(superShort[0].handle)[block.columns.indexOf("shape")]).toBe(0);
    const round = fullAnswerMask(shape, ["round"]);
    // Every finish the widget shows here has at least threshold sets on
    // the server's own filter, super short sets included.
    const finishBits = fullVisibleBits(block, qi("question_6"), [0, ssShort, round, 0]);
    for (const b of finishBits) {
      const f = FINISH_IDS[b];
      const n = eligible.filter((p) => passesHardFilters(p, { length: ["super_short", "short"], shape: ["round"], finish: [f] })).length;
      expect(n, f).toBeGreaterThanOrEqual(spec.threshold);
    }
    // Short Round alone has 5 glazed sets (hidden at 6); the 7 super short
    // glazed sets bring it back.
    expect(finishBits.map((b) => FINISH_IDS[b])).toContain("glazed_pearl");
  });
});

describe("full-match branching (fix spec v4, item 4)", () => {
  const block = buildBranching(spec, eligible, flow);
  const full = block.full!;

  it("serves the legacy rows untouched plus a compact full block in flow order", () => {
    expect(block.pool.rows).toHaveLength(416);
    expect(block.threshold).toBe(6);
    expect(full.min).toBe(3);
    expect(full.threshold).toBe(6);
    expect(full.rows).toHaveLength(416);
    expect(full.questions.map((q) => [q.axisKey, q.column, q.any])).toEqual([
      ["vibe", "vibe", true],
      ["length", "length", false],
      ["shape", "shape", true],
      ["color_family", "color", true],
      ["question_6", "finish", true],
      ["style_tier", "drama", false],
    ]);
    // Bits index the shared vocabularies; the select-all row is no option.
    expect(full.questions[0].values).toEqual({
      model_off_duty: 0, soft_sweet: 1, french_girl: 2, main_character: 3, vacation: 4, option_7: 5, option_8: 6,
    });
    expect(JSON.stringify(full).length).toBeLessThan(10_000);
    // A row carries every set's colors, vibes and drama levels.
    const i = eligible.findIndex((x) => x.colors.length > 1 && x.drama.length > 1);
    const p = eligible[i];
    const row = full.rows[i];
    const ids = (role: ColumnarRole) => ROLE_VOCAB[role].filter((_, b) => row[full.columns.indexOf(role)] & (1 << b));
    expect(ids("color")).toEqual(COLOR_IDS.filter((c) => p.colors.includes(c)));
    expect(ids("drama")).toEqual(DRAMA_IDS.filter((d) => p.drama.includes(d)));
    expect(ids("vibe")).toEqual(p.vibes);
  });

  it("keeps the brief's visibility outcomes and the threshold", () => {
    const shapesFor = (lens: string[]) =>
      fullVisibleBits(full, 2, [0, fullAnswerMask(full.questions[1], lens)]).map((b) => SHAPE_IDS[b]);
    expect(shapesFor(["super_short"])).toEqual([]);
    expect(shapesFor(["short"])).toEqual(["almond", "oval", "round", "squoval"]);
    expect(shapesFor(["medium"])).toEqual(["almond", "coffin", "oval", "square"]);
    expect(shapesFor(["short", "medium"])).toEqual(SHAPE_IDS.slice(0, 6));
    const short = fullAnswerMask(full.questions[1], ["short"]);
    expect(fullVisibleBits(full, 4, [0, short, 0, 0]).map((b) => FINISH_IDS[b])).not.toContain("matte");
  });

  it("hides an option that can't keep three full matches (Lisa's Alt & Edgy case)", () => {
    const alt = fullAnswerMask(full.questions[0], ["alt_edgy"]);
    const ss = fullAnswerMask(full.questions[1], ["super_short"]);
    const colors = fullVisibleBits(full, 3, [alt, ss, 0]).map((b) => COLOR_IDS[b]);
    expect(colors).not.toContain("pinks_purples");
    // Each color it does show leaves three super short alt sets in it.
    for (const c of colors) {
      const n = eligible.filter((p) => p.length === "super_short" && vibeMatches(p, "alt_edgy") && p.colors.includes(c)).length;
      expect(n, c).toBeGreaterThanOrEqual(3);
    }
  });

  it("every option shown on 300 random walks keeps three full matches to the end", () => {
    // The live quiz's max picks: vibe is single-select.
    const max = flow.map((q) => (q.multiSelect ? q.maxSelections ?? 9 : 1));
    const r = rng(4);
    for (let walk = 0; walk < 300; walk++) {
      const masks: number[] = [];
      const answers: ColumnarAnswers = {};
      for (let qi = 0; qi < full.questions.length; qi++) {
        const q = full.questions[qi];
        const vis = fullVisibleBits(full, qi, masks);
        let mask = 0;
        if (vis.length === 1) mask = 1 << vis[0];
        else if (vis.length > 1) {
          const chosen = vis.filter(() => r() < 0.4).slice(0, max[qi]);
          if (chosen.length === 0 && !q.any) chosen.push(vis[Math.floor(r() * vis.length)]);
          for (const b of chosen) mask |= 1 << b;
        }
        masks.push(mask);
        if (mask) answers[q.column] = ROLE_VOCAB[q.column].filter((_, i) => mask & (1 << i));
      }
      const ladder = runLadder(eligible, answers, spec);
      expect(ladder.exactCount, encodeResultKey(answers)).toBeGreaterThanOrEqual(3);
      const out = assembleColumnar(ladder, answers, spec, labels, null);
      for (const x of out.results.slice(0, 3)) expect(closeness(x.product, answers)).toBe(1);
    }
  });

  it("without the flow's questions there is no full block (the Studio log reads rows only)", () => {
    expect(buildBranching(spec, eligible).full).toBeUndefined();
  });
});

describe("why-lines are true (fix spec v4, item 5)", () => {
  const berry = eligible.find((x) => x.handle === "berry-baby-super-short-press-on-nails")!;

  it("Berry Baby (a plain red solid) is never called a little extra", () => {
    expect(berry.drama).toEqual(["clean_classic"]);
    expect(reasonIsValid("A little extra, just like you asked.", berry)).toBe(false);
    expect(reasonIsValid("Glossy super short with a little extra.", berry)).toBe(false);
    expect(reasonIsValid("Full-on nail art in berry red.", berry)).toBe(false);
    expect(reasonIsValid("A statement red for you.", berry)).toBe(false);
    expect(reasonIsValid("Clean and classic glossy red.", berry)).toBe(true);
    // "Extra short" is a length, not the drama level.
    expect(reasonIsValid("Glossy extra short red.", berry)).toBe(true);
    const a: ColumnarAnswers = { vibe: ["alt_edgy"], length: ["super_short"], color: ["reds_berries"], drama: ["little_extra"] };
    expect(whyLine(berry, a, labels, "alt_edgy")).not.toMatch(/extra/i);
  });

  it("names a vibe only where Lisa approved it (or the French tip / ombre tags say so)", () => {
    // Berry Baby fits Alternative & Edgy only by the "Dark" in its
    // "Glossy Dark Maroon" collection: a rule, so it ranks but is not said.
    expect(berry.vibeSource).toBe("rules");
    expect(vibeMatches(berry, "alt_edgy")).toBe(true);
    expect(whyLine(berry, { vibe: ["alt_edgy"], length: ["super_short"] }, labels, "alt_edgy")).toBe(
      "Glossy super short: exactly the length you chose.",
    );
    expect(reasonIsValid("Made for your Alternative & Edgy side.", berry)).toBe(false);
    expect(reasonIsValid("Dark and moody glossy red.", berry)).toBe(false);
    // Approved, it is said.
    const labeled = deriveProduct(loadGlamneticPool().find((p) => p.handle === berry.handle)!, {
      vibeLabels: { [berry.handle]: ["alt_edgy", "holiday"] },
    });
    expect(whyLine(labeled, { vibe: ["alt_edgy"], length: ["super_short"] }, labels, "alt_edgy")).toBe(
      "Glossy super short, made for Alternative & Edgy.",
    );
    expect(reasonIsValid("Made for your Alternative & Edgy side.", labeled)).toBe(true);
    expect(reasonIsValid("Festive red, holiday ready.", labeled)).toBe(true);
    expect(reasonIsValid("A sweet pick.", labeled)).toBe(false);
    // French Girl Chic is the tag rule: French tips may say it.
    const frenchTip = eligible.find((x) => x.isFrench && !/french/i.test(x.title))!;
    expect(reasonIsValid("French tips made for French Girl Chic.", frenchTip)).toBe(true);
    expect(reasonIsValid("Made for French Girl Chic.", berry)).toBe(false);
  });

  it("every templated line on 1,000 random answer sets passes the validator, labels and all", () => {
    const r = rng(99);
    for (let i = 0; i < 1000; i++) {
      const answers = randomAnswers(r);
      const out = assembleColumnar(runLadder(eligible, answers, spec), answers, spec, labels, null);
      for (const x of [...out.results, ...out.alsoMatched]) {
        expect(reasonIsValid(x.reason, x.product), `${encodeResultKey(answers)}: ${x.reason} (${x.product.handle})`).toBe(true);
      }
    }
  }, 60_000);
});
