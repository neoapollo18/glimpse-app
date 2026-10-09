// @vitest-environment jsdom
//
// Classic-quiz widget additions from migration 086: the compact layout
// (ORLY mobile rebuild), finish previews, swatch-pair chips, the results
// cross-sell row and the bundle discount on the "add all" button. Same
// harness as widget-templates.test.ts: the widget source runs verbatim in
// jsdom in Studio-preview mode (no network). Structure only, no layout.

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

// ORLY-shaped flow: single-select rich vibe (hosted on the intro), a
// multi-select color chip question with light→deep pairs, and a
// multi-select finish question with texture previews.
function makeFlow() {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      {
        axisKey: "vibe",
        axisLabel: "Vibe",
        prompt: "What’s the vibe?",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: "rich",
        options: [
          opt("Model Off-Duty", "model_off_duty", { displayMeta: { sublabel: "effortless, barely-there" } }),
          opt("Soft & Sweet", "soft_sweet", { displayMeta: { sublabel: "pastel & pretty" } }),
          opt("Timeless", "timeless", { displayMeta: { sublabel: "classic, always chic" } }),
          opt("Full Glam", "full_glam", { displayMeta: { sublabel: "maximum sparkle" } }),
        ],
      },
      {
        axisKey: "colors",
        axisLabel: "Colors",
        prompt: "Any colors you’re drawn to?",
        helperText: "Pick up to 3 — or let us surprise you.",
        multiSelect: true,
        maxSelections: 3,
        screenGroup: null,
        showIf: null,
        optionStyle: "chips",
        options: [
          opt("Reds", "reds", { displayMeta: { swatch: "#E8442E", swatch2: "#7A1220" } }),
          opt("Pinks", "pinks", { displayMeta: { swatch: "#F9D5DC", swatch2: "#E0407A" } }),
          opt("Greys", "greys", { displayMeta: { swatch: "#9e9e9e" } }),
          opt("Surprise me", "reds", { selectAll: true }),
        ],
      },
      {
        axisKey: "finishes",
        axisLabel: "Finishes",
        prompt: "Any finishes you love?",
        helperText: "Pick up to 2 — or let us surprise you.",
        multiSelect: true,
        maxSelections: 2,
        screenGroup: null,
        showIf: null,
        optionStyle: "rich",
        options: [
          opt("Classic Creme", "classic_creme", { displayMeta: { texture: "creme", sublabel: "smooth, solid color" } }),
          opt("Full Sparkle", "full_sparkle", { displayMeta: { texture: "sparkle", sublabel: "glitter, holographic" } }),
          opt("Sheer & Glossy", "sheer_glossy", { displayMeta: { texture: "sheer", swatch: "#d8536f" } }),
          opt("Mystery", "mystery", { displayMeta: { texture: "javascript:alert(1)" } }),
        ],
      },
    ],
  };
}

function pj(handle: string, title: string, price: number, variants = 1) {
  return {
    id: Math.abs(handle.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)),
    handle,
    title,
    price,
    available: true,
    featured_image: IMG + handle + ".jpg",
    images: [IMG + handle + ".jpg"],
    variants: Array.from({ length: variants }, (_, i) => ({ id: 1000 + i, price, available: true, featured_image: null })),
  };
}

const PRODUCT_JSON = {
  "red-hot": pj("red-hot", "Red Hot", 1200),
  "oh-la-la": pj("oh-la-la", "Oh La La", 1300),
  "nail-glue": pj("nail-glue", "Brush-On Nail Glue", 900),
  "top-coat": pj("top-coat", "Glosser Top Coat", 1100, 2),
  "kit-bag": pj("kit-bag", "Kit Bag", 1500),
};

const SAMPLE = {
  matrixApplied: true,
  partial: false,
  matches: [
    { productId: "p1", productHandle: "red-hot", productName: "Red Hot", variantId: null, variantNumericId: null, quantity: 1, reasons: [] },
    { productId: "p2", productHandle: "oh-la-la", productName: "Oh La La", variantId: null, variantNumericId: null, quantity: 1, reasons: [] },
  ],
};

function makeConfig(overrides: Record<string, unknown> = {}, results: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: false,
    compactLayout: true,
    landing: {
      eyebrow: "Send a pic of your hand",
      headline: "Find your shade. **See it on you.**",
      subtext: "Four little questions, one pic.",
      trustItems: ["Vegan", "Cruelty-free", "Made in the USA"],
      beforeImageUrl: IMG + "before.png",
      afterImageUrl: IMG + "after.png",
      visualCaption: "Mia's match",
      altAudienceLabel: null,
      altAudienceUrl: null,
      photoNote: "You'll add a pic of your hand at the end.",
    },
    gate: { enabled: false },
    results: {
      bundleEnabled: false,
      bundleLabel: null,
      bundleSize: 0,
      crossSell: null,
      bundleDiscount: null,
      ...results,
    },
    upsell: { title: null, body: null, cta: null },
    shadeGate: {},
    lead: { enabled: false },
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
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="orly.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = {
    config,
    flow: makeFlow(),
    sampleRecommend: SAMPLE,
    productJson: PRODUCT_JSON,
    studio: false,
    overrides: { step },
  };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  await wait(250); // swapScreen settles after 160ms
  return document.getElementById("gleame-quiz-root")!;
}

describe("compact layout (quiz_compact_layout)", () => {
  it("landing is promise → proof → trust → ask, with a step count and the photo heads-up", async () => {
    const root = await boot(makeConfig(), "intro");
    expect(root.classList.contains("gq-compact")).toBe(true);
    const intro = root.querySelector(".gq-intro--compact")!;
    expect(intro).not.toBeNull();
    const order = Array.from(intro.querySelector(".gq-intro-main")!.children).map((c) =>
      ["gq-ci-head", "gq-ci-proof", "gq-ci-trust", "gq-ci-ask"].find((k) => c.classList.contains(k)),
    );
    expect(order).toEqual(["gq-ci-head", "gq-ci-proof", "gq-ci-trust", "gq-ci-ask"]);
    expect(intro.querySelector(".gq-ci-trust")!.textContent).toBe("Vegan · Cruelty-free · Made in the USA");
    expect(intro.querySelectorAll(".gq-ba-tag")[0].textContent).toBe("Your photo");
    expect(intro.querySelector(".gq-ci-count")!.textContent).toBe("1 of 3");
    // Question 1 inline as rich tiles (2-up is CSS), then the heads-up.
    expect(intro.querySelectorAll(".gq-ci-ask .gq-option--rich")).toHaveLength(4);
    expect(intro.querySelector(".gq-ci-ask .gq-photo-note")!.textContent).toContain("at the end");
  });

  it("no proof images: single-column variant, no empty proof node", async () => {
    const root = await boot(
      makeConfig({ landing: { ...makeConfig().landing, beforeImageUrl: null, afterImageUrl: null } }),
      "intro",
    );
    expect(root.querySelector(".gq-intro--noproof")).not.toBeNull();
    expect(root.querySelector(".gq-ci-proof")).toBeNull();
  });

  it("templates never get the compact class; the classic layout shows the heads-up too", async () => {
    const tpl = await boot(makeConfig({ template: "t5" }), "intro");
    expect(tpl.classList.contains("gq-compact")).toBe(false);
    const classic = await boot(makeConfig({ compactLayout: false }), "intro");
    expect(classic.classList.contains("gq-compact")).toBe(false);
    expect(classic.querySelector(".gq-intro--compact")).toBeNull();
    expect(classic.querySelector(".gq-intro-question .gq-photo-note, .gq-intro-copy .gq-photo-note")).not.toBeNull();
  });
});

describe("option previews", () => {
  it("color chips with a swatch pair draw a gradient dot; single swatch stays flat", async () => {
    const root = await boot(makeConfig(), "q2");
    const dots = Array.from(root.querySelectorAll<HTMLElement>(".gq-chip .gq-chip-dot"));
    expect(dots).toHaveLength(3);
    expect(dots[0].getAttribute("style")).toContain("linear-gradient(135deg,#E8442E,#7A1220)");
    expect(dots[2].getAttribute("style")).not.toContain("gradient");
    expect(root.querySelector(".gq-option-any")!.textContent).toBe("Surprise me");
  });

  it("finish cards carry a texture swatch from a closed set only", async () => {
    const root = await boot(makeConfig(), "q3");
    const tex = Array.from(root.querySelectorAll(".gq-option--rich .gq-texture")).map((t) => t.className);
    expect(tex).toEqual(["gq-texture gq-texture--creme", "gq-texture gq-texture--sparkle", "gq-texture gq-texture--sheer"]);
    expect(root.querySelector(".gq-texture--sheer")!.getAttribute("style")).toBe("--gq-tx:#d8536f");
    expect(root.innerHTML).not.toContain("javascript:");
  });
});

describe("results offers", () => {
  it("cross-sell: picked add-ons, minus matches and unmet answer conditions", async () => {
    const crossSell = {
      source: "manual",
      title: "Complete your mani",
      subtext: null,
      max: 3,
      items: [
        { productId: "1", handle: "nail-glue", title: "Glue", imageUrl: null, when: null },
        { productId: "2", handle: "red-hot", title: "Red Hot", imageUrl: null, when: null }, // already a match
        { productId: "3", handle: "kit-bag", title: "Kit Bag", imageUrl: null, when: { axisKey: "vibe", axisValue: "full_glam" } },
        { productId: "4", handle: "top-coat", title: "Top Coat", imageUrl: null, when: null },
      ],
    };
    const root = await boot(makeConfig({}, { crossSell }), "results");
    await wait(20);
    const section = root.querySelector<HTMLElement>(".gq-xsell")!;
    expect(section).not.toBeNull();
    expect(section.style.display).toBe("");
    expect(section.querySelector(".gq-xsell-title")!.textContent).toBe("Complete your mani");
    const names = Array.from(section.querySelectorAll(".gq-xsell-name")).map((n) => n.textContent);
    expect(names).toEqual(["Brush-On Nail Glue", "Glosser Top Coat"]);
    // One variant = one-tap add; two variants = choose on the product page.
    const ctas = Array.from(section.querySelectorAll(".gq-xsell-add")).map((b) => b.tagName + ":" + b.textContent);
    expect(ctas).toEqual(["BUTTON:+ Add", "A:Choose"]);
  });

  it("cross-sell absent from config renders nothing", async () => {
    const root = await boot(makeConfig(), "results");
    expect(root.querySelector(".gq-xsell")).toBeNull();
  });

  it("bundle discount: discounted total on the button and the saving under it", async () => {
    const root = await boot(
      makeConfig({}, {
        bundleEnabled: true,
        bundleLabel: "Add both · {total} (was {was})",
        bundleDiscount: { type: "percentage", value: 20, minQty: 2, note: "Bundle savings applied at checkout" },
      }),
      "results",
    );
    await wait(20);
    const btn = root.querySelector(".gq-add-btn--bundle")!;
    // 12.00 + 13.00 = 25.00 → 20% off = 20.00
    expect(btn.textContent).toMatch(/20\.00 \(was .*25\.00\)/);
    expect(root.querySelector(".gq-bundle-note")!.textContent).toBe("Save 20% · Bundle savings applied at checkout");
  });

  it("no discount configured: label tokens collapse and no note renders", async () => {
    const root = await boot(makeConfig({}, { bundleEnabled: true, bundleLabel: "Add all {count} · {total}" }), "results");
    await wait(20);
    expect(root.querySelector(".gq-bundle-note")).toBeNull();
    expect(root.querySelector(".gq-add-btn--bundle")!.textContent).toMatch(/^Add all 2 · .*25\.00$/);
  });
});
