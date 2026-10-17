import { describe, it, expect } from "vitest";
import { UI_TEXT_ENTRIES } from "../quiz-ui-text";
import {
  acceptTranslation,
  applyTranslations,
  collectTranslatable,
  exceedsTranslateBudget,
  TRANSLATE_MAX_ITEMS,
  TRANSLATE_MAX_SOURCE_CHARS,
} from "../quiz-translate";

// Translate this quiz (2026-10-16): collect the quiz's current text,
// accept only translations that kept their placeholders, write them back
// without clobbering a field edited mid-translation.

const P1 = "11111111-1111-4111-8111-111111111111";

function draft() {
  return {
    flow: {
      axes: [{ key: "vibe", label: "Vibe" }],
      questions: [
        {
          axisKey: "vibe",
          prompt: "What's the vibe?",
          helperText: "Pick one",
          options: [
            { label: "Bold", axisValueValue: "bold", reasonText: "Made for statement looks", displayMeta: { sublabel: "loud & proud" } },
            { label: "Soft", axisValueValue: "soft", reasonText: null, displayMeta: null },
          ],
        },
      ],
      rules: [],
    },
    settings: {
      quiz_template: null,
      quiz_ui_text: { back: "Go back" },
      quiz_view_product_label: "View full product",
      quiz_headline: "Find your **perfect** shade",
      quiz_subtext: "",
      quiz_trust_items: ["Free shipping", "Vegan"],
      quiz_product_why: { [P1]: "Gentle enough for every day" },
    } as Record<string, unknown>,
  };
}

describe("collectTranslatable", () => {
  it("labels only: one item per built-in string, as the shopper sees it now", () => {
    const items = collectTranslatable(draft(), { content: false, template: null });
    expect(items).toHaveLength(UI_TEXT_ENTRIES.length);
    expect(items.find((i) => i.target.kind === "ui" && i.target.key === "back")!.text).toBe("Go back");
    expect(items.find((i) => i.target.kind === "ui" && i.target.key === "next")!.text).toBe("Continue");
    expect(items.find((i) => i.target.kind === "column" && i.target.key === "quiz_view_product_label")!.text).toBe("View full product");
  });

  it("with content: headlines, trust items, questions, answers, sublabels, reasons, why lines; blanks skipped", () => {
    const items = collectTranslatable(draft(), { content: true, template: "t4" });
    const texts = items.slice(UI_TEXT_ENTRIES.length).map((i) => i.text);
    expect(texts).toEqual([
      "Find your **perfect** shade",
      "Free shipping",
      "Vegan",
      "Vibe",
      "What's the vibe?",
      "Pick one",
      "Bold",
      "Made for statement looks",
      "loud & proud",
      "Soft",
      "Gentle enough for every day",
    ]);
    // Template defaults are what gets translated for a template quiz.
    expect(items.find((i) => i.target.kind === "ui" && i.target.key === "next")!.text).toBe("Next");
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("acceptTranslation", () => {
  it("keeps placeholders and bold markers or rejects the line", () => {
    expect(acceptTranslation("Add {count} to bag · {total}", "Ajouter {count} au panier · {total}")).toBe("Ajouter {count} au panier · {total}");
    expect(acceptTranslation("Add {count} to bag", "Ajouter au panier")).toBeNull();
    expect(acceptTranslation("Find your **perfect** shade", "Trouvez votre teinte **parfaite**")).toBe("Trouvez votre teinte **parfaite**");
    expect(acceptTranslation("Find your **perfect** shade", "Trouvez votre teinte parfaite")).toBeNull();
    expect(acceptTranslation("Back", "  ")).toBeNull();
    expect(acceptTranslation("Back", 3)).toBeNull();
    expect(acceptTranslation("Back", "x".repeat(200))).toBeNull();
  });

  it("rejects angle brackets the source didn't have", () => {
    expect(acceptTranslation("Your photo", '<img src=x onerror="alert(1)">')).toBeNull();
    expect(acceptTranslation("Before", "Avant >")).toBeNull();
    // Brackets the merchant wrote, and ordinary punctuation, still pass.
    expect(acceptTranslation("Shades we <3", "Les teintes qu'on <3")).toBe("Les teintes qu'on <3");
    expect(acceptTranslation("Before & after", "« Avant » & après →")).toBe("« Avant » & après →");
  });
});

describe("applyTranslations", () => {
  it("writes every target back", () => {
    const d = draft();
    const items = collectTranslatable(d, { content: true, template: null });
    const fr: Record<string, string> = {};
    for (const i of items) fr[i.id] = `FR ${i.text}`;
    const { draft: out, applied, skipped } = applyTranslations(d, items, fr, null);
    expect(applied).toBe(items.length);
    expect(skipped).toBe(0);
    expect((out.settings.quiz_ui_text as Record<string, string>).back).toBe("FR Go back");
    expect((out.settings.quiz_ui_text as Record<string, string>).next).toBe("FR Continue");
    expect(out.settings.quiz_view_product_label).toBe("FR View full product");
    expect(out.settings.end_restart_label).toBe("FR Try another look");
    expect(out.settings.quiz_headline).toBe("FR Find your **perfect** shade");
    expect(out.settings.quiz_trust_items).toEqual(["FR Free shipping", "FR Vegan"]);
    expect(out.flow.axes[0].label).toBe("FR Vibe");
    const q = out.flow.questions[0];
    expect([q.prompt, q.helperText, q.options[0].label, q.options[0].reasonText]).toEqual([
      "FR What's the vibe?",
      "FR Pick one",
      "FR Bold",
      "FR Made for statement looks",
    ]);
    expect((q.options[0].displayMeta as Record<string, string>).sublabel).toBe("FR loud & proud");
    expect((out.settings.quiz_product_why as Record<string, string>)[P1]).toBe("FR Gentle enough for every day");
    // The input draft is untouched.
    expect(d.settings.quiz_headline).toBe("Find your **perfect** shade");
  });

  it("a field edited while translating keeps the edit; missing translations are skipped", () => {
    const d = draft();
    const items = collectTranslatable(d, { content: true, template: null });
    const fr: Record<string, string> = {};
    for (const i of items) if (i.text !== "Vegan") fr[i.id] = `FR ${i.text}`;
    const current = draft();
    current.settings.quiz_headline = "Merchant changed this";
    current.flow.questions[0].prompt = "Also changed";
    const { draft: out, skipped } = applyTranslations(current, items, fr, null);
    expect(out.settings.quiz_headline).toBe("Merchant changed this");
    expect(out.flow.questions[0].prompt).toBe("Also changed");
    expect(out.settings.quiz_trust_items).toEqual(["FR Free shipping", "Vegan"]);
    expect(skipped).toBe(3);
  });

  it("answers sharing a value (a select-all reusing an anchor) each land on their own option", () => {
    const shared = () => {
      const d = draft();
      d.flow.questions[0].options = [
        { label: "Almond", axisValueValue: "almond", reasonText: null, displayMeta: null },
        { label: "Open to anything", axisValueValue: "almond", reasonText: "Any shape works", displayMeta: { sublabel: "any" } },
      ];
      return d;
    };
    const d = shared();
    const items = collectTranslatable(d, { content: true, template: null });
    const fr: Record<string, string> = {};
    for (const i of items) fr[i.id] = `FR ${i.text}`;
    const { draft: out, skipped } = applyTranslations(d, items, fr, null);
    expect(skipped).toBe(0);
    const [a, b] = out.flow.questions[0].options;
    expect([a.label, b.label, b.reasonText]).toEqual(["FR Almond", "FR Open to anything", "FR Any shape works"]);
    expect((b.displayMeta as Record<string, string>).sublabel).toBe("FR any");

    // Reordered while translating: both options' lines are skipped, never
    // written onto the other answer.
    const reordered = shared();
    reordered.flow.questions[0].options.reverse();
    const r = applyTranslations(reordered, items, fr, null);
    const [x, y] = r.draft.flow.questions[0].options;
    expect([x.label, x.reasonText, y.label]).toEqual(["Open to anything", "Any shape works", "Almond"]);
    expect((x.displayMeta as Record<string, string>).sublabel).toBe("any");
    expect(r.skipped).toBe(4);

    // Same position but a different value: skipped too.
    const revalued = shared();
    revalued.flow.questions[0].options[1].axisValueValue = "coffin";
    const v = applyTranslations(revalued, items, fr, null);
    expect(v.draft.flow.questions[0].options[1].label).toBe("Open to anything");
    expect(v.draft.flow.questions[0].options[0].label).toBe("FR Almond");
    expect(v.skipped).toBe(3);
  });
});

describe("exceedsTranslateBudget", () => {
  it("a large real quiz (12 questions x 16 answers, 300 why lines) stays well under", () => {
    const d = draft();
    d.flow.questions = Array.from({ length: 12 }, (_, q) => ({
      axisKey: `axis_${q}`,
      prompt: "Which finish do you reach for on a normal weekday morning?",
      helperText: "Pick the one closest to your routine",
      options: Array.from({ length: 16 }, (_, o) => ({
        label: `Answer choice number ${o} with a few words`,
        axisValueValue: `v${o}`,
        reasonText: "r".repeat(200),
        displayMeta: { sublabel: "a short sublabel line" },
      })),
    }));
    d.settings.quiz_product_why = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`11111111-1111-4111-8111-${String(i).padStart(12, "0")}`, "w".repeat(160)]),
    );
    const items = collectTranslatable(d, { content: true, template: null });
    expect(items.reduce((n, i) => n + i.text.length, 0)).toBeLessThan(TRANSLATE_MAX_SOURCE_CHARS / 1.5);
    expect(items.length).toBeLessThan(TRANSLATE_MAX_ITEMS / 2);
    expect(exceedsTranslateBudget(items)).toBe(false);
  });

  it("a config padded with thousands of long trust items is refused", () => {
    const d = draft();
    d.settings.quiz_trust_items = Array.from({ length: 10_000 }, (_, i) => `${i} ${"t".repeat(395)}`);
    expect(exceedsTranslateBudget(collectTranslatable(d, { content: true, template: null }))).toBe(true);
  });

  it("a config padded with many tiny trust items is refused even under the character budget", () => {
    // 190k one-letter items: ~194k chars, under 200000, but ~3,200 Opus
    // calls at 60 items each.
    const d = draft();
    d.settings.quiz_trust_items = Array.from({ length: 190_000 }, () => "t");
    const items = collectTranslatable(d, { content: true, template: null });
    expect(items.reduce((n, i) => n + i.text.length, 0)).toBeLessThan(TRANSLATE_MAX_SOURCE_CHARS);
    expect(exceedsTranslateBudget(items)).toBe(true);
  });

  it("refuses past 200000 characters", () => {
    const item = (text: string) => ({ id: "1", text, target: { kind: "ui" as const, key: "back" } });
    expect(exceedsTranslateBudget([item("x".repeat(200_000))])).toBe(false);
    expect(exceedsTranslateBudget([item("x".repeat(199_999)), item("yy")])).toBe(true);
  });

  it("refuses past 3000 items however short", () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: String(i + 1), text: "x", target: { kind: "trust" as const, index: i } }));
    expect(exceedsTranslateBudget(items(TRANSLATE_MAX_ITEMS))).toBe(false);
    expect(exceedsTranslateBudget(items(TRANSLATE_MAX_ITEMS + 1))).toBe(true);
  });
});
