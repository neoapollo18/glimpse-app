import { describe, it, expect } from "vitest";
import { deriveProduct, splitPool, type DerivedProduct } from "../columnar/attributes";
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
  headerFor,
  hiddenOptionsLog,
  labelsFromFlow,
  passesHardFilters,
  reasonIsValid,
  runLadder,
  selectResults,
  whyLine,
  type ColumnarAnswers,
} from "../columnar/pipeline";
import { COLOR_IDS, DRAMA_IDS, FINISH_IDS, ROLE_VOCAB, SHAPE_IDS, VIBE_IDS, type ColumnarRole } from "../columnar/spec";
import { glamneticSpec, loadGlamneticPool } from "./fixtures/glamnetic-columnar";

// The columnar pipeline (brief sections 4-6) on Glamnetic's real Oct 17
// pool: length, shape and finish are never widened, the ladder steps down
// in the brief's order, branching reproduces the section 6 tables, and a
// resultKey decodes back to the answers it was made from.

const spec = glamneticSpec();
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

// How far a set sits from the shopper's soft picks, written apart from the
// pipeline: 1 = color and drama both picked, 2 = color only, 3 = neither
// color, 4 = outside the French gate.
const picks = (a: ColumnarAnswers[ColumnarRole]) => (Array.isArray(a) && a.length ? a : null);
function closeness(p: DerivedProduct, a: ColumnarAnswers): number {
  if (picks(a.vibe)?.[0] === "french_girl" && !(p.isFrench || p.isOmbre)) return 4;
  const colors = picks(a.color);
  if (colors && !p.colors.some((c) => colors.includes(c))) return 3;
  const dramas = picks(a.drama);
  if (dramas && !p.drama.some((d) => dramas.includes(d))) return 2;
  return 1;
}

describe("Step A is never violated", () => {
  it("every result and every Also matched set has a picked length, shape and finish (2,000 random answer sets)", () => {
    const r = rng(20261017);
    for (let i = 0; i < 2000; i++) {
      const answers = randomAnswers(r);
      const ladder = runLadder(eligible, answers, spec);
      const out = assembleColumnar(ladder, answers, spec, {}, null);
      for (const item of [...out.results, ...out.alsoMatched]) {
        expect(passesHardFilters(item.product, answers), `${encodeResultKey(answers)} -> ${item.product.handle}`).toBe(true);
      }
      // The French gate holds until rung 4 lifts it.
      if (Array.isArray(answers.vibe) && answers.vibe[0] === "french_girl" && out.rung <= 3) {
        for (const item of [...out.results, ...out.alsoMatched]) {
          expect(item.product.isFrench || item.product.isOmbre).toBe(true);
        }
      }
      // Fewer than six only when fewer than six exact sets exist.
      if (out.results.length < spec.resultCount) {
        expect(out.rung).toBe(5);
        expect(ladder.hardCount).toBe(out.results.length);
      }
      expect(out.bestMatchBadge).toBe(out.rung === 1 && out.results.length > 0);
      for (const item of out.results) {
        expect(item.reason.split(/\s+/).length).toBeLessThanOrEqual(14);
        expect(reasonIsValid(item.reason, item.product)).toBe(true);
      }
      // A relaxed set never puts a set outside the shopper's picks ahead of
      // one inside them (results, then Also matched).
      const tiers = [...out.results, ...out.alsoMatched].map((x) => closeness(x.product, answers));
      for (let t = 1; t < tiers.length; t++) expect(tiers[t], encodeResultKey(answers)).toBeGreaterThanOrEqual(tiers[t - 1]);
      // "Exactly the ... you chose" names only questions the shopper answered.
      for (const item of [...out.results, ...out.alsoMatched]) {
        const claimed = /exactly the (.+) you chose/.exec(item.reason)?.[1].split(/, | and /) ?? [];
        for (const role of claimed as Array<"length" | "shape" | "finish">) {
          const asked = answers[role];
          expect(Array.isArray(asked) && asked.includes(item.product[role]!), `${item.reason} / ${encodeResultKey(answers)}`).toBe(true);
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
      expect(selectResults(ladder, spec, ids).results.map((p) => p.id)).toEqual(top);
    }
    // A valid reordering is used as-is.
    const reordered = [...top].reverse();
    expect(selectResults(ladder, spec, reordered).results.map((p) => p.id)).toEqual(reordered);
  });
});

// Hand-built sets for the ladder: every one short almond glossy.
function set(id: string, extra: string[]): DerivedProduct {
  return deriveProduct({
    id,
    shopifyId: `gid://shopify/Product/${id.length}${id.charCodeAt(0)}`,
    handle: id,
    title: id,
    productType: "Nails",
    status: "active",
    tags: ["Nail Length_Short", "Nail Shape_Almond", "Finish_Glossy", ...extra],
    price: 20,
    imageUrl: null,
  });
}
const many = (prefix: string, n: number, tags: string[]) => Array.from({ length: n }, (_, i) => set(`${prefix}-${i}`, tags));
const base: ColumnarAnswers = { length: ["short"], shape: ["almond"], finish: ["glossy"], color: ["reds_berries"], drama: ["clean_classic"] };

describe("relaxation ladder (section 5)", () => {
  it("rung 1 when six sets match color and drama too", () => {
    const pool = [...many("red-solid", 6, ["Color_Red", "_Is Solid_TRUE"]), ...many("pink", 4, ["Color_Pink", "_Is Solid_TRUE"])];
    const l = runLadder(pool, base, spec);
    expect([l.rung, l.ordered.length, l.exactCount]).toEqual([1, 6, 10]);
    expect(headerFor(l, base, {}, 6)).toEqual({ kind: "normal", text: null });
  });

  it("rung 2 drops drama, rung 3 drops color, and the header says which", () => {
    const r2 = runLadder([...many("red-art", 6, ["Color_Red", "_Is 3D_TRUE"]), ...many("red-solid", 2, ["Color_Red", "_Is Solid_TRUE"])], base, spec);
    expect(r2.rung).toBe(2);
    expect(headerFor(r2, base, {}, 6).text).toBe("Here's what we have in short almond. A few step outside your style picks.");
    const r3 = runLadder(many("pink", 7, ["Color_Pink", "_Is Solid_TRUE"]), base, spec);
    expect(r3.rung).toBe(3);
    expect(headerFor(r3, base, {}, 6)).toEqual({
      kind: "relaxed",
      text: "Here's what we have in short almond. A few step outside your color picks.",
    });
  });

  it("a relaxed rung widens the set, not the score: picked colors still lead", () => {
    // Two red sets (none clean) and six pink clean sets: rung 3. The reds
    // match the color pick and must come first, even though the pinks
    // match the drama pick.
    const pool = [...many("red-art", 2, ["Color_Red", "_Is 3D_TRUE"]), ...many("pink-solid", 6, ["Color_Pink", "_Is Solid_TRUE"])];
    const l = runLadder(pool, base, spec);
    expect(l.rung).toBe(3);
    expect(l.ordered.map((p) => p.handle).slice(0, 2).sort()).toEqual(["red-art-0", "red-art-1"]);
    // Rung 2: the one red clean set leads the red set with the wrong drama.
    const r2 = runLadder([...many("red-art", 6, ["Color_Red", "_Is 3D_TRUE"]), set("red-solid", ["Color_Red", "_Is Solid_TRUE"])], base, spec);
    expect(r2.rung).toBe(2);
    expect(r2.ordered[0].handle).toBe("red-solid");
  });

  it("Lisa's Spooky case: every super short glossy pink set is in the fallback grid", () => {
    const answers = criteriaToAnswers(
      { vibe: "option_7", length: ["super_short"], color_family: ["pinks_pastels"], question_6: ["option_1"], style_tier: ["extra"] },
      spec,
    );
    const out = assembleColumnar(runLadder(eligible, answers, spec), answers, spec, {}, null);
    const pinks = eligible.filter((p) => passesHardFilters(p, answers) && p.colors.includes("pinks_purples"));
    expect(out.rung).toBe(3);
    expect(pinks.length).toBeGreaterThan(0);
    expect(pinks.length).toBeLessThan(6);
    expect(out.results.slice(0, pinks.length).map((x) => x.product.handle).sort()).toEqual(pinks.map((p) => p.handle).sort());
    expect(out.header.text).toBe("Here's what we have in super short. A few step outside your color picks.");
  });

  it("rung 4 lifts the French Girl Chic gate only; other vibes never filter", () => {
    const pool = [...many("french", 2, ["Color_Nude", "_Is French Tip_TRUE"]), ...many("solid", 6, ["Color_Nude", "_Is Solid_TRUE"])];
    const french = runLadder(pool, { ...base, vibe: ["french_girl"] }, spec);
    expect([french.rung, french.exactCount, french.ordered.length]).toEqual([4, 2, 8]);
    // Lifted gate still prefers the French sets.
    expect(french.ordered.slice(0, 2).every((p) => p.isFrench)).toBe(true);
    const clean = runLadder(pool, { ...base, vibe: ["clean_girl"] }, spec);
    expect([clean.rung, clean.exactCount]).toEqual([3, 8]);
  });

  it("rung 5 shows what exists, never widening length, shape or finish", () => {
    const pool = [...many("exact", 3, ["Color_Red"]), set("long-one", ["Color_Red", "Nail Length_Medium"])];
    const l = runLadder(pool, { ...base, length: ["short"] }, spec);
    expect(l.rung).toBe(5);
    expect(l.ordered.map((p) => p.handle).sort()).toEqual(["exact-0", "exact-1", "exact-2"]);
    expect(headerFor(l, base, {}, 3)).toEqual({
      kind: "fewer",
      text: "3 sets match exactly. Change an answer above to see more.",
    });
  });

  it("nothing at all: offers to loosen finish first, then shape", () => {
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

  it("copy never uses em dashes or hedges on length, shape or finish", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const answers = randomAnswers(r);
      const out = assembleColumnar(runLadder(eligible, answers, spec), answers, spec, {}, null);
      const text = [out.header.text ?? "", ...out.results.map((x) => x.reason), ...out.alsoMatched.map((x) => x.reason)].join(" ");
      expect(text).not.toMatch(/\u2014|closest|similar|almost/i);
    }
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
