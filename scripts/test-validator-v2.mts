/**
 * Validator v2 regression (spec Part 5 acceptance - the "Luna regression").
 *
 * We don't have the Luna store, so this is the unit-style stand-in: a
 * synthetic 17-product catalog, a deliberately-bad config (2 questions,
 * ungrounded answers, unreachable products, no intro copy) that every v2
 * floor must reject, and a good config that must pass with t2 imagery
 * resolved and the wildcard slot materialized.
 *
 * Run: npx tsx scripts/test-validator-v2.mts
 */

import {
  validateGeneratedConfig,
  computeAnswerProductMap,
  catalogImageForProducts,
  GeneratedQuizConfigSchema,
  MIN_QUESTIONS_FLOOR,
  WILDCARD_RULE_RANK,
  type CatalogProduct,
  type GeneratedQuizConfig,
} from "../app/lib/quiz-config-schema.server";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------
// Synthetic 17-product catalog (small scope: floor 2, in-scope < 20).
// 12 lipsticks in 4 shade families + 5 "tool" products that no shade
// answer can reach (the unreachable tail the wildcard must park).
// ---------------------------------------------------------------------

const FAMILIES = ["red", "pink", "nude", "berry"] as const;
const catalog: CatalogProduct[] = [];
for (let i = 0; i < 12; i++) {
  const family = FAMILIES[i % FAMILIES.length];
  const id = `prod-lip-${String(i).padStart(2, "0")}`;
  catalog.push({
    id,
    name: `Velvet Lipstick ${family} ${i}`,
    productType: "Lipstick",
    vendor: "Luna Beauty",
    tags: [family, "lipstick"],
    price: 18,
    status: "active",
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    variants: [
      {
        id: `var-${id}`,
        title: `${family} shade`,
        displayColor: family,
        price: 18,
        status: "active",
        imageUrl: `https://cdn.example.com/${id}-swatch.jpg`,
      },
    ],
  });
}
for (let i = 0; i < 5; i++) {
  const id = `prod-tool-${i}`;
  catalog.push({
    id,
    name: `Sculpt Tool ${i}`,
    productType: "Tool",
    vendor: "Luna Beauty",
    tags: ["applicator"],
    price: 9,
    status: "active",
    imageUrl: null, // tools have no imagery - exercises catalog fallback gaps
    variants: [{ id: `var-${id}`, title: "Default", status: "active", imageUrl: null }],
  });
}
check("synthetic catalog is 17 products", catalog.length === 17);

// ---------------------------------------------------------------------
// Config builders (run through the zod schema exactly like model output)
// ---------------------------------------------------------------------

function parse(raw: unknown): GeneratedQuizConfig {
  const parsed = GeneratedQuizConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(parsed.error.issues);
    throw new Error("fixture failed schema parse - fix the fixture");
  }
  return parsed.data;
}

/** The Luna failure, reconstructed: 2 questions, one answer that LOOKS
 * concrete but matches nothing ("matte gloss holo"), no intro copy, and
 * the 5 tool products unreachable with no wildcard. */
const badConfig = parse({
  axes: [
    {
      key: "shade_family",
      label: "Shade",
      source: "user_question",
      values: [
        { value: "red", label: "Red" },
        { value: "holo_chrome", label: "Holo chrome" },
      ],
    },
    {
      key: "finish",
      label: "Finish",
      source: "user_question",
      values: [
        { value: "matte_holo", label: "Matte holo" },
        { value: "cream", label: "Cream" },
      ],
    },
  ],
  questions: [
    {
      axisKey: "shade_family",
      prompt: "Pick a shade",
      options: [
        { label: "Red", axisValueValue: "red" },
        // Concrete color words, zero catalog matches → ungrounded.
        { label: "Silver holo", axisValueValue: "holo_chrome" },
      ],
    },
    {
      axisKey: "finish",
      prompt: "Pick a finish",
      options: [
        { label: "Matte holo", axisValueValue: "matte_holo" },
        { label: "Cream", axisValueValue: "cream" },
      ],
    },
  ],
  rules: [],
  recommendationMode: "ai",
  aiGuidance: "Match on shade.",
  copy: null,
  designTokens: null,
});

/** A well-grounded 4-question config: matrix rules over shade families,
 * intro copy present, tools parked in the wildcard slot. */
function goodConfigRaw() {
  const shadeValues = FAMILIES.map((f) => ({ value: f, label: f }));
  const lipRules = catalog
    .filter((p) => p.productType === "Lipstick")
    .map((p, i) => ({
      criteria: [{ axisKey: "shade_family", axisValue: (p.tags ?? [])[0] }],
      productId: p.id,
      rank: i + 1,
    }));
  return {
    axes: [
      { key: "shade_family", label: "Shade", source: "user_question", values: shadeValues },
      {
        key: "vibe",
        label: "Vibe",
        source: "user_question",
        values: [
          { value: "classic", label: "Classic" },
          { value: "bold_era", label: "Bold era" },
        ],
      },
      {
        key: "finish_pref",
        label: "Finish",
        source: "user_question",
        values: [
          { value: "velvet_soft", label: "Velvet soft" },
          { value: "statement", label: "Statement" },
        ],
      },
      {
        key: "occasion",
        label: "Occasion",
        source: "user_question",
        values: [
          { value: "daily", label: "Daily" },
          { value: "event", label: "Event" },
        ],
      },
    ],
    questions: [
      {
        axisKey: "shade_family",
        prompt: "Which shade family feels like you?",
        options: shadeValues.map((v) => ({ label: v.label, axisValueValue: v.value })),
      },
      {
        axisKey: "vibe",
        prompt: "What's the vibe?",
        options: [
          { label: "Classic", axisValueValue: "classic" },
          { label: "Bold era", axisValueValue: "bold_era" },
        ],
      },
      {
        axisKey: "finish_pref",
        prompt: "How should it feel?",
        options: [
          { label: "Velvet soft", axisValueValue: "velvet_soft" },
          { label: "Statement", axisValueValue: "statement" },
        ],
      },
      {
        axisKey: "occasion",
        prompt: "Where's it going?",
        options: [
          { label: "Daily", axisValueValue: "daily" },
          { label: "Event", axisValueValue: "event" },
        ],
      },
    ],
    rules: lipRules,
    recommendationMode: "hybrid",
    aiGuidance: "1. Prefer the shade family the shopper picked.",
    copy: {
      quiz_headline: "Find your shade in 60 seconds",
      quiz_subtext: "Four quick questions, matched from the shades Luna actually stocks.",
    },
    designTokens: null,
    wildcard: {
      label: "Everything else",
      productIds: catalog.filter((p) => p.productType === "Tool").map((p) => p.id),
    },
  };
}

// ---------------------------------------------------------------------
// 1. Every v2 floor rejects the bad config
// ---------------------------------------------------------------------

console.log("\n[1] bad config - each floor rejects");
const bad = validateGeneratedConfig(badConfig, catalog, { floors: { templateId: "t2" } });
check("bad config fails overall", !bad.ok);
const errText = bad.errors.join(" || ");
check(
  `question floor rejects < ${MIN_QUESTIONS_FLOOR}`,
  bad.errors.some((e) => e.includes(`hard minimum is ${MIN_QUESTIONS_FLOOR}`)),
  errText,
);
check(
  "ungrounded answer rejected (5.5: maps to no facet)",
  bad.errors.some((e) => e.includes("maps to no catalog facet")),
  errText,
);
check(
  "unreachable + unparked products rejected (5.4)",
  bad.errors.some((e) => e.includes("wildcard slot")),
  errText,
);
check(
  "missing intro headline rejected (5.3)",
  bad.errors.some((e) => e.includes("quiz_headline")),
  errText,
);
check(
  "missing intro support line rejected (5.3)",
  bad.errors.some((e) => e.includes("quiz_subtext")),
  errText,
);

// Reachability floor in isolation: park nothing, ground everything except
// a big slice of catalog. Build a matrix config whose rules only reach 2
// of 17 products (~12% < 80%).
console.log("\n[2] reachability floor");
const narrow = parse({
  ...goodConfigRaw(),
  rules: [
    { criteria: [{ axisKey: "shade_family", axisValue: "red" }], productId: "prod-lip-00", rank: 1 },
    { criteria: [{ axisKey: "shade_family", axisValue: "pink" }], productId: "prod-lip-01", rank: 1 },
    { criteria: [{ axisKey: "shade_family", axisValue: "nude" }], productId: "prod-lip-00", rank: 2 },
    { criteria: [{ axisKey: "shade_family", axisValue: "berry" }], productId: "prod-lip-01", rank: 2 },
    { criteria: [{ axisKey: "vibe", axisValue: "classic" }], productId: "prod-lip-00", rank: 3 },
    { criteria: [{ axisKey: "vibe", axisValue: "bold_era" }], productId: "prod-lip-01", rank: 3 },
    { criteria: [{ axisKey: "finish_pref", axisValue: "velvet_soft" }], productId: "prod-lip-00", rank: 4 },
    { criteria: [{ axisKey: "finish_pref", axisValue: "statement" }], productId: "prod-lip-01", rank: 4 },
    { criteria: [{ axisKey: "occasion", axisValue: "daily" }], productId: "prod-lip-00", rank: 5 },
    { criteria: [{ axisKey: "occasion", axisValue: "event" }], productId: "prod-lip-01", rank: 5 },
  ],
  recommendationMode: "matrix",
  wildcard: null,
});
const narrowRes = validateGeneratedConfig(narrow, catalog, { floors: {} });
check("narrow matrix fails overall", !narrowRes.ok);
check(
  "reachability floor rejects < 80%",
  narrowRes.errors.some((e) => e.includes("floor 80%")),
  narrowRes.errors.join(" || "),
);

// Products-per-answer floor: an answer whose only rule reaches 1 product
// (small-scope floor is 2 at 17 products).
console.log("\n[3] products-per-answer floor");
check(
  "small-scope answer floor (>=2) rejects 1-product answers",
  narrowRes.errors.some((e) => e.includes("the floor is 2")),
  narrowRes.errors.join(" || "),
);

// ---------------------------------------------------------------------
// 4. Good config passes every floor; t2 imagery resolves from catalog
// ---------------------------------------------------------------------

console.log("\n[4] good config - passes with t2 imagery + wildcard");
const good = parse(goodConfigRaw());
const goodRes = validateGeneratedConfig(good, catalog, { floors: { templateId: "t2" } });
check("good config passes", goodRes.ok, goodRes.errors.join(" || "));
check("zero errors", goodRes.errors.length === 0, goodRes.errors.join(" || "));
check(
  "t2 imagery resolved for every answer (no failures)",
  !goodRes.imageryFailures || goodRes.imageryFailures.length === 0,
  (goodRes.imageryFailures ?? []).join(" || "),
);
check("no template degradation", !goodRes.degradedTo);
check(
  ">= 4 questions in the draft",
  (goodRes.draft?.flow.questions.length ?? 0) >= MIN_QUESTIONS_FLOOR,
);
const wildcardRules = (goodRes.draft?.flow.rules ?? []).filter((r) => r.rank === WILDCARD_RULE_RANK);
check(
  "wildcard slot materialized as low-priority catch-all rules (5 tools x 4 first-axis values)",
  wildcardRules.length === 5 * 4,
  `got ${wildcardRules.length}`,
);
check(
  "wildcard rules cover every parked tool",
  new Set(wildcardRules.map((r) => r.productId)).size === 5,
);

// Imagery degradation is soft: strip catalog imagery, t2 floor misses on
// >1 question → degradedTo t5, but ok stays true (publishing never blocked).
console.log("\n[5] imagery degradation is soft (4.3)");
const bareCatalog: CatalogProduct[] = catalog.map((p) => ({
  ...p,
  imageUrl: null,
  variants: p.variants.map((v) => ({ ...v, imageUrl: null })),
}));
const bareRes = validateGeneratedConfig(parse(goodConfigRaw()), bareCatalog, {
  floors: { templateId: "t2" },
});
check("still ok (imagery never hard-fails)", bareRes.ok, bareRes.errors.join(" || "));
check("imagery failures reported", (bareRes.imageryFailures?.length ?? 0) > 0);
check("degrades to t5", bareRes.degradedTo === "t5");

// Editing path unchanged: no floors → the 2-question config is judged only
// by the structural v1 rules (the copilot must keep validating live quizzes).
console.log("\n[6] editing gate (no floors) unaffected");
const editRes = validateGeneratedConfig(badConfig, catalog, { rulelessMatrixOk: true });
check(
  "no-floors validation ignores v2 floors",
  editRes.ok,
  editRes.errors.join(" || "),
);

// Helper sanity: mapping + deterministic catalog image.
console.log("\n[7] helper sanity");
const mapped = computeAnswerProductMap(good, catalog);
check("red answer maps to 3 red lipsticks", mapped.get("shade_family:red")?.size === 3);
check(
  "vibe answer is universal (ranker-interpreted)",
  mapped.get("vibe:bold_era")?.size === 17,
);
check(
  "catalog image resolution is deterministic (lowest product id wins)",
  catalogImageForProducts(["prod-lip-03", "prod-lip-01"], catalog) ===
    "https://cdn.example.com/prod-lip-01.jpg",
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All validator v2 checks passed.");
