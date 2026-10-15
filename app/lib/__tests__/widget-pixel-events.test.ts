// @vitest-environment jsdom
//
// Quiz funnel events mirrored into Shopify Customer Events
// (Shopify.analytics.publish) so a merchant's Custom Pixel can forward them
// to Meta/TikTok for ad campaigns (docs/integrations/meta-pixel.md). Unlike
// the other widget suites this boots the LIVE storefront path (no
// GLEAME_QUIZ_PREVIEW) against a routed fetch stub, because draft previews
// deliberately send no events at all.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const opt = (label: string, axisValue: string) => ({
  label,
  axisValue,
  reasonText: null,
  imageUrl: null,
  showIf: null,
  selectAll: false,
  displayMeta: null,
});
const question = (axisKey: string, prompt: string, options: unknown[]) => ({
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
});

const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    question("vibe", "What's the vibe?", [opt("Full Glam", "full_glam"), opt("Timeless", "timeless")]),
    question("finish", "Any finish you love?", [opt("Creme", "creme"), opt("Sparkle", "sparkle")]),
  ],
};

const CONFIG = {
  enabled: true,
  template: null,
  brandTokens: null,
  tryonEnabled: false,
  compactLayout: false,
  landing: {
    eyebrow: null,
    headline: "Find your vibe",
    subtext: null,
    trustItems: [],
    beforeImageUrl: null,
    afterImageUrl: null,
    visualCaption: null,
    altAudienceLabel: null,
    altAudienceUrl: null,
    photoNote: null,
  },
  gate: { enabled: false },
  results: { bundleEnabled: false, bundleLabel: null, bundleSize: 0, crossSell: null, bundleDiscount: null },
  upsell: { title: null, body: null, cta: null },
  shadeGate: {},
  lead: { enabled: false },
};

const RECOMMEND = {
  matrixApplied: true,
  partial: false,
  matches: [
    { productId: "p1", productHandle: "red-flare", productName: "Red Flare", variantId: null, variantNumericId: null, quantity: 1, reasons: [] },
    { productId: "p2", productHandle: "golden-hour", productName: "Golden Hour", variantId: null, variantNumericId: null, quantity: 1, reasons: [] },
  ],
};

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

function routedFetch(url: string) {
  if (url.includes("/api/storefront/quiz-config")) return json(CONFIG);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  if (url.includes("/api/storefront/quiz-recommend")) return json(RECOMMEND);
  if (url.includes("/products/")) return json({ id: 1, handle: "x", title: "X", price: 1200, available: true, images: [], variants: [{ id: 1, price: 1200, available: true }] });
  return json({});
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SWAP = 250;

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

let publish: ReturnType<typeof vi.fn>;
async function boot() {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="orlybeauty.myshopify.com"></div>';
  (window as any).fetch = vi.fn(routedFetch);
  evalWidget();
  for (let i = 0; i < 6; i++) await tick();
  await wait(SWAP);
  return document.getElementById("gleame-quiz-root")!;
}
const published = () => publish.mock.calls.map((c) => c[0]);

beforeEach(() => {
  sessionStorage.clear();
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).GLEAME_QUIZ_FORCE;
  delete (window as any).GLEAME_QUIZ_STORE_PREVIEW;
  publish = vi.fn(() => true);
  (window as any).Shopify = { analytics: { publish } };
});

describe("Shopify Customer Events mirror", () => {
  it("publishes the funnel as gleame_* custom events, with matches on results", async () => {
    const root = await boot();
    expect(published()).toEqual(["gleame_quiz_view"]);
    expect(publish.mock.calls[0][1]).toEqual({ eventType: "quiz_view", widget: "quiz", device: "desktop" });

    (root.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
    await wait(220 + SWAP);
    expect(published()).toEqual(["gleame_quiz_view", "gleame_quiz_start", "gleame_quiz_question_answered"]);

    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    for (let i = 0; i < 6; i++) await tick();

    const results = publish.mock.calls.find((c) => c[0] === "gleame_quiz_results_shown");
    expect(results, published().join(", ")).toBeDefined();
    expect(results![1]).toEqual({
      eventType: "quiz_results_shown",
      widget: "quiz",
      device: "desktop",
      matchCount: 2,
      products: [
        { handle: "red-flare", name: "Red Flare" },
        { handle: "golden-hour", name: "Golden Hour" },
      ],
    });
    // quiz_start fires once per session, not on every answer.
    expect(published().filter((e) => e === "gleame_quiz_start")).toHaveLength(1);
  });

  it("on-store previews never reach the merchant's pixels (Gleame analytics still records)", async () => {
    (window as any).GLEAME_QUIZ_FORCE = true;
    (window as any).GLEAME_QUIZ_STORE_PREVIEW = { token: "t", id: "d" };
    await boot();
    expect(publish).not.toHaveBeenCalled();
    const urls = ((window as any).fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/storefront/track-event"))).toBe(true);
  });

  it("a storefront without Shopify.analytics (or a throwing one) still tracks normally", async () => {
    (window as any).Shopify = {};
    const root = await boot();
    expect(root.querySelector(".gq-intro")).not.toBeNull();

    publish = vi.fn(() => {
      throw new Error("pixel manager blew up");
    });
    (window as any).Shopify = { analytics: { publish } };
    const again = await boot();
    expect(publish).toHaveBeenCalled();
    (again.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
    await wait(220 + SWAP);
    const urls = ((window as any).fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes("/api/storefront/track-event")).length).toBeGreaterThanOrEqual(3);
  });

  it("draft previews publish nothing", async () => {
    (window as any).GLEAME_QUIZ_PREVIEW = { config: CONFIG, flow: FLOW, sampleRecommend: RECOMMEND, productJson: {}, studio: false, overrides: { step: null } };
    await boot();
    expect(publish).not.toHaveBeenCalled();
  });
});
