import { describe, it, expect } from "vitest";
import {
  validateGeneratedConfig,
  serializeCatalog,
  normalizeFlowOrder,
  GeneratedQuizConfigSchema,
  type GeneratedQuizConfig,
  type CatalogProduct,
} from "../quiz-config-schema.server";

const catalog: CatalogProduct[] = [
  {
    id: "prod-1",
    name: "Coral Crush Lacquer",
    productType: "Nail Polish",
    vendor: "Testbrand",
    tags: ["red", "creme"],
    price: 12,
    variants: [
      { id: "var-1", title: "Coral", displayColor: "#ff6f61" },
      { id: "var-2", title: "Deep Red", displayColor: "#8b0000" },
    ],
  },
  {
    id: "prod-2",
    name: "Sheer Glow Top Coat",
    productType: "Top Coat",
    vendor: "Testbrand",
    tags: ["sheer"],
    price: 10,
    variants: [],
  },
  {
    id: "prod-deleted",
    name: "Retired Shade",
    status: "deleted",
    variants: [{ id: "var-deleted", title: "Gone", status: "deleted" }],
  },
];

function validConfig(): GeneratedQuizConfig {
  return {
    axes: [
      {
        key: "vibe",
        label: "Vibe",
        source: "user_question",
        values: [
          { value: "bold", label: "Bold" },
          { value: "soft", label: "Soft" },
        ],
      },
      {
        key: "finish",
        label: "Finish",
        source: "user_question",
        values: [
          { value: "creme", label: "Creme" },
          { value: "sheer", label: "Sheer" },
        ],
      },
    ],
    questions: [
      {
        axisKey: "vibe",
        prompt: "What's the vibe?",
        options: [
          { label: "Bold", axisValueValue: "bold" },
          { label: "Soft", axisValueValue: "soft" },
        ],
      },
      {
        axisKey: "finish",
        prompt: "Pick your finish",
        showIf: { axis_key: "vibe", axis_value: "bold" },
        options: [
          { label: "Creme", axisValueValue: "creme" },
          { label: "Sheer", axisValueValue: "sheer" },
        ],
      },
    ],
    rules: [
      {
        criteria: [
          { axisKey: "vibe", axisValue: "bold" },
          { axisKey: "finish", axisValue: "creme" },
        ],
        variantId: "var-1",
        rank: 1,
      },
      { criteria: [{ axisKey: "vibe", axisValue: "soft" }], productId: "prod-2", rank: 2 },
    ],
    recommendationMode: "matrix",
  };
}

describe("GeneratedQuizConfigSchema", () => {
  it("parses a valid config", () => {
    expect(GeneratedQuizConfigSchema.safeParse(validConfig()).success).toBe(true);
  });
});

describe("validateGeneratedConfig", () => {
  it("accepts a valid config and normalizes to draft shape", () => {
    const result = validateGeneratedConfig(validConfig(), catalog);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.draft!.flow.axes).toHaveLength(2);
    expect(result.draft!.flow.rules[0].criteria).toEqual({ vibe: "bold", finish: "creme" });
    expect(result.draft!.settings.recommendation_mode).toBe("matrix");
  });

  it("rejects duplicate axis keys", () => {
    const config = validConfig();
    config.axes.push(config.axes[0]);
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/Duplicate axis key/);
  });

  it("rejects non-snake-case keys", () => {
    const config = validConfig();
    config.axes[0].key = "Vibe Check";
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/snake_case/);
  });

  it("rejects showIf referencing a later axis", () => {
    const config = validConfig();
    // First question conditions on the second question's axis
    config.questions[0].showIf = { axis_key: "finish", axis_value: "creme" };
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/not asked earlier/);
  });

  it("rejects options mapping to undeclared axis values", () => {
    const config = validConfig();
    config.questions[0].options[0].axisValueValue = "nonexistent";
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/undeclared value/);
  });

  it("drops rules with hallucinated targets as warnings, not errors", () => {
    const config = validConfig();
    config.rules.push({
      criteria: [{ axisKey: "vibe", axisValue: "soft" }],
      productId: "prod-hallucinated",
      rank: 3,
    });
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(true);
    expect(result.draft!.flow.rules).toHaveLength(2);
    expect(result.warnings.join()).toMatch(/not in catalog/);
  });

  it("drops rules targeting deleted products", () => {
    const config = validConfig();
    config.rules.push({
      criteria: [{ axisKey: "vibe", axisValue: "soft" }],
      productId: "prod-deleted",
      rank: 3,
    });
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(true);
    expect(result.draft!.flow.rules).toHaveLength(2);
  });

  it("errors when matrix mode loses all its rules", () => {
    const config = validConfig();
    config.rules = [
      { criteria: [{ axisKey: "vibe", axisValue: "bold" }], productId: "nope", rank: 1 },
    ];
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/All rules were dropped/);
  });

  it("rejects questions on photo axes", () => {
    const config = validConfig();
    config.axes[0].source = "photo";
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/photo axis/);
  });

  it("enforces option count caps", () => {
    const config = validConfig();
    config.questions[0].options = [config.questions[0].options[0]];
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/options/);
  });

  it("accepts hand-authored configs that exceed AI generation guidance (13-option question)", () => {
    // ORLY's live colors question has 13 chips; drafts captured from live
    // configs re-run this validator on every copilot patch, so real shapes
    // must pass.
    const config = validConfig();
    config.axes[0].values = Array.from({ length: 13 }, (_, i) => ({ value: `c_${i}`, label: `C${i}` }));
    config.questions[0].options = config.axes[0].values.map((v) => ({ label: v.label, axisValueValue: v.value }));
    config.questions[1].showIf = { axis_key: "vibe", axis_value: "c_0" }; // old 'bold' value replaced above
    config.rules = [{ criteria: [{ axisKey: "vibe", axisValue: "c_0" }], productId: "prod-1", rank: 1 }];
    const result = validateGeneratedConfig(config, catalog);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects matrix mode with an empty rules list", () => {
    const config = validConfig();
    config.rules = [];
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toMatch(/no rules/);
  });

  it("drops non-hex displayMeta swatches and clamps rank to >= 1", () => {
    const config = validConfig();
    config.questions[0].options[0].displayMeta = { swatch: "coral", swatch2: "#aabbcc" };
    config.rules[0].rank = 0;
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(true);
    const opt = result.draft!.flow.questions[0].options[0];
    expect(opt.displayMeta?.swatch).toBeUndefined();
    expect(opt.displayMeta?.swatch2).toBe("#aabbcc");
    expect(result.draft!.flow.rules[0].rank).toBe(1);
  });

  it("normalizes non-integer maxSelections and radius tokens", () => {
    const config = validConfig();
    config.questions[0].multiSelect = true;
    config.questions[0].maxSelections = 2.5;
    config.designTokens = { quiz_card_radius: 400.7 };
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(true);
    expect(result.draft!.flow.questions[0].maxSelections).toBeNull();
    expect(result.draft!.settings.quiz_card_radius).toBe(60);
  });

  it("drops invalid hex design tokens with a warning", () => {
    const config = validConfig();
    config.designTokens = { quiz_accent_color: "purple" };
    const result = validateGeneratedConfig(config, catalog);
    expect(result.ok).toBe(true);
    expect(result.draft!.settings.quiz_accent_color).toBeUndefined();
    expect(result.warnings.join()).toMatch(/not #rrggbb/);
  });
});

describe("normalizeFlowOrder", () => {
  it("renumbers axis positions from the question array order", () => {
    const result = validateGeneratedConfig(validConfig(), catalog);
    const flow = result.draft!.flow;
    // Reverse the questions (finish first) without touching axes.
    flow.questions = [...flow.questions].reverse();
    const normalized = normalizeFlowOrder(flow);
    const finishAxis = normalized.axes.find((a) => a.key === "finish")!;
    const vibeAxis = normalized.axes.find((a) => a.key === "vibe")!;
    expect(finishAxis.position).toBe(0);
    expect(vibeAxis.position).toBe(1);
  });

  it("places photo/unreferenced axes after question axes", () => {
    const result = validateGeneratedConfig(validConfig(), catalog);
    const flow = result.draft!.flow;
    flow.axes.push({
      key: "skin_shade",
      label: "Shade",
      source: "photo",
      position: 0,
      values: [{ value: "warm", label: "Warm", position: 0 }],
    });
    const normalized = normalizeFlowOrder(flow);
    const photo = normalized.axes.find((a) => a.key === "skin_shade")!;
    expect(photo.position).toBe(flow.questions.length);
  });
});

describe("serializeCatalog", () => {
  it("is deterministic across runs", () => {
    const a = serializeCatalog(catalog);
    const b = serializeCatalog([...catalog].reverse());
    expect(a.text).toBe(b.text);
  });

  it("excludes deleted products and variants", () => {
    const { text } = serializeCatalog(catalog);
    expect(text).not.toMatch(/prod-deleted/);
    expect(text).not.toMatch(/var-deleted/);
  });

  it("puts priority products first and flags truncation", () => {
    const { text, truncated } = serializeCatalog(catalog, { maxProducts: 1, priorityProductIds: ["prod-2"] });
    expect(text).toMatch(/prod-2/);
    expect(text).not.toMatch(/prod-1 \|/);
    expect(truncated).toBe(1);
    expect(text).toMatch(/do not assume completeness/);
  });
});
