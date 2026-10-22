// @vitest-environment jsdom
//
// Classic-quiz additions from migration 088 (Glamnetic UI v2): the
// Boutique style, nail-swatch option style and grid results. Same harness
// as widget-templates.test.ts: the widget runs verbatim in jsdom in
// Studio-preview mode (no network). Structure only, no layout.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const IMG = "https://cdn.example.com/img/";
const opt = (label: string, axisValue: string, extra: Record<string, unknown> = {}) => ({
  label,
  axisValue,
  reasonText: null,
  imageUrl: null,
  showIf: null,
  selectAll: false,
  displayMeta: null,
  ...extra,
});
const question = (axisKey: string, prompt: string, extra: Record<string, unknown>, options: unknown[]) => ({
  axisKey,
  axisLabel: axisKey,
  prompt,
  helperText: null,
  multiSelect: false,
  maxSelections: null,
  screenGroup: null,
  showIf: null,
  optionStyle: null,
  options,
  ...extra,
});

// Glamnetic-shaped flow after the Glue question was dropped.
function makeFlow() {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      question("vibe", "What's the vibe?", { optionStyle: "boxed" }, [
        opt("Clean Girl Minimalism", "model_off_duty", { displayMeta: { sublabel: "quiet luxury" } }),
        opt("Soft & Sweet", "soft_sweet", { displayMeta: { sublabel: "pastel & pretty" } }),
        opt("After Hours", "after_hours", { displayMeta: { sublabel: "dark & moody" } }),
        opt("Surprise me", "model_off_duty", { selectAll: true }),
      ]),
      question("length", "How long do you like your nails?", { optionStyle: "visual", multiSelect: true }, [
        opt("Short", "short", { imageUrl: IMG + "short.png" }),
        opt("Medium", "medium", { imageUrl: IMG + "medium.png" }),
        opt("Long", "long", { imageUrl: IMG + "long.png" }),
        opt("Super Short", "super_short", { imageUrl: IMG + "ss.png" }),
      ]),
      question("shape", "Which shapes are you into?", { optionStyle: "visual", multiSelect: true }, [
        opt("Almond", "almond", { imageUrl: IMG + "a.png" }),
        opt("Coffin", "coffin", { imageUrl: IMG + "c.png" }),
        opt("Oval", "oval", { imageUrl: IMG + "o.png" }),
        opt("Round", "round", { imageUrl: IMG + "r.png" }),
        opt("Squoval", "squoval", { imageUrl: IMG + "sq.png" }),
        opt("Square", "square", { imageUrl: IMG + "s.png" }),
        opt("Open to anything", "almond", { selectAll: true }),
      ]),
      question("color_family", "Any colors calling your name?", { optionStyle: "nails", multiSelect: true, maxSelections: 3 }, [
        opt("Nudes & neutrals", "nudes", { displayMeta: { swatch: "#F8E6E0", swatch2: "#D6A899" } }),
        opt("Bold & bright", "bold", { displayMeta: { swatch: "#FF7A59", swatch2: "#3E7DE0", texture: "rainbow" } }),
        opt("Classic french & white", "french", { displayMeta: { swatch: "#F2D3D9", texture: "french" } }),
        opt("Surprise me", "nudes", { selectAll: true }),
      ]),
    ],
  };
}

function pj(handle: string, title: string, price: number) {
  return {
    id: 1,
    handle,
    title,
    price,
    available: true,
    featured_image: IMG + handle + ".jpg",
    images: [IMG + handle + ".jpg"],
    variants: [{ id: 900 + price, price, available: true, featured_image: null }],
  };
}
const PRODUCT_JSON = { "love-current": pj("love-current", "Love Current", 1799), hailey: pj("hailey", "Hailey", 1999), "nail-glue": pj("nail-glue", "Nail Glue", 799) };
const SAMPLE = {
  matrixApplied: false,
  partial: false,
  matches: [
    { productId: "p1", productHandle: "love-current", productName: "Love Current", variantTitle: "Default Title", variantNumericId: null, quantity: 1, reasons: ["Short almond, both your picks"] },
    { productId: "p2", productHandle: "hailey", productName: "Hailey", variantTitle: "Short / Almond", variantNumericId: null, quantity: 1, reasons: [] },
  ],
};

function makeConfig(overrides: Record<string, unknown> = {}, results: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: true,
    compactLayout: false,
    uiStyle: "boutique",
    landing: {
      eyebrow: "Find Your Nail Match",
      headline: "Meet Your **Perfect** Mani.",
      subtext: "Five quick questions.",
      trustItems: ["Photo optional", "15 sizes in every box", "Vegan & cruelty-free"],
      beforeImageUrl: IMG + "before.jpg",
      afterImageUrl: IMG + "after.jpg",
      visualCaption: null,
      altAudienceLabel: null,
      altAudienceUrl: null,
      photoNote: null,
    },
    gate: { enabled: true, headline: "Want to see it on you?", helper: null, photoLabel: "Upload photo", skipLabel: "Skip — show my matches now", privacyNote: "Never stored." },
    results: {
      layout: "grid",
      headlineNoPhoto: "We found your fit",
      subtext: "{count} picks made for your answers.",
      bundleEnabled: true,
      bundleLabel: "**Mix & match:** add any {range} sets and save {discount}",
      bundleSize: 3,
      bundleDiscount: { type: "percentage", value: 15, minQty: 2, note: "Bundle savings applied at checkout" },
      crossSell: null,
      ...results,
    },
    upsell: { title: "See these on you", body: null, cta: "Try them on me" },
    shadeGate: {},
    lead: { enabled: true, headline: "Want us to send your matches?", body: null, buttonLabel: "Save my results", skipLabel: "Skip", consentText: null },
    ...overrides,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bootListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const nativeAdd = window.addEventListener.bind(window);
function evalWidget() {
  while (bootListeners.length) {
    const [type, fn] = bootListeners.pop()!;
    window.removeEventListener(type, fn);
  }
  (window as any).addEventListener = (type: string, fn: EventListenerOrEventListenerObject, opts?: any) => {
    bootListeners.push([type, fn]);
    nativeAdd(type, fn, opts);
  };
  try {
    new Function(source)();
  } finally {
    (window as any).addEventListener = nativeAdd;
  }
}
async function boot(config: Record<string, unknown>, step: string) {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="glamrco.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = { config, flow: makeFlow(), sampleRecommend: SAMPLE, productJson: PRODUCT_JSON, studio: false, overrides: { step } };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  await wait(250);
  return document.getElementById("gleame-quiz-root")!;
}

describe("Boutique style (quiz_ui_style)", () => {
  it("turns on the compact layout by itself and tags the proof Before / Tried on", async () => {
    const root = await boot(makeConfig(), "intro");
    expect(root.classList.contains("gq-boutique")).toBe(true);
    expect(root.classList.contains("gq-compact")).toBe(true);
    const tags = Array.from(root.querySelectorAll(".gq-ba-tag")).map((t) => t.textContent);
    expect(tags).toEqual(["Before", "Tried on"]);
    // Vibe tiles carry a count class for count-based columns.
    expect(root.querySelector(".gq-ci-ask .gq-option-grid--boxed.gq-n-4")).not.toBeNull();
  });

  it("never applies to a template quiz", async () => {
    const root = await boot(makeConfig({ template: "t5" }), "intro");
    expect(root.classList.contains("gq-boutique")).toBe(false);
  });

  it("multi-select steps get a Continue bar with a live selection count", async () => {
    const root = await boot(makeConfig(), "q2");
    const bar = root.querySelector(".gq-cta-bar")!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector(".gq-continue-btn")).not.toBeNull();
    expect(root.querySelector(".gq-step--has-bar")).not.toBeNull();
    expect(bar.querySelector(".gq-cta-note")!.textContent).toBe("Pick any that fit");
    const tiles = root.querySelectorAll<HTMLButtonElement>(".gq-option-block .gq-option");
    tiles[0].click();
    tiles[1].click();
    expect(bar.querySelector(".gq-cta-note")!.textContent).toBe("2 selected · change any answer later");
    expect(root.querySelector(".gq-step-count")!.textContent).toBe("Step 2 of 4");
  });

  it("six shapes carry gq-n-6 (one desktop row, three per phone row)", async () => {
    const root = await boot(makeConfig(), "q3");
    expect(root.querySelector(".gq-option-grid.gq-n-6")).not.toBeNull();
    expect(root.querySelector(".gq-option-any")!.textContent).toBe("Open to anything");
  });

  it("photo step: skip becomes the bar's main action", async () => {
    const root = await boot(makeConfig(), "gate");
    const bar = root.querySelector(".gq-cta-bar--skip")!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector(".gq-skip-link")!.textContent).toContain("Skip");
    expect(root.querySelector(".gq-step-count")!.textContent).toBe("Optional");
  });

  it("photo step: skipping swaps the step for a loading screen", async () => {
    const root = await boot(makeConfig(), "gate");
    const step = root.querySelector(".gq-step")!;
    (root.querySelector(".gq-cta-bar--skip .gq-skip-link") as HTMLButtonElement).click();
    // Synchronous: the loading screen is up before recommend resolves.
    const view = step.querySelector(".gq-loading-view")!;
    expect(view).not.toBeNull();
    expect(step.classList.contains("gq-step--working")).toBe(true);
    expect(view.querySelector(".gq-lv-title")!.textContent).toBe("Finding your matches");
    expect(view.querySelector(".gq-lv-item--now .gq-working-caption")!.textContent).toBe("Picking your best matches");
    expect(view.getAttribute("role")).toBe("status");
  });

  it("standard classic quiz keeps the inline spinner on skip", async () => {
    const root = await boot(makeConfig({ uiStyle: null }, { layout: null }), "gate");
    const step = root.querySelector(".gq-step")!;
    (root.querySelector(".gq-skip-link") as HTMLButtonElement).click();
    expect(step.querySelector(".gq-loading-view")).toBeNull();
    expect(step.querySelector(".gq-working")).not.toBeNull();
    expect(step.classList.contains("gq-step--working")).toBe(false);
  });

  it("standard classic quiz is untouched: no bar, no count classes", async () => {
    const root = await boot(makeConfig({ uiStyle: null }), "q2");
    expect(root.classList.contains("gq-boutique")).toBe(false);
    expect(root.querySelector(".gq-cta-bar")).toBeNull();
    expect(root.querySelector("[class*='gq-n-']")).toBeNull();
  });
});

describe("nail swatches (option style 'nails')", () => {
  it("draws a nail per color with its gradient or texture, and Surprise me as a tile", async () => {
    const root = await boot(makeConfig(), "q4");
    const grid = root.querySelector(".gq-nail-grid")!;
    expect(grid).not.toBeNull();
    const nails = Array.from(grid.querySelectorAll(".gq-nail"));
    expect(nails.map((n) => n.className)).toEqual(["gq-nail", "gq-nail gq-nail--rainbow", "gq-nail gq-nail--french", "gq-nail gq-nail--any"]);
    expect(nails[0].getAttribute("style")).toBe("--gq-n1:#F8E6E0;--gq-n2:#D6A899");
    // The opt-out lives inside the grid, not below it.
    expect(root.querySelector(".gq-option-any")).toBeNull();
    const any = grid.querySelector<HTMLButtonElement>(".gq-option--nail-any")!;
    const first = grid.querySelector<HTMLButtonElement>(".gq-option--nail")!;
    first.click();
    any.click();
    expect(first.classList.contains("is-selected")).toBe(false);
    expect(any.classList.contains("is-selected")).toBe(true);
    first.click();
    expect(any.classList.contains("is-selected")).toBe(false);
  });
});

describe("grid results (quiz_results_layout)", () => {
  it("equal cards, answers line with Edit, mix & match bar, See on me, email card", async () => {
    const root = await boot(makeConfig({ emailPlacement: "after_results" }), "results");
    await wait(30);
    const res = root.querySelector(".gq-results--grid")!;
    expect(res).not.toBeNull();
    expect(res.querySelectorAll(".gq-gr-card")).toHaveLength(2);
    expect(res.querySelector(".gq-gr-eyebrow")!.textContent).toBe("Your matches");
    expect(res.querySelector(".gq-gr-answers-edit")!.textContent).toBe("Edit");
    expect(res.querySelector(".gq-gr-bundle-text")!.innerHTML).toBe("<strong>Mix &amp; match:</strong> add any 2 or 3 sets and save 15%");
    expect(res.querySelector(".gq-gr-bundle-status")!.textContent).toBe("0 of 2 added");
    // A live discount keeps the designed bar: no set picks.
    expect(res.querySelector(".gq-gr-bundle--set, .gq-gr-pick")).toBeNull();
    // Shopify's placeholder variant name never shows; a real one does.
    const specs = Array.from(res.querySelectorAll(".gq-gr-spec")).map((s) => s.textContent);
    expect(specs).toEqual(["Short / Almond"]);
    expect(res.querySelectorAll(".gq-gr-see")).toHaveLength(2);
    // The name links to the product page (the variant when known).
    const links = Array.from(res.querySelectorAll<HTMLAnchorElement>("a.gq-gr-link"));
    expect(links).toHaveLength(2);
    expect(links[0].querySelector(".gq-gr-name")).not.toBeNull();
    expect(links[0].getAttribute("href")).toMatch(/^\/products\/[a-z0-9-]+/);
    // No featured-layout pieces.
    expect(res.querySelector(".gq-answers-rail")).toBeNull();
    expect(res.querySelector(".gq-upsell")).toBeNull();
    // "Below the match" placement: capture is a card here, not a step.
    expect(res.querySelector(".gq-gr-lead .gq-lead-input")).not.toBeNull();
    expect(res.querySelector(".gq-gr-bagbar")).not.toBeNull();
  });

  it("adding sets counts toward the bundle and survives a re-render", async () => {
    const root = await boot(makeConfig(), "results");
    await wait(30);
    const adds = root.querySelectorAll<HTMLButtonElement>(".gq-gr-add");
    adds[0].click();
    await wait(20);
    expect(adds[0].textContent).toBe("Added");
    expect(root.querySelector(".gq-gr-bundle-status")!.textContent).toBe("1 of 2 added");
    expect(root.querySelector(".gq-gr-bagbar-sub")!.textContent).toBe("Add 1 more to save 15%");
    adds[1].click();
    await wait(20);
    expect(root.querySelector(".gq-gr-bundle")!.classList.contains("is-unlocked")).toBe(true);
    expect(root.querySelector(".gq-gr-bagbar-btn")!.textContent).toBe("View bag · $37.98");
  });

  it("email card: saving shows a neutral confirmation, not an inbox promise", async () => {
    const root = await boot(makeConfig({ emailPlacement: "after_results" }), "results");
    await wait(30);
    const card = root.querySelector(".gq-gr-lead")!;
    (card.querySelector(".gq-lead-input") as HTMLInputElement).value = "shopper@example.com";
    card.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(20);
    expect(card.querySelector(".gq-gr-lead-done")!.textContent).toBe("Saved \u2713 You\u2019re on the list.");
    expect(card.textContent).not.toContain("inbox");
  });

  it("default placement asks before results: lead step renders, no card on results", async () => {
    const results = await boot(makeConfig(), "results");
    await wait(30);
    expect(results.querySelector(".gq-results--grid")).not.toBeNull();
    expect(results.querySelector(".gq-gr-lead")).toBeNull();
    const lead = await boot(makeConfig(), "lead");
    expect(lead.querySelector(".gq-step--lead .gq-lead-input")).not.toBeNull();
  });

  it("no live discount: the set bar adds the picked sets and promises nothing", async () => {
    const root = await boot(makeConfig({}, { bundleDiscount: null, bundleSize: 2 }), "results");
    await wait(30);
    const bar = root.querySelector(".gq-gr-bundle--set")!;
    expect(bar.querySelector(".gq-gr-bundle-text")!.innerHTML).toBe("<strong>Mix &amp; match:</strong> add any 2+ sets");
    expect(root.textContent).not.toContain("save");
    const btn = bar.querySelector<HTMLButtonElement>(".gq-gr-bundle-add")!;
    expect(btn.textContent).toBe("Add 2 to bag · $37.98");
    btn.click();
    await wait(20);
    expect(btn.textContent).toBe("Added to bag ✓");
    expect(root.querySelector(".gq-gr-bagbar-btn")!.textContent).toBe("View bag · $37.98");
  });

  it("no live discount and fewer matches than the bundle asks for: no bar", async () => {
    const root = await boot(makeConfig({}, { bundleDiscount: null, bundleSize: 3 }), "results");
    await wait(30);
    expect((root.querySelector(".gq-gr-bundle--set") as HTMLElement).style.display).toBe("none");
    expect(root.textContent).not.toContain("save");
  });
});
