import { describe, it, expect } from "vitest";
import { deriveProduct, splitPool, vibeMatches, type DerivedProduct } from "../columnar/attributes";
import {
  ANY_VALUE,
  HEADER_TEXT,
  TIER_IDS,
  answersToCriteria,
  assembleColumnar,
  branchVisibility,
  buildBranching,
  cappedCollections,
  countRows,
  criteriaToAnswers,
  decodeResultKey,
  describeSet,
  encodeResultKey,
  fullAnswerMask,
  fullVisibleBits,
  hardVisibleBits,
  headerFor,
  hiddenOptionsLog,
  labelsFromFlow,
  passesHardFilters,
  passesKeepFilters,
  pickResults,
  rankerCandidates,
  reasonIsValid,
  runLadder,
  selectResults,
  storewideCollections,
  type ColumnarAnswers,
  type TierId,
} from "../columnar/pipeline";
import { COLOR_IDS, DRAMA_IDS, FINISH_IDS, ROLE_VOCAB, SHAPE_IDS, VIBE_IDS, type ColumnarRole } from "../columnar/spec";
import { glamneticSpec, loadGlamneticFlow, loadGlamneticPool } from "./fixtures/glamnetic-columnar";

// The columnar pipeline on Glamnetic's real Oct 17 pool, logic v6.1
// (Aaron, 2026-10-22): length and shape are never broken; six sets always
// show, tier by tier (perfect, then all filters with drama, with vibe,
// filters only, another color, another finish); at most two from one
// collection; Super Short + another length shows two super short sets;
// why-lines describe the set; branching never counts vibe or drama, shows
// three choices where the data has them and never an option with no set.
// The v4 full-match rules stay served for widgets deployed before v6.1.

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

// Written apart from the pipeline, from the checklist's words.
const picks = (a: ColumnarAnswers[ColumnarRole]) => (Array.isArray(a) && a.length ? a : null);
const fits = (have: string | null, want: string[] | null) => !want || (have !== null && want.includes(have));
/** Length and shape (a super short set has no shape). */
function keepOk(p: DerivedProduct, a: ColumnarAnswers): boolean {
  const shapeless = p.shape === "super_short" && p.length === "super_short";
  return fits(p.length, picks(a.length)) && (shapeless || fits(p.shape, picks(a.shape)));
}
const colorOk = (p: DerivedProduct, a: ColumnarAnswers) => !picks(a.color) || p.colors.some((c) => picks(a.color)!.includes(c));
/** Item 9's tiers. */
function expectedTier(p: DerivedProduct, a: ColumnarAnswers): TierId {
  const c = colorOk(p, a);
  const f = fits(p.finish, picks(a.finish));
  if (!c) return f ? "color" : "color_finish";
  if (!f) return "finish";
  const v = picks(a.vibe)?.[0] ?? null;
  const vibe = !v || vibeMatches(p, v);
  const dramas = picks(a.drama);
  const drama = !dramas || p.drama.some((d) => dramas.includes(d));
  if (vibe && drama) return "perfect";
  if (!vibe && !drama) return "vibe_drama";
  return vibe ? "drama" : "vibe";
}
/** Item 9's order; Lisa's French Girl Chic gate puts drama before vibe. */
function rankOf(t: TierId, a: ColumnarAnswers): number {
  const french = picks(a.vibe)?.[0] === "french_girl";
  if (french && t === "vibe") return 3;
  if (french && t === "drama") return 2;
  return TIER_IDS.indexOf(t) + 1;
}

describe("every result (logic v6.1, items 7-15), 2,000 random answer sets on the real pool", () => {
  it("six, length and shape kept, tiers right and in order, off-color labeled, header, Super Short, cap, why-line", () => {
    const r = rng(20261022);
    const storewide = storewideCollections(eligible);
    for (let i = 0; i < 2000; i++) {
      const answers = randomAnswers(r);
      const key = encodeResultKey(answers);
      const ladder = runLadder(eligible, answers, spec);
      const out = assembleColumnar(ladder, answers, spec, labels, null);
      const res = out.results;
      const keep = eligible.filter((p) => keepOk(p, answers));
      // 7. Always six (when length + shape hold six).
      expect(res.length, key).toBe(Math.min(6, keep.length));
      // 11. Length and shape are never broken.
      for (const x of res) {
        expect(keepOk(x.product, answers), `${key} -> ${x.product.handle}`).toBe(true);
        expect(passesKeepFilters(x.product, answers)).toBe(true);
      }
      // 8-9. Each card's tier is what it is; perfect first, then item 9's order.
      for (let k = 0; k < res.length; k++) {
        expect(res[k].tier, `${key} -> ${res[k].product.handle}`).toBe(expectedTier(res[k].product, answers));
        if (k > 0) expect(rankOf(res[k].tier, answers), key).toBeGreaterThanOrEqual(rankOf(res[k - 1].tier, answers));
      }
      expect(ladder.exactCount).toBe(keep.filter((p) => expectedTier(p, answers) === "perfect").length);
      // 10. An unpicked color only with the "Different color" label.
      for (const x of res) {
        if (!colorOk(x.product, answers)) expect(["color", "color_finish"], key).toContain(x.tier);
      }
      // 12. The header says how many match everything.
      const perfect = res.filter((x) => x.tier === "perfect").length;
      if (res.length === 0) expect(out.header.kind, key).toBe("none");
      else {
        expect(out.header.perfect, key).toBe(perfect);
        expect(out.header.match, key).toBe(perfect === res.length ? "all" : perfect > 0 ? "some" : "closest");
      }
      // 13. Super Short + another length: two super short sets.
      const lens = picks(answers.length);
      if (lens && lens.length > 1 && lens.includes("super_short")) {
        const want = Math.min(2, keep.filter((p) => p.length === "super_short").length);
        expect(res.filter((x) => x.product.length === "super_short").length, key).toBeGreaterThanOrEqual(want);
      }
      // 14. At most two from one collection while the pool can fill six.
      const per = new Map<string, number>();
      for (const x of res) for (const c of cappedCollections(x.product, storewide)) per.set(c, (per.get(c) ?? 0) + 1);
      if ([...per.values()].some((n) => n > 2)) {
        // Only when six can't be filled under the cap (or the Super Short
        // rule needed a set it refuses).
        const room = new Map<string, number>();
        let underCap = 0;
        for (const p of keep) {
          const cs = cappedCollections(p, storewide);
          if (cs.every((c) => (room.get(c) ?? 0) < 2)) {
            underCap++;
            for (const c of cs) room.set(c, (room.get(c) ?? 0) + 1);
          }
        }
        const ssRule = Boolean(lens && lens.length > 1 && lens.includes("super_short"));
        expect(underCap < res.length || ssRule, key).toBe(true);
      }
      // 15. Why-lines: one true sentence about the set, no echo.
      for (const x of res) {
        expect(x.reason, key).toBe(describeSet(x.product));
        expect(reasonIsValid(x.reason, x.product), `${key}: ${x.reason}`).toBe(true);
        expect(x.reason).not.toMatch(/you (picked|chose|asked)|as asked|like you/i);
      }
      expect(out.bestMatchBadge).toBe(res.length > 0 && res[0].tier === "perfect");
    }
  }, 120_000);

  it("copy never uses em dashes or hedges", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const answers = randomAnswers(r);
      const out = assembleColumnar(runLadder(eligible, answers, spec), answers, spec, labels, null);
      const text = out.results.map((x) => x.reason).join(" ");
      expect(text).not.toMatch(/\u2014|closest|similar|almost/i);
      expect(out.header.text ?? "").not.toMatch(/\u2014/);
    }
  });
});

// Hand-built sets: short almond glossy unless the tags say otherwise.
// `vibes` (approved labels) pins the vibe; without it the tag rules decide.
function set(id: string, extra: string[], vibes?: string[]): DerivedProduct {
  const hasLength = extra.some((t) => t.startsWith("Nail Length_"));
  const hasShape = extra.some((t) => t.startsWith("Nail Shape_"));
  const hasFinish = extra.some((t) => t.startsWith("Finish_"));
  return deriveProduct(
    {
      id,
      shopifyId: `gid://shopify/Product/${id.length}${id.charCodeAt(0)}`,
      handle: id,
      title: id,
      productType: "Nails",
      status: "active",
      tags: [
        ...(hasLength ? [] : ["Nail Length_Short"]),
        ...(hasShape ? [] : ["Nail Shape_Almond"]),
        ...(hasFinish ? [] : ["Finish_Glossy"]),
        ...extra,
      ],
      price: 20,
      imageUrl: null,
    },
    vibes ? { vibeLabels: { [id]: vibes } } : {},
  );
}
const many = (prefix: string, n: number, tags: string[], vibes?: string[]) =>
  Array.from({ length: n }, (_, i) => set(`${prefix}-${i}`, [...tags, `_Nail Collection_${prefix}-${i}`], vibes));
const base: ColumnarAnswers = { length: ["short"], shape: ["almond"], finish: ["glossy"], color: ["reds_berries"], drama: ["clean_classic"] };
const tiersOf = (out: ReturnType<typeof assembleColumnar>) => out.results.map((x) => x.tier);
const assemble = (pool: DerivedProduct[], a: ColumnarAnswers) => assembleColumnar(runLadder(pool, a, spec), a, spec, {}, null);

describe("tiers (items 7-11)", () => {
  it("six perfect matches: all perfect, rung 1, Aaron's header", () => {
    const pool = [...many("red-solid", 6, ["Color_Red", "_Is Solid_TRUE"]), ...many("red-art", 4, ["Color_Red", "_Is 3D_TRUE"])];
    const out = assemble(pool, base);
    expect(tiersOf(out)).toEqual(Array(6).fill("perfect"));
    expect(out.results.every((x) => x.product.handle.startsWith("red-solid"))).toBe(true);
    expect([out.rung, out.exactCount]).toEqual([1, 6]);
    expect(out.header).toEqual({ kind: "normal", text: "Six sets that match everything you picked", match: "all", perfect: 6 });
  });

  it("fills six in item 9's order: drama, then vibe, then filters only, another color, another finish", () => {
    const answers: ColumnarAnswers = { ...base, vibe: ["alt_edgy"] };
    // Labels pin the vibe; solid = clean & classic, 3D = full nail art.
    const pool = [
      set("cf", ["Color_Pink", "Finish_Matte", "_Is Solid_TRUE"], ["alt_edgy"]),
      set("finish", ["Color_Red", "Finish_Matte", "_Is Solid_TRUE"], ["alt_edgy"]),
      set("color", ["Color_Pink", "_Is Solid_TRUE"], ["alt_edgy"]),
      set("neither", ["Color_Red", "_Is 3D_TRUE"], []),
      set("vibe-only", ["Color_Red", "_Is 3D_TRUE"], ["alt_edgy"]),
      set("drama-only", ["Color_Red", "_Is Solid_TRUE"], ["soft_sweet"]),
      set("long", ["Color_Red", "Nail Length_Medium", "_Is Solid_TRUE"], ["alt_edgy"]),
    ];
    const out = assemble(pool, answers);
    expect(out.results.map((x) => x.product.handle)).toEqual(["drama-only", "vibe-only", "neither", "color", "finish", "cf"]);
    expect(tiersOf(out)).toEqual(["vibe", "drama", "vibe_drama", "color", "finish", "color_finish"]);
    // Never the medium set: length is never broken (item 11).
    expect(out.rung).toBe(4);
    expect(out.header).toMatchObject({ kind: "relaxed", match: "closest", perfect: 0, text: HEADER_TEXT.closest });
  });

  it("perfect matches first, then the next-best picks; the header counts them", () => {
    const pool = [
      ...many("perfect", 2, ["Color_Red", "_Is Solid_TRUE"]),
      ...many("pink", 6, ["Color_Pink", "_Is Solid_TRUE"]),
    ];
    const out = assemble(pool, base);
    expect(tiersOf(out)).toEqual(["perfect", "perfect", "color", "color", "color", "color"]);
    expect(out.header).toEqual({ kind: "relaxed", text: "2 perfect matches, plus our next-best picks", match: "some", perfect: 2 });
    expect(out.rung).toBe(3);
    const one = assemble(pool.slice(1), base);
    expect(one.header.text).toBe("1 perfect match, plus our next-best picks");
  });

  it("an off-color set shows only as Different color (item 10), and only after every on-color one", () => {
    // v4 showed two sets and stopped; v6.1 fills six, the pinks labeled.
    const pool = [...many("red", 2, ["Color_Red", "_Is 3D_TRUE"]), ...many("pink", 7, ["Color_Pink", "_Is Solid_TRUE"])];
    const out = assemble(pool, base);
    expect(out.results).toHaveLength(6);
    // The reds are full nail art (drama differs); the pinks are off-color.
    expect(tiersOf(out)).toEqual(["drama", "drama", "color", "color", "color", "color"]);
    for (const x of out.results) if (!x.product.colors.includes("reds_berries")) expect(x.tier).toBe("color");
  });

  it("a score never lifts a set over a closer tier (v3: color outweighed vibe and drama)", () => {
    const answers: ColumnarAnswers = { ...base, color: ["reds_berries"], drama: ["full_art"], vibe: ["main_character"] };
    const pool = [
      ...many("red-solid", 6, ["Color_Red", "_Is Solid_TRUE"], ["main_character"]),
      ...many("art", 3, ["Color_Red", "Color_Blue", "Color_Green", "_Is 3D_TRUE"], ["main_character"]),
    ];
    const out = assemble(pool, answers);
    expect(out.results.slice(0, 3).map((x) => x.product.handle.replace(/-\d$/, ""))).toEqual(["art", "art", "art"]);
    expect(tiersOf(out).slice(3)).toEqual(["drama", "drama", "drama"]);
  });

  it("French Girl Chic: French sets passing the filters come before the others that do", () => {
    const french = many("french", 7, ["Color_Nude", "_Is French Tip_TRUE"]);
    const art = many("art", 6, ["Color_Nude", "_Is 3D_TRUE"]);
    const answers: ColumnarAnswers = { ...base, color: ["nudes"], drama: ["full_art"], vibe: ["french_girl"] };
    // Seven French sets with the wrong drama beat six right-drama sets:
    // Lisa's "French tips & ombres only".
    const gated = assemble([...french, ...art], answers);
    expect(gated.results.every((x) => x.product.isFrench)).toBe(true);
    expect(tiersOf(gated)).toEqual(Array(6).fill("drama"));
    // Two French sets can't fill six: the others follow them.
    const lifted = assemble([...french.slice(0, 2), ...art], answers);
    expect(lifted.results.slice(0, 2).every((x) => x.product.isFrench)).toBe(true);
    expect(tiersOf(lifted)).toEqual(["drama", "drama", "vibe", "vibe", "vibe", "vibe"]);
    // Any other vibe: drama outranks it.
    const clean = assemble([...french.slice(0, 2), ...art], { ...answers, vibe: ["clean_girl"] });
    expect(clean.results.slice(0, 4).every((x) => x.product.handle.startsWith("art"))).toBe(true);
  });

  it("fewer than six only when length and shape hold fewer", () => {
    const pool = [...many("exact", 3, ["Color_Red", "_Is Solid_TRUE"]), set("medium-one", ["Color_Red", "Nail Length_Medium"])];
    const out = assemble(pool, base);
    expect(out.results).toHaveLength(3);
    expect(out.rung).toBe(5);
    expect(out.header).toEqual({ kind: "fewer", text: HEADER_TEXT.allFew, match: "all", perfect: 3 });
  });

  it("nothing on length and shape: offers to loosen the shape", () => {
    const pool = many("almond", 8, ["Color_Red"]);
    const coffin = runLadder(pool, { ...base, shape: ["coffin"] }, spec);
    expect(coffin.ordered).toEqual([]);
    expect(coffin.loosen).toBe("shape");
    // Finish and color never empty the grid any more.
    expect(runLadder(pool, { ...base, finish: ["matte"], color: ["white"] }, spec).ordered).toHaveLength(8);
    expect(headerFor(0, 0, 6)).toEqual({ kind: "none", text: "We don't have that combination yet." });
  });
});

describe("collection cap (item 14)", () => {
  // Five perfect matches from one colorway collection, others after them,
  // and medium sets (never shown here) so the colorway is a small share
  // of the pool, as on Glamnetic.
  const colorway = Array.from({ length: 5 }, (_, i) => set(`a-velvet-${i}`, ["Color_Red", "_Is Solid_TRUE", "_Nail Collection_Glazed Red"]));
  const others = many("other", 6, ["Color_Red", "_Is 3D_TRUE"]);
  const filler = many("medium", 60, ["Color_Red", "Nail Length_Medium"]);

  it("at most two from one collection, even when more would be perfect matches", () => {
    const out = assemble([...colorway, ...others, ...filler], base);
    expect(out.results).toHaveLength(6);
    expect(out.results.filter((x) => x.product.collections.includes("Glazed Red"))).toHaveLength(2);
    // The two it shows still lead; the rest are the next tier.
    expect(tiersOf(out)).toEqual(["perfect", "perfect", "drama", "drama", "drama", "drama"]);
  });

  it("relaxed only when six can't be filled otherwise", () => {
    const out = assemble([...colorway, ...others.slice(0, 2), ...filler], base);
    expect(out.results).toHaveLength(6);
    expect(out.results.filter((x) => x.product.collections.includes("Glazed Red"))).toHaveLength(4);
  });

  it("a collection on more than a tenth of the pool is shop-wide and doesn't count", () => {
    const real = storewideCollections(eligible);
    expect([...real].sort()).toEqual(["Glam Icons", "Glam Icons 2026", "Glam Icons NAILS ONLY", "Summer Shop 2026"]);
    const shopWide = Array.from({ length: 30 }, (_, i) => set(`wide-${i}`, ["Color_Red", "_Is Solid_TRUE", "_Nail Collection_Summer Shop"]));
    const out = assemble(shopWide, base);
    expect(out.results).toHaveLength(6);
    expect(storewideCollections(shopWide).has("Summer Shop")).toBe(true);
  });
});

describe("Super Short (item 13, and fix spec v4 item 1)", () => {
  const superShort = eligible.filter((p) => p.length === "super_short");

  it("Super Short + another length shows two super short sets, even from a farther tier", () => {
    const shortPerfect = many("short-red", 8, ["Color_Red", "_Is Solid_TRUE"]);
    const ss = [0, 1, 2].map((i) => set(`ss-pink-${i}`, ["Nail Length_Super Short", "Nail Shape_Super Short", "Color_Pink", "_Is Solid_TRUE", `_Nail Collection_ss-${i}`]));
    const answers: ColumnarAnswers = { ...base, length: ["super_short", "short"] };
    const out = assemble([...shortPerfect, ...ss], answers);
    expect(out.results).toHaveLength(6);
    expect(out.results.filter((x) => x.product.length === "super_short")).toHaveLength(2);
    // They take the bottom slots, so the grid still reads in tier order.
    expect(tiersOf(out)).toEqual(["perfect", "perfect", "perfect", "perfect", "color", "color"]);
    // One length alone: no such rule.
    expect(assemble([...shortPerfect, ...ss], base).results.every((x) => x.product.length === "short")).toBe(true);
  });

  it("on the real pool: Super Short + Short + Almond keeps every super short set in reach", () => {
    // v3: 63 of 63 live runs returned no super short set here.
    const answers: ColumnarAnswers = { length: ["super_short", "short"], shape: ["almond"] };
    expect(eligible.filter((p) => passesKeepFilters(p, answers)).filter((p) => p.length === "super_short")).toHaveLength(superShort.length);
    expect(eligible.filter((p) => passesHardFilters(p, answers) && p.length === "short").every((p) => p.shape === "almond")).toBe(true);
    const out = assembleColumnar(runLadder(eligible, answers, spec), answers, spec, labels, null);
    expect(out.results.filter((x) => x.product.length === "super_short").length).toBeGreaterThanOrEqual(2);
  });

  it("the shape filter still applies to every other length", () => {
    const answers: ColumnarAnswers = { length: ["short", "medium"], shape: ["almond"] };
    expect(eligible.filter((p) => passesKeepFilters(p, answers)).every((p) => p.shape === "almond")).toBe(true);
  });

  it("pickResults keeps the order it is given when no rule applies", () => {
    const pool = many("x", 8, ["Color_Red"]);
    expect(pickResults(pool, base, 6, new Set()).map((p) => p.id)).toEqual(pool.slice(0, 6).map((p) => p.id));
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
    const c = rankerCandidates(l, spec, answers);
    expect(c.map((p) => p.handle.replace(/-\d$/, ""))).toEqual([...Array(4).fill("both"), ...Array(5).fill("drama-only")]);
  });

  it("a pick list that drops closer sets gets them back ahead, keeping the ranker's order inside each tier", () => {
    const c = rankerCandidates(l, spec, answers);
    // Reversed: five drama-only sets first, then one perfect set.
    const ids = [...c].reverse().slice(0, 6).map((p) => p.id);
    const s = selectResults(l, spec, ids, answers);
    expect(s.usedRanker).toBe(true);
    const names = s.results.map((p) => p.handle);
    expect(names.slice(0, 4).every((h) => h.startsWith("both"))).toBe(true);
    // The one perfect set it picked leads its tier.
    expect(names[0]).toBe(c[3].handle);
    // The last tier keeps the ranker's first two picks, in its order.
    expect(names.slice(4)).toEqual([c[8].handle, c[7].handle]);
  });

  it("valid picks inside the tiers are used as-is", () => {
    const c = rankerCandidates(l, spec, answers);
    const ids = [c[2], c[0], c[3], c[1], c[6], c[4]].map((p) => p.id);
    expect(selectResults(l, spec, ids, answers).results.map((p) => p.id)).toEqual(ids);
  });

  it("a pick outside the candidates, a repeat or a short list falls back to Step C order", () => {
    const top = selectResults(l, spec, null, answers).results.map((p) => p.id);
    const far = l.ordered[l.ordered.length - 1].id;
    for (const ids of [[...top.slice(0, 5), far], [...top.slice(0, 5), top[0]], top.slice(0, 5)]) {
      const s = selectResults(l, spec, ids, answers);
      expect(s.results.map((p) => p.id)).toEqual(top);
      expect(s.usedRanker).toBe(false);
    }
  });
});

describe("why-lines (item 15)", () => {
  const p = eligible.find((x) => x.length === "short" && x.shape === "almond" && x.finish === "glossy" && x.colors.includes("nudes"))!;
  const berry = eligible.find((x) => x.handle === "berry-baby-super-short-press-on-nails")!;

  it("describe the set in one sentence, whatever the shopper picked", () => {
    expect(describeSet(berry)).toBe("A glossy super short set in red.");
    const french = eligible.find((x) => x.handle === "heavenly-short-almond-press-on-nails")!;
    expect(describeSet(french)).toBe("A glossy short almond set in nude and white with French tips.");
    const out = assembleColumnar(runLadder(eligible, { length: ["super_short"], color: ["reds_berries"] }, spec), { length: ["super_short"], color: ["reds_berries"] }, spec, labels, null);
    for (const x of out.results) {
      expect(x.reason).toBe(describeSet(x.product));
      expect(x.reason).not.toMatch(/as asked|like you|you picked|you chose/i);
    }
  });

  it("reject ranker reasons that echo the answers or run past one sentence", () => {
    expect(reasonIsValid("Glossy short almond in the nudes you love.", p)).toBe(true);
    expect(reasonIsValid("Glossy short almond, clean and classic as asked.", p)).toBe(false);
    expect(reasonIsValid("Glossy nudes, just like you asked.", p)).toBe(false);
    expect(reasonIsValid("The nudes you picked, in a glossy almond.", p)).toBe(false);
    expect(reasonIsValid("Glossy short almond. Nude and easy.", p)).toBe(false);
  });

  it("reject ranker reasons that hedge, run long, or claim what the set isn't", () => {
    expect(reasonIsValid("The closest thing to your almond pick.", p)).toBe(false);
    expect(reasonIsValid("A medium coffin you'll love.", p)).toBe(false);
    expect(reasonIsValid("Matte and moody.", p)).toBe(false);
    expect(reasonIsValid("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen", p)).toBe(false);
    expect(reasonIsValid("Long-lasting glossy shine in your nudes.", p)).toBe(true);
    const scarlet = eligible.find((x) => /pearl/i.test(x.title) && x.finish !== "glazed_pearl")!;
    expect(reasonIsValid(`${scarlet.title} is the bold pop for you.`, scarlet)).toBe(true);
    expect(reasonIsValid("A pearl finish you'll love.", scarlet)).toBe(false);
  });

  it("Berry Baby (a plain red solid) is never called a little extra, nor Alternative & Edgy (item 18)", () => {
    expect(berry.drama).toEqual(["clean_classic"]);
    expect(vibeMatches(berry, "alt_edgy")).toBe(false);
    expect(reasonIsValid("Glossy super short with a little extra.", berry)).toBe(false);
    expect(reasonIsValid("Made for your Alternative & Edgy side.", berry)).toBe(false);
    expect(reasonIsValid("Clean and classic glossy red.", berry)).toBe(true);
    expect(reasonIsValid("Glossy extra short red.", berry)).toBe(true);
    // Approved, a vibe may be said.
    const labeled = deriveProduct(loadGlamneticPool().find((x) => x.handle === berry.handle)!, { vibeLabels: { [berry.handle]: ["alt_edgy", "holiday"] } });
    expect(reasonIsValid("Made for your Alternative & Edgy side.", labeled)).toBe(true);
    expect(reasonIsValid("A sweet pick.", labeled)).toBe(false);
  });

  it("labels come from the quiz's own options", () => {
    const l = labelsFromFlow(spec, [
      {
        axisKey: "color_family",
        options: [
          { label: "🎨 Nudes & **neutrals**", axisValue: "nudes_neutrals" },
          { label: "Surprise me", axisValue: "nudes_neutrals", selectAll: true },
        ],
      },
    ]);
    expect(l).toEqual({ nudes: "Nudes & neutrals" });
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
  });

  it("finish counts per length", () => {
    const finish = (len: string) => Object.fromEntries(FINISH_IDS.map((f) => [f, countRows(tagged, "finish", f, lengthPrior([len]))]));
    expect(finish("super_short")).toEqual({ glossy: 11, velvet_cateye: 3, glazed_pearl: 8, chrome: 3, matte: 0 });
    expect(finish("short")).toEqual({ glossy: 166, velvet_cateye: 81, glazed_pearl: 50, chrome: 22, matte: 5 });
    expect(finish("medium")).toEqual({ glossy: 36, velvet_cateye: 16, glazed_pearl: 16, chrome: 3, matte: 1 });
  });

  it("serves one legacy row per eligible product; a lone option is no longer a skip", () => {
    const block = buildBranching(spec, eligible);
    expect(block.pool.rows).toHaveLength(416);
    expect(block.threshold).toBe(6);
    const six = SHAPE_IDS.slice(0, 6) as unknown as string[];
    const shapesFor = (len: string[]) => branchVisibility(block.pool.rows, 6, "shape", six, lengthPrior(len));
    expect(shapesFor(["super_short"]).skipped).toBe(true);
    expect(shapesFor(["short"]).visible).toEqual(["almond", "oval", "round", "squoval"]);
    expect(shapesFor(["medium"]).visible).toEqual(["almond", "coffin", "oval", "square"]);
    expect(shapesFor(["short", "medium"]).visible).toEqual(six);
    const one = branchVisibility(block.pool.rows, 6, "finish", [...FINISH_IDS], [...lengthPrior(["short"]), { column: "shape", values: ["round"] }]);
    expect([one.visible, one.skipped]).toEqual([["glossy"], false]);
  });

  it("the Studio hidden-options log: shapes under the threshold, finishes with no set, nothing answered for the shopper", () => {
    const log = hiddenOptionsLog(spec, buildBranching(spec, eligible).pool.rows);
    const entry = (q: string, path: string) => log.find((e) => e.question === q && e.path.join() === path)!;
    expect(entry("shape", "super_short").skipped).toBe(true);
    expect(entry("shape", "short").hidden).toEqual([{ id: "coffin", count: 0 }, { id: "square", count: 0 }]);
    expect(entry("shape", "medium").hidden).toEqual([{ id: "round", count: 0 }, { id: "squoval", count: 0 }]);
    // Short Round: Glazed (5) and Velvet (3) show now; only the empty ones hide.
    const round = entry("finish", "short,round");
    expect([round.skipped, round.autoAnswer, round.hidden.map((h) => h.id)]).toEqual([false, null, ["chrome", "matte"]]);
    expect(log.every((e) => e.autoAnswer === null)).toBe(true);
  });
});

describe("v6.1 branching (items 1-4, 6)", () => {
  const full = buildBranching(spec, eligible, flow).full!;
  const qi = (role: ColumnarRole) => full.questions.findIndex((q) => q.column === role);
  const mask = (role: ColumnarRole, ids: string[]) => fullAnswerMask(full.questions[qi(role)], ids);
  const shown = (role: ColumnarRole, prior: Partial<Record<ColumnarRole, string[]>>) => {
    const masks = full.questions.slice(0, qi(role)).map((q) => (prior[q.column] ? mask(q.column, prior[q.column]!) : 0));
    return hardVisibleBits(full, qi(role), masks).map((b) => ROLE_VOCAB[role][b]);
  };

  it("serves the v6.1 rules beside the v4 ones", () => {
    expect(full.hard).toEqual({ filterColumns: ["length", "shape", "color", "finish"], keepColumns: ["length", "shape"], threshold: 6, minOptions: 3 });
    expect(full.min).toBe(3);
    expect(JSON.stringify(full).length).toBeLessThan(10_000);
  });

  it("1. Shape is skipped only for Super Short alone (a super short set has no shape)", () => {
    expect(shown("shape", { length: ["super_short"] })).toEqual([]);
    expect(shown("shape", { length: ["super_short", "short"] })).toEqual(["almond", "oval", "round", "squoval"]);
  });

  it("4. no option with zero sets: Round and Squoval never show for Medium alone", () => {
    expect(shown("shape", { length: ["medium"] })).toEqual(["almond", "coffin", "oval", "square"]);
    expect(shown("shape", { length: ["short"] })).toEqual(["almond", "oval", "round", "squoval"]);
    expect(shown("shape", { length: ["short", "medium"] })).toEqual(SHAPE_IDS.slice(0, 6));
  });

  it("vibe and drama never narrow an option (v4 skipped 4 of 6 steps for Alt & Edgy + Super Short)", () => {
    const alt = { vibe: ["alt_edgy"], length: ["super_short"] };
    expect(shown("color", alt)).toEqual([...COLOR_IDS]);
    expect(shown("color", alt)).toEqual(shown("color", { length: ["super_short"] }));
    // v4 hid every color here.
    expect(fullVisibleBits(full, qi("color"), [mask("vibe", ["alt_edgy"]), mask("length", ["super_short"]), 0])).toEqual([]);
  });

  it("6. Holiday + Medium shows four shapes, so Oval is the shopper's own tap (v4 recorded it)", () => {
    expect(shown("shape", { vibe: ["holiday"], length: ["medium"] })).toHaveLength(4);
  });

  it("3-4. on 400 random walks every step after Length shows 3+ options, each with a set on length and shape", () => {
    const max = flow.map((q) => (q.multiSelect ? q.maxSelections ?? 9 : 1));
    const r = rng(61);
    const keepRows = (masks: number[]) =>
      full.rows.filter((row) =>
        (["length", "shape"] as const).every((role) => {
          const m = masks[qi(role)] || 0;
          const c = full.columns.indexOf(role);
          return !m || (row[c] & m) !== 0 || (role === "shape" && row[c] === 0);
        }),
      );
    for (let walk = 0; walk < 400; walk++) {
      const masks: number[] = [];
      for (let q = 0; q < full.questions.length; q++) {
        const vis = hardVisibleBits(full, q, masks);
        const role = full.questions[q].column;
        const ssOnly = role === "shape" && masks[qi("length")] === mask("length", ["super_short"]);
        if (q > qi("length") && !ssOnly) {
          expect(vis.length, `${role} after ${masks.join(",")}`).toBeGreaterThanOrEqual(Math.min(3, ROLE_VOCAB[role].length));
          const rows = keepRows(masks);
          const c = full.columns.indexOf(role);
          for (const b of vis) expect(rows.some((row) => (row[c] & (1 << b)) !== 0), `${role} ${b}`).toBe(true);
        }
        let m = 0;
        const chosen = vis.filter(() => r() < 0.4).slice(0, max[q]);
        if (chosen.length === 0 && vis.length && !full.questions[q].any) chosen.push(vis[0]);
        for (const b of chosen) m |= 1 << b;
        masks.push(m);
      }
    }
  });
});

describe("full-match branching (fix spec v4): still served for widgets deployed before v6.1", () => {
  const block = buildBranching(spec, eligible, flow);
  const full = block.full!;

  it("serves the legacy rows untouched plus a compact full block in flow order", () => {
    expect(block.pool.rows).toHaveLength(416);
    expect(full.rows).toHaveLength(416);
    expect(full.questions.map((q) => [q.axisKey, q.column, q.any])).toEqual([
      ["vibe", "vibe", true],
      ["length", "length", false],
      ["shape", "shape", true],
      ["color_family", "color", true],
      ["question_6", "finish", true],
      ["style_tier", "drama", false],
    ]);
    expect(full.questions[0].values).toEqual({
      model_off_duty: 0, soft_sweet: 1, french_girl: 2, main_character: 3, vacation: 4, option_7: 5, option_8: 6,
    });
    const i = eligible.findIndex((x) => x.colors.length > 1 && x.drama.length > 1);
    const p = eligible[i];
    const row = full.rows[i];
    const ids = (role: ColumnarRole) => ROLE_VOCAB[role].filter((_, b) => row[full.columns.indexOf(role)] & (1 << b));
    expect(ids("color")).toEqual(COLOR_IDS.filter((c) => p.colors.includes(c)));
    expect(ids("drama")).toEqual(DRAMA_IDS.filter((d) => p.drama.includes(d)));
    expect(ids("vibe")).toEqual(p.vibes);
  });

  it("the v4 rules: every option shown on 300 random walks keeps three perfect matches", () => {
    const max = flow.map((q) => (q.multiSelect ? q.maxSelections ?? 9 : 1));
    const r = rng(4);
    for (let walk = 0; walk < 300; walk++) {
      const masks: number[] = [];
      const answers: ColumnarAnswers = {};
      for (let q = 0; q < full.questions.length; q++) {
        const vis = fullVisibleBits(full, q, masks);
        let m = 0;
        if (vis.length === 1) m = 1 << vis[0];
        else if (vis.length > 1) {
          const chosen = vis.filter(() => r() < 0.4).slice(0, max[q]);
          if (chosen.length === 0 && !full.questions[q].any) chosen.push(vis[Math.floor(r() * vis.length)]);
          for (const b of chosen) m |= 1 << b;
        }
        masks.push(m);
        if (m) answers[full.questions[q].column] = ROLE_VOCAB[full.questions[q].column].filter((_, i) => m & (1 << i));
      }
      expect(runLadder(eligible, answers, spec).exactCount, encodeResultKey(answers)).toBeGreaterThanOrEqual(3);
    }
  });

  it("without the flow's questions there is no full block (the Studio log reads rows only)", () => {
    expect(buildBranching(spec, eligible).full).toBeUndefined();
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

  it("an edit that changes only the color gives a new key and new picks on the same length and shape", () => {
    const nudes = criteriaToAnswers({ length: ["short"], shape: ["almond"], question_6: ["option_1"], color_family: ["nudes_neutrals"] }, spec);
    const reds = { ...nudes, color: ["reds_berries"] };
    expect(encodeResultKey(reds)).not.toBe(encodeResultKey(nudes));
    const a = assembleColumnar(runLadder(eligible, nudes, spec), nudes, spec, {}, null);
    const b = assembleColumnar(runLadder(eligible, reds, spec), reds, spec, {}, null);
    expect(a.results.map((x) => x.product.id)).not.toEqual(b.results.map((x) => x.product.id));
    expect(b.results.every((x) => x.product.length === "short" && x.product.shape === "almond" && x.product.colors.includes("reds_berries"))).toBe(true);
  });
});
