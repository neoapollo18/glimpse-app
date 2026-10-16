// @vitest-environment jsdom
//
// 2026-10-16 merchant requests in the widget: Text & labels overrides
// (config.uiText), the results CTA setting, "why this fits" lines, and
// body typography. Same harness as widget-boutique.test.ts: the widget
// runs verbatim in jsdom in Studio-preview mode (no network).

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


const classic = (results: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  makeConfig({ uiStyle: null, ...overrides }, { layout: null, bundleEnabled: false, bundleDiscount: null, ...results });

describe("Text & labels overrides", () => {
  it("replace fixed strings and render as text, never markup", async () => {
    const root = await boot(
      classic({}, { uiText: { start: "Commencer", back: "Retour <b>x</b>", next: "Suivant" } }),
      "q2",
    );
    expect(root.querySelector(".gq-back")!.textContent).toBe("Retour <b>x</b>");
    expect(root.querySelector(".gq-back b")).toBeNull();
    expect(root.querySelector(".gq-continue-btn")!.textContent).toContain("Suivant");
  });

  it("untouched quizzes keep the English", async () => {
    const root = await boot(classic(), "q2");
    expect(root.querySelector(".gq-back")!.textContent).toBe("Back");
    expect(root.querySelector(".gq-continue-btn")!.textContent).toContain("Continue");
  });
});

describe("Results CTA", () => {
  it("default: Add to cart button with the View product link", async () => {
    const root = await boot(classic(), "results");
    const card = root.querySelector(".gq-match-card, .gq-match")!;
    expect(card.querySelector("button.gq-add-btn")).not.toBeNull();
    expect(card.querySelector("a.gq-view-link")!.getAttribute("href")).toBe("/products/love-current");
  });

  it("View product as the button, Add to cart as the link", async () => {
    const root = await boot(classic({ primaryCta: "view", viewProductLabel: "Découvrir la ressource" }), "results");
    const card = root.querySelector(".gq-match-card, .gq-match")!;
    const btn = card.querySelector("a.gq-add-btn.gq-cta-view")!;
    expect(btn.textContent).toBe("Découvrir la ressource");
    expect(btn.getAttribute("href")).toBe("/products/love-current");
    expect(card.querySelector("button.gq-cta-addlink")).not.toBeNull();
    expect(card.querySelector("button.gq-add-btn")).toBeNull();
  });

  it("secondary link off leaves just the button", async () => {
    const add = await boot(classic({ secondaryLink: false }), "results");
    expect(add.querySelector(".gq-view-link")).toBeNull();
    const view = await boot(classic({ primaryCta: "view", secondaryLink: false }), "results");
    expect(view.querySelector(".gq-cta-addlink")).toBeNull();
    expect(view.querySelector("a.gq-cta-view")).not.toBeNull();
  });

  it("templates follow the setting (Swiss)", async () => {
    const root = await boot(
      makeConfig({ uiStyle: null, template: "t5" }, { layout: null, bundleEnabled: false, bundleDiscount: null, primaryCta: "view", viewProductLabel: "Découvrir" }),
      "results",
    );
    const cards = root.querySelectorAll(".gq-t5r-card");
    expect(cards.length).toBeGreaterThan(0);
    const btn = cards[0].querySelector("a.gq-add-btn.gq-cta-view")!;
    expect(btn.textContent).toBe("Découvrir");
    expect(btn.getAttribute("href")).toBe("/products/love-current");
  });

  it("grid cards: View product button, add moves to the small link", async () => {
    const root = await boot(makeConfig({ uiStyle: null }, { primaryCta: "view" }), "results");
    const card = root.querySelector(".gq-gr-card")!;
    expect(card.querySelector("a.gq-cta-view")!.getAttribute("href")).toBe("/products/love-current");
    expect(card.querySelector("button.gq-add-btn.gq-gr-add")).toBeNull();
  });
});

describe("Why this fits", () => {
  it("the merchant line shows under the product; no line, no echo", async () => {
    const root = await boot(classic({ productWhy: { hailey: "Pour prier chaque jour" } }), "results");
    expect(root.textContent).toContain("Pour prier chaque jour");
  });

  it("templates show it as the card's why line", async () => {
    const root = await boot(
      makeConfig({ uiStyle: null, template: "t5" }, { layout: null, bundleEnabled: false, bundleDiscount: null, productWhy: { "love-current": "Un compagnon quotidien" } }),
      "results",
    );
    expect(root.querySelector(".gq-t5r-card .gq-t5r-why")!.textContent).toBe("Un compagnon quotidien");
  });
});

describe("Body typography", () => {
  it("body color drives the soft text and weight sets the variable", async () => {
    const root = await boot(classic({}, { bodyColor: "#222222", bodyWeight: "500" }), "intro");
    expect(root.style.getPropertyValue("--gq-ink-soft")).toBe("#222222");
    expect(root.style.getPropertyValue("--gq-body-weight")).toBe("500");
  });

  it("unset leaves the stylesheet defaults alone", async () => {
    const root = await boot(classic(), "intro");
    expect(root.style.getPropertyValue("--gq-ink-soft")).toBe("");
    expect(root.style.getPropertyValue("--gq-body-weight")).toBe("");
  });
});
