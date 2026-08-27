import { describe, it, expect } from "vitest";
import {
  applyUpdateQuestion,
  applyUpdateQuestionOptions,
  applyAddQuestion,
  applyRemoveQuestion,
  applyReorderQuestions,
  applyUpdateCopy,
  applyUpdateDesignTokens,
  applyUpdateRules,
  applyUpdateGuidance,
  applyGetDraftDetails,
  type DraftShape,
} from "../quiz-copilot-tools.server";
import {
  GENERATED_COPY_KEYS,
  GENERATED_DESIGN_KEYS,
  type CatalogProduct,
} from "../quiz-config-schema.server";

const catalog: CatalogProduct[] = [
  { id: "prod-1", name: "Product One", variants: [{ id: "var-1", title: "Shade A" }] },
  { id: "prod-2", name: "Product Two", variants: [] },
];

function baseDraft(): DraftShape {
  return {
    flow: {
      axes: [
        {
          key: "vibe",
          label: "Vibe",
          source: "user_question",
          position: 0,
          values: [
            { value: "bold", label: "Bold", position: 0 },
            { value: "soft", label: "Soft", position: 1 },
          ],
        },
        {
          key: "finish",
          label: "Finish",
          source: "user_question",
          position: 1,
          values: [
            { value: "creme", label: "Creme", position: 0 },
            { value: "sheer", label: "Sheer", position: 1 },
          ],
        },
      ],
      questions: [
        {
          axisKey: "vibe",
          prompt: "What's the vibe?",
          options: [
            { label: "Bold", axisValueValue: "bold", botResponse: null, position: 0 },
            { label: "Soft", axisValueValue: "soft", botResponse: null, position: 1 },
          ],
        },
        {
          axisKey: "finish",
          prompt: "Pick a finish",
          options: [
            { label: "Creme", axisValueValue: "creme", botResponse: null, position: 0 },
            { label: "Sheer", axisValueValue: "sheer", botResponse: null, position: 1 },
          ],
        },
      ],
      rules: [
        { criteria: { vibe: "bold" }, variantId: "var-1", productId: null, rank: 1, quantity: 1 },
      ],
    },
    settings: { recommendation_mode: "matrix" },
  };
}

describe("applyUpdateQuestion", () => {
  it("patches the prompt and reports the right target", () => {
    const result = applyUpdateQuestion(baseDraft(), { axisKey: "vibe", patch: { prompt: "What's the vibe? ✨" } }, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.flow.questions[0].prompt).toBe("What's the vibe? ✨");
      expect(result.summary.target).toBe("Q1");
    }
  });

  it("does not mutate the input draft", () => {
    const draft = baseDraft();
    applyUpdateQuestion(draft, { axisKey: "vibe", patch: { prompt: "changed" } }, catalog);
    expect(draft.flow.questions[0].prompt).toBe("What's the vibe?");
  });

  it("rejects unknown axis", () => {
    const result = applyUpdateQuestion(baseDraft(), { axisKey: "nope", patch: { prompt: "x" } }, catalog);
    expect(result.ok).toBe(false);
  });

  it("rejects a showIf pointing at a later axis (revalidation gate)", () => {
    const result = applyUpdateQuestion(
      baseDraft(),
      { axisKey: "vibe", patch: { showIf: { axis_key: "finish", axis_value: "creme" } } },
      catalog,
    );
    expect(result.ok).toBe(false);
  });
});

describe("applyUpdateQuestionOptions", () => {
  it("replaces options and auto-declares new axis values", () => {
    const result = applyUpdateQuestionOptions(
      baseDraft(),
      {
        axisKey: "vibe",
        options: [
          { label: "Main Character", axisValueValue: "main_character", valueLabel: "Main Character" },
          { label: "Clean Girl", axisValueValue: "clean_girl", valueLabel: "Clean Girl" },
        ],
      },
      catalog,
    );
    // Rule references vibe=bold which no option records anymore, but rules
    // only need DECLARED values — old values stay on the axis.
    expect(result.ok).toBe(true);
    if (result.ok) {
      const axis = result.draft.flow.axes.find((a) => a.key === "vibe")!;
      expect(axis.values.map((v) => v.value)).toContain("main_character");
      expect(result.draft.flow.questions[0].options).toHaveLength(2);
    }
  });

  it("preserves existing option images by position", () => {
    const draft = baseDraft();
    draft.flow.questions[0].options[0].imageUrl = "https://img.example/bold.jpg";
    const result = applyUpdateQuestionOptions(
      draft,
      { axisKey: "vibe", options: [{ label: "Bolder", axisValueValue: "bold" }, { label: "Softer", axisValueValue: "soft" }] },
      catalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.flow.questions[0].options[0].imageUrl).toBe("https://img.example/bold.jpg");
  });
});

describe("applyAddQuestion / applyRemoveQuestion / applyReorderQuestions", () => {
  it("adds a question with a new axis", () => {
    const result = applyAddQuestion(
      baseDraft(),
      {
        axis: { key: "budget", label: "Budget", values: [{ value: "low", label: "Low" }, { value: "high", label: "High" }] },
        position: 2,
        question: {
          prompt: "What's your budget?",
          options: [
            { label: "Low", axisValueValue: "low" },
            { label: "High", axisValueValue: "high" },
          ],
        },
      },
      catalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.flow.questions).toHaveLength(3);
  });

  it("blocks removing an axis still referenced by rules", () => {
    const result = applyRemoveQuestion(baseDraft(), { axisKey: "vibe", removeAxis: true }, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/referenced by rules/);
  });

  it("removes a question while keeping the axis", () => {
    const result = applyRemoveQuestion(baseDraft(), { axisKey: "finish", removeAxis: false }, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.flow.questions).toHaveLength(1);
      expect(result.draft.flow.axes).toHaveLength(2);
    }
  });

  it("reorders with a full permutation only", () => {
    const bad = applyReorderQuestions(baseDraft(), { axisKeysInOrder: ["finish"] }, catalog);
    expect(bad.ok).toBe(false);
    const good = applyReorderQuestions(baseDraft(), { axisKeysInOrder: ["finish", "vibe"] }, catalog);
    // "finish" first is fine — no showIf depends on ordering in baseDraft
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.draft.flow.questions[0].axisKey).toBe("finish");
  });
});

describe("settings appliers", () => {
  it("updates whitelisted copy fields and rejects unknown ones", () => {
    const good = applyUpdateCopy(baseDraft(), { fields: { quiz_headline: "Find your shade" } }, catalog);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.draft.settings.quiz_headline).toBe("Find your shade");
    const bad = applyUpdateCopy(baseDraft(), { fields: { hero_headline: "nope" } }, catalog);
    expect(bad.ok).toBe(false);
  });

  it("validates design token hex colors", () => {
    const bad = applyUpdateDesignTokens(baseDraft(), { fields: { quiz_accent_color: "red" } }, catalog);
    expect(bad.ok).toBe(false);
    const good = applyUpdateDesignTokens(baseDraft(), { fields: { quiz_accent_color: "#aa3366", quiz_progress_style: "bar" } }, catalog);
    expect(good.ok).toBe(true);
  });

  it("updates guidance", () => {
    const result = applyUpdateGuidance(baseDraft(), { aiGuidance: "LAYER RULES:\n1. Always diversify." }, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.settings.ai_guidance).toMatch(/LAYER RULES/);
  });
});

describe("applyUpdateRules", () => {
  it("adds a valid rule and rejects hallucinated targets", () => {
    const good = applyUpdateRules(
      baseDraft(),
      { mode: "add", rules: [{ criteria: [{ axisKey: "vibe", axisValue: "soft" }], productId: "prod-2", rank: 2 }] },
      catalog,
    );
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.draft.flow.rules).toHaveLength(2);

    // A hallucinated target gets dropped by the validator; with matrix mode
    // and the real rule still present this passes, so test replace_all where
    // ONLY the hallucinated rule remains -> validator errors.
    const bad = applyUpdateRules(
      baseDraft(),
      { mode: "replace_all", rules: [{ criteria: [{ axisKey: "vibe", axisValue: "soft" }], productId: "prod-fake", rank: 1 }] },
      catalog,
    );
    expect(bad.ok).toBe(false);
  });

  it("blocks removing the LAST rule while in matrix mode", () => {
    // matrix + zero rules is unpublishable; the model gets told to switch
    // modes first instead of silently emptying the matrix.
    const result = applyUpdateRules(baseDraft(), { mode: "remove", removeWhere: { criteriaAxis: "vibe" } }, catalog);
    expect(result.ok).toBe(false);
  });

  it("removes rules by criteria axis when not in matrix mode", () => {
    const draft = baseDraft();
    draft.settings.recommendation_mode = "ai";
    const result = applyUpdateRules(draft, { mode: "remove", removeWhere: { criteriaAxis: "vibe" } }, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.flow.rules).toHaveLength(0);
  });
});

describe("whitelist drift contract", () => {
  // The generator's schema keys and the copilot's editable keys are separate
  // registries; the copilot must accept AT LEAST everything generation can
  // emit, or the model's own tool calls get rejected as "unknown fields".
  it("copilot accepts every generated copy key", () => {
    for (const key of GENERATED_COPY_KEYS) {
      const value = key === "quiz_trust_items" ? ["a", "b"] : "text";
      const result = applyUpdateCopy(baseDraft(), { fields: { [key]: value } }, catalog);
      expect(result.ok, `copy key ${key} rejected`).toBe(true);
    }
  });

  it("copilot accepts every generated design key", () => {
    const sample: Record<string, unknown> = {
      quiz_accent_color: "#aa3366", quiz_ink_color: "#111111", quiz_card_bg_color: "#ffffff",
      quiz_line_color: "#dddddd", quiz_cta_color: "#000000", quiz_button_radius: 8,
      quiz_card_radius: 12, quiz_progress_style: "bar", quiz_intro_layout: "split",
      quiz_animation_style: "minimal",
    };
    for (const key of GENERATED_DESIGN_KEYS) {
      const result = applyUpdateDesignTokens(baseDraft(), { fields: { [key]: sample[key] ?? "#aabbcc" } }, catalog);
      expect(result.ok, `design key ${key} rejected`).toBe(true);
    }
  });
});

describe("option image preservation", () => {
  it("keeps images attached by axis value across reorders", () => {
    const draft = baseDraft();
    draft.flow.questions[0].options[0].imageUrl = "https://img.example/bold.jpg"; // bold
    const result = applyUpdateQuestionOptions(
      draft,
      // Reversed order: soft first
      { axisKey: "vibe", options: [{ label: "Softer", axisValueValue: "soft" }, { label: "Bolder", axisValueValue: "bold" }] },
      catalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const opts = result.draft.flow.questions[0].options;
      expect(opts[0].imageUrl).toBeNull(); // soft never had an image
      expect(opts[1].imageUrl).toBe("https://img.example/bold.jpg"); // bold keeps its own
    }
  });
});

describe("applyGetDraftDetails", () => {
  it("returns a question slice read-only", () => {
    const result = applyGetDraftDetails(baseDraft(), { section: "question", axisKey: "vibe" }, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readOnly).toBe(true);
      expect(JSON.stringify(result.data)).toMatch(/What's the vibe\?/);
    }
  });
});
