// @vitest-environment jsdom
//
// Bundle & save card (2026-10-15): a separate offer under the results so
// every product keeps its own Add to bag. One tap adds all the matches; the
// tiles let shoppers mix and match. Runs the widget verbatim in Studio
// preview mode (no network), like the other widget suites.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const IMG = "https://cdn.example.com/img/";
const opt = (label: string, axisValue: string) => ({
  label, axisValue, reasonText: null, imageUrl: null, showIf: null, selectAll: false, displayMeta: null,
});
const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    {
      axisKey: "vibe", axisLabel: "Vibe", prompt: "What's the vibe?", helperText: null, multiSelect: false,
      maxSelections: null, screenGroup: null, showIf: null, optionStyle: null,
      options: [opt("Full Glam", "full_glam"), opt("Timeless", "timeless")],
    },
  ],
};

const pj = (id: number, handle: string, title: string, price: number) => ({
  id, handle, title, price, available: true, featured_image: IMG + handle + ".jpg", images: [IMG + handle + ".jpg"],
  variants: [{ id: id * 10, price, available: true, featured_image: null }],
});
const PRODUCT_JSON = {
  "red-flare": pj(1, "red-flare", "Red Flare", 1200),
  "golden-hour": pj(2, "golden-hour", "Golden Hour", 1300),
  "pink-moon": pj(3, "pink-moon", "Pink Moon", 1500),
};
const match = (handle: string, name: string) => ({
  productId: handle, productHandle: handle, productName: name, variantId: null, variantNumericId: null, quantity: 1, reasons: [],
});
const SAMPLE = {
  matrixApplied: true,
  partial: false,
  matches: [match("red-flare", "Red Flare"), match("golden-hour", "Golden Hour"), match("pink-moon", "Pink Moon")],
};

function makeConfig(results: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: false,
    compactLayout: false,
    landing: {
      eyebrow: null, headline: "Find your vibe", subtext: null, trustItems: [], beforeImageUrl: null, afterImageUrl: null,
      visualCaption: null, altAudienceLabel: null, altAudienceUrl: null, photoNote: null,
    },
    gate: { enabled: false },
    results: { bundleEnabled: true, bundleLabel: "Add all {count} to bag · {total}", bundleSize: 0, crossSell: null, bundleDiscount: null, ...results },
    upsell: { title: null, body: null, cta: null },
    shadeGate: {},
    lead: { enabled: false },
    ...extra,
  };
}

// Template payload bits the t1-t5 renderers read (mirrors widget-templates).
function templateExtras(template: string) {
  return {
    template,
    emailPlacement: "off",
    phases: [{ label: "Vibe", axisKeys: ["vibe"] }],
    theme: { heroImage: null },
    imageSlots: {},
  };
}
function templateResults() {
  return { trustLines: [], proseTemplate: null, archetypeTitle: "You're a Glam Icon", archetypeLine: "Bold and bright." };
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

async function boot(config: Record<string, unknown>) {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="shop.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = {
    config,
    flow: FLOW,
    sampleRecommend: SAMPLE,
    productJson: PRODUCT_JSON,
    studio: false,
    overrides: { step: "results" },
  };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  await wait(250);
  for (let i = 0; i < 4; i++) await tick();
  return document.getElementById("gleame-quiz-root")!;
}

const text = (root: Element, sel: string) => root.querySelector(sel)?.textContent ?? null;
const tiles = (root: Element) => Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-bo-item"));

describe("Bundle & save card", () => {
  it("mix and match: all picked by default, dropping items updates button, total and hint", async () => {
    const root = await boot(makeConfig({ bundleDiscount: { type: "percentage", value: 20, minQty: 2, note: "Bundle savings applied at checkout" } }));
    const card = root.querySelector(".gq-bundle-offer")!;
    expect(card).not.toBeNull();
    expect(text(card, ".gq-bo-badge")).toBe("%");
    expect(text(card, ".gq-bo-title")).toBe("Bundle & save 20%");
    expect(text(card, ".gq-bo-sub")).toBe("Pick any 2 or more of your matches.");
    expect(tiles(card).map((t) => t.getAttribute("aria-pressed"))).toEqual(["true", "true", "true"]);
    expect(tiles(card)[0].querySelector("img")!.getAttribute("src")).toBe(IMG + "red-flare.jpg");
    // 12 + 13 + 15 = 40.00, 20% saves 8.00 → 32.00
    expect(text(card, ".gq-add-btn--bundle")).toMatch(/^Add all 3 to bag · Save .*8\.00$/);
    expect(text(card, ".gq-bo-total")).toMatch(/32\.00 .*40\.00/);

    tiles(card)[2].click(); // drop Pink Moon: 25.00, saves 5.00
    expect(tiles(card)[2].getAttribute("aria-pressed")).toBe("false");
    expect(text(card, ".gq-add-btn--bundle")).toMatch(/^Add 2 to bag · Save .*5\.00$/);
    expect(text(card, ".gq-bo-hint")).toBe("");

    tiles(card)[1].click(); // one left: below the minimum, no saving
    expect(text(card, ".gq-add-btn--bundle")).toMatch(/^Add 1 to bag · .*12\.00$/);
    expect(text(card, ".gq-bo-total")).toBe("");
    expect(text(card, ".gq-bo-hint")).toBe("Pick 1 more to save 20%");

    tiles(card)[0].click(); // none
    const btn = card.querySelector<HTMLButtonElement>(".gq-add-btn--bundle")!;
    expect(btn.textContent).toBe("Pick at least one");
    expect(btn.disabled).toBe(true);
  });

  it("every product keeps its own Add to bag; cards carry no bundle picks", async () => {
    const root = await boot(makeConfig({ bundleDiscount: { type: "percentage", value: 20, minQty: 2, note: null } }));
    const own = Array.from(root.querySelectorAll(".gq-match-card .gq-add-btn:not(.gq-add-btn--bundle)"));
    expect(own.length).toBe(3);
    // A single item reads "Add to bag", never "Add 1 to bag" next to "Add all 3".
    expect(own[0].textContent).toMatch(/^Add to bag · .*12\.00$/);
    expect(root.querySelector(".gq-bundle-pick")).toBeNull();
  });

  it("all-or-nothing discount reads as 'Bundle all 3'", async () => {
    const root = await boot(makeConfig({ bundleDiscount: { type: "percentage", value: 15, minQty: 3, note: null } }));
    expect(text(root, ".gq-bo-title")).toBe("Bundle all 3 and save 15%");
    expect(text(root, ".gq-bo-sub")).toBe("All 3 of your matches, in one tap.");
    expect(text(root, ".gq-bo-fine")).toBe("Bundle savings applied at checkout");
  });

  it("no discount: 'Get the full set', no badge, no saving promised", async () => {
    const root = await boot(makeConfig({}));
    const card = root.querySelector(".gq-bundle-offer")!;
    expect(card.querySelector(".gq-bo-badge")).toBeNull();
    expect(text(card, ".gq-bo-title")).toBe("Get the full set");
    expect(card.querySelector(".gq-bo-fine")).toBeNull();
    expect(text(card, ".gq-add-btn--bundle")).toMatch(/^Add all 3 to bag · .*40\.00$/);
    expect(card.textContent).not.toMatch(/save/i);
  });

  it("a discount whose amount wasn't entered promises a bundle discount, never a number", async () => {
    const root = await boot(makeConfig({ bundleDiscount: { type: "percentage", value: null, minQty: 2, note: "Bundle savings applied at checkout" } }));
    expect(text(root, ".gq-bo-title")).toBe("Bundle your matches & save");
    expect(text(root, ".gq-add-btn--bundle")).toMatch(/^Add all 3 to bag · .*40\.00$/);
  });

  it("a minimum this match set can't reach is treated as no discount", async () => {
    const root = await boot(makeConfig({ bundleDiscount: { type: "percentage", value: 20, minQty: 4, note: null } }));
    expect(text(root, ".gq-bo-title")).toBe("Get the full set");
    expect(root.querySelector(".gq-bundle-offer")!.textContent).not.toMatch(/20%/);
  });

  it("bundle size pre-selects the top N; the rest can be added", async () => {
    const root = await boot(makeConfig({ bundleSize: 2 }));
    expect(tiles(root).map((t) => t.getAttribute("aria-pressed"))).toEqual(["true", "true", "false"]);
    expect(text(root, ".gq-add-btn--bundle")).toMatch(/^Add 2 to bag · .*25\.00$/);
  });

  it("bundle button off: no card", async () => {
    const root = await boot(makeConfig({ bundleEnabled: false }));
    expect(root.querySelector(".gq-bundle-offer")).toBeNull();
  });

  it("templates: t1/t2/t5 show the card; t3/t4 keep their own routine/kit row", async () => {
    for (const t of ["t1", "t2", "t5"]) {
      const root = await boot(makeConfig(templateResults(), templateExtras(t)));
      expect(root.querySelector(".gq-bundle-offer"), t).not.toBeNull();
    }
    for (const t of ["t3", "t4"]) {
      const root = await boot(makeConfig(templateResults(), templateExtras(t)));
      expect(root.querySelector(".gq-bundle-offer"), t).toBeNull();
    }
  });
});
