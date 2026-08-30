import { describe, it, expect } from "vitest";
import {
  slugifyKey,
  applyQuestionPatch,
  toSimpleQuestions,
} from "../question-axis.server";
import type { SaveRecommendationConfigInput } from "../quiz-draft.server";

// A flow shaped like a hand-styled (ORLY-like) config: displayMeta, showIf,
// images, screen groups — everything the simple editor must round-trip
// untouched.
function styledFlow(): SaveRecommendationConfigInput {
  return {
    axes: [
      {
        key: "skin_depth",
        label: "Skin depth",
        source: "photo",
        position: 0,
        values: [
          { value: "light", label: "Light", position: 0, swatchColor: "#f5d0b0" },
          { value: "deep", label: "Deep", position: 1, swatchColor: "#7a4b2a" },
        ],
      },
      {
        key: "occasion",
        label: "What's the occasion?",
        source: "user_question",
        position: 1,
        values: [
          { value: "everyday", label: "Everyday", position: 0 },
          { value: "party", label: "Party", position: 1 },
        ],
      },
      {
        key: "vibe",
        label: "Pick your vibe",
        source: "user_question",
        position: 2,
        values: [
          { value: "soft", label: "Soft", position: 0 },
          { value: "bold", label: "Bold", position: 1 },
        ],
      },
    ],
    questions: [
      {
        axisKey: "occasion",
        prompt: "What's the occasion?",
        helperText: "Pick one",
        multiSelect: false,
        maxSelections: null,
        screenGroup: "screen_one",
        showIf: null,
        optionStyle: "boxed",
        options: [
          {
            label: "Everyday",
            axisValueValue: "everyday",
            botResponse: "Nice!",
            reasonText: "Great for daily wear",
            imageUrl: "https://img/everyday.png",
            showIf: null,
            selectAll: false,
            displayMeta: { sublabel: "Low key", tag: "Popular", meterPct: 40 },
            position: 0,
          },
          {
            label: "Party",
            axisValueValue: "party",
            botResponse: null,
            reasonText: null,
            imageUrl: null,
            showIf: { axis_key: "skin_depth", axis_value: "light" },
            selectAll: false,
            displayMeta: null,
            position: 1,
          },
        ],
      },
      {
        axisKey: "vibe",
        prompt: "Pick your vibe",
        helperText: null,
        multiSelect: true,
        maxSelections: 2,
        screenGroup: null,
        showIf: { axis_key: "occasion", axis_value: "party" },
        optionStyle: "vibe",
        options: [
          {
            label: "Soft",
            axisValueValue: "soft",
            botResponse: null,
            reasonText: null,
            imageUrl: null,
            showIf: null,
            selectAll: false,
            displayMeta: null,
            position: 0,
          },
          {
            label: "Bold",
            axisValueValue: "bold",
            botResponse: null,
            reasonText: null,
            imageUrl: null,
            showIf: null,
            selectAll: false,
            displayMeta: null,
            position: 1,
          },
        ],
      },
    ],
    rules: [
      {
        criteria: { occasion: "party", vibe: "bold" },
        variantId: "v-1",
        productId: null,
        rank: 1,
        quantity: 1,
      },
    ],
  };
}

describe("slugifyKey", () => {
  it("derives snake_case keys that pass the RPC ID constraint", () => {
    const ID_RE = /^[a-z_][a-z0-9_]*$/;
    for (const text of ["What's the occasion?", "2-in-1 topper!", "  ", "Émigré Chic"]) {
      const key = slugifyKey(text, new Set());
      expect(key).toMatch(ID_RE);
      expect(key.startsWith("_")).toBe(false);
    }
    expect(slugifyKey("What's the occasion?", new Set())).toBe("what_s_the_occasion");
  });

  it("suffixes on collision", () => {
    const taken = new Set(["occasion"]);
    expect(slugifyKey("Occasion", taken)).toBe("occasion_2");
    taken.add("occasion_2");
    expect(slugifyKey("Occasion!", taken)).toBe("occasion_3");
  });
});

describe("applyQuestionPatch upsert (rename)", () => {
  it("renames prompt/labels but keeps keys, styling, conditions, and rules intact", () => {
    const flow = styledFlow();
    const result = applyQuestionPatch(flow, {
      kind: "upsert",
      question: {
        axisKey: "occasion",
        prompt: "Where are you wearing them?",
        helperText: "Pick one",
        multiSelect: false,
        maxSelections: null,
        options: [
          { axisValueValue: "everyday", label: "Every day", reasonText: "Great for daily wear" },
          { axisValueValue: "party", label: "Party", reasonText: null },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.flow.questions.find((x) => x.axisKey === "occasion")!;
    // Key stable, styling untouched
    expect(q.prompt).toBe("Where are you wearing them?");
    expect(q.screenGroup).toBe("screen_one");
    expect(q.optionStyle).toBe("boxed");
    const everyday = q.options.find((o) => o.axisValueValue === "everyday")!;
    expect(everyday.label).toBe("Every day");
    expect(everyday.displayMeta).toEqual({ sublabel: "Low key", tag: "Popular", meterPct: 40 });
    expect(everyday.imageUrl).toBe("https://img/everyday.png");
    expect(everyday.botResponse).toBe("Nice!");
    const party = q.options.find((o) => o.axisValueValue === "party")!;
    expect(party.showIf).toEqual({ axis_key: "skin_depth", axis_value: "light" });
    // Axis label follows prompt; value labels follow option labels
    const axis = result.flow.axes.find((a) => a.key === "occasion")!;
    expect(axis.label).toBe("Where are you wearing them?");
    expect(axis.values.find((v) => v.value === "everyday")!.label).toBe("Every day");
    // Rules untouched
    expect(result.flow.rules).toEqual(flow.rules);
    // Photo axis content untouched (position may renumber — normalizeFlowOrder
    // sends unreferenced axes to the tail, same as the publish path)
    const photo = result.flow.axes.find((a) => a.key === "skin_depth")!;
    const photoBefore = flow.axes.find((a) => a.key === "skin_depth")!;
    expect({ ...photo, position: 0 }).toEqual({ ...photoBefore, position: 0 });
  });

  it("blocks removing an option a rule depends on", () => {
    const result = applyQuestionPatch(styledFlow(), {
      kind: "upsert",
      question: {
        axisKey: "vibe",
        prompt: "Pick your vibe",
        helperText: null,
        multiSelect: true,
        maxSelections: 2,
        options: [{ axisValueValue: "soft", label: "Soft", reasonText: null }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("recommendation rule");
  });

  it("blocks removing an option a showIf depends on", () => {
    // vibe's question-level showIf references occasion=party
    const result = applyQuestionPatch(styledFlow(), {
      kind: "upsert",
      question: {
        axisKey: "occasion",
        prompt: "What's the occasion?",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        options: [{ axisValueValue: "everyday", label: "Everyday", reasonText: null }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // party is referenced by BOTH a rule and vibe's showIf; the rule check
    // fires first — either message is a correct block.
    expect(result.error).toMatch(/rule|condition/);
  });

  it("adds new options with derived values and blocks editing collapsed variants", () => {
    const flow = styledFlow();
    const added = applyQuestionPatch(flow, {
      kind: "upsert",
      question: {
        axisKey: "occasion",
        prompt: "What's the occasion?",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        options: [
          { axisValueValue: "everyday", label: "Everyday", reasonText: null },
          { axisValueValue: "party", label: "Party", reasonText: null },
          { axisValueValue: null, label: "Wedding day!", reasonText: "Timeless" },
        ],
      },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const axis = added.flow.axes.find((a) => a.key === "occasion")!;
    expect(axis.values.map((v) => v.value)).toEqual(["everyday", "party", "wedding_day"]);

    // Duplicate-value variants (hand-built) hard-stop the simple editor
    const dup = styledFlow();
    dup.questions[0].options.push({ ...dup.questions[0].options[1] });
    const blocked = applyQuestionPatch(dup, {
      kind: "upsert",
      question: {
        axisKey: "occasion",
        prompt: "x",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        options: [{ axisValueValue: "party", label: "Party", reasonText: null }],
      },
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toContain("advanced rules editor");
  });

  it("creates a new question with a collision-safe axis key", () => {
    const result = applyQuestionPatch(styledFlow(), {
      kind: "upsert",
      question: {
        axisKey: null,
        prompt: "Vibe", // slugs to "vibe", which already exists → "_2" suffix
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        options: [
          { axisValueValue: null, label: "Chill", reasonText: null },
          { axisValueValue: null, label: "Chill", reasonText: null },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newAxis = result.flow.axes.find((a) => a.key === "vibe_2")!;
    expect(newAxis).toBeDefined();
    expect(newAxis.values.map((v) => v.value)).toEqual(["chill", "chill_2"]);
    expect(result.flow.questions).toHaveLength(3);
  });
});

describe("applyQuestionPatch delete", () => {
  it("requires confirmation when rules depend on the question, then drops them", () => {
    const first = applyQuestionPatch(styledFlow(), {
      kind: "delete",
      axisKey: "vibe",
      confirmRuleDrop: false,
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.needsConfirm).toBe(true);
    expect(first.droppedRuleCount).toBe(1);

    const confirmed = applyQuestionPatch(styledFlow(), {
      kind: "delete",
      axisKey: "vibe",
      confirmRuleDrop: true,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.flow.rules).toHaveLength(0);
    expect(confirmed.flow.axes.find((a) => a.key === "vibe")).toBeUndefined();
    expect(confirmed.flow.questions).toHaveLength(1);
  });

  it("nulls showIf conditions that referenced the deleted question", () => {
    const result = applyQuestionPatch(styledFlow(), {
      kind: "delete",
      axisKey: "occasion",
      confirmRuleDrop: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vibe = result.flow.questions.find((q) => q.axisKey === "vibe")!;
    expect(vibe.showIf).toBeNull();
  });

  it("refuses to delete photo axes", () => {
    const result = applyQuestionPatch(styledFlow(), {
      kind: "delete",
      axisKey: "skin_depth",
      confirmRuleDrop: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("applyQuestionPatch reorder", () => {
  it("reorders questions and renumbers axis positions", () => {
    const result = applyQuestionPatch(styledFlow(), {
      kind: "reorder",
      axisKeys: ["vibe", "occasion"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flow.questions.map((q) => q.axisKey)).toEqual(["vibe", "occasion"]);
    const vibeAxis = result.flow.axes.find((a) => a.key === "vibe")!;
    const occasionAxis = result.flow.axes.find((a) => a.key === "occasion")!;
    expect(vibeAxis.position).toBeLessThan(occasionAxis.position);
  });

  it("rejects stale reorder lists", () => {
    const result = applyQuestionPatch(styledFlow(), {
      kind: "reorder",
      axisKeys: ["vibe"],
    });
    expect(result.ok).toBe(false);
  });
});

describe("toSimpleQuestions", () => {
  it("flags advanced settings so the UI can disclose them", () => {
    const simple = toSimpleQuestions(styledFlow());
    expect(simple[0].hasAdvanced).toBe(true); // screenGroup + optionStyle
    expect(simple[0].options[1].hasAdvanced).toBe(true); // showIf
    expect(simple[1].options[0].hasAdvanced).toBe(false);
  });
});
