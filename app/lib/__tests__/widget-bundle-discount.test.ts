// @vitest-environment jsdom
//
// Bundle discount on the classic results "add all" button, on the LIVE
// storefront path (Studio previews stub the cart, so they can't catch
// this). Shopify answers /cart/update.js with 200 even for a code it won't
// honor and marks it `applicable: false`; the widget must only claim the
// saving (note + quiz_bundle_discount_applied) when the cart says the code
// applies. Shopify's app reviewer saw no discount at checkout, so this is
// pinned end to end.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const opt = (label: string, axisValue: string) => ({
  label, axisValue, reasonText: null, imageUrl: null, showIf: null, selectAll: false, displayMeta: null,
});
const question = (axisKey: string, prompt: string, options: unknown[]) => ({
  axisKey, axisLabel: axisKey, prompt, helperText: null, multiSelect: false, maxSelections: null,
  screenGroup: null, showIf: null, optionStyle: null, options,
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
    eyebrow: null, headline: "Find your vibe", subtext: null, trustItems: [], beforeImageUrl: null,
    afterImageUrl: null, visualCaption: null, altAudienceLabel: null, altAudienceUrl: null, photoNote: null,
  },
  gate: { enabled: false },
  results: {
    bundleEnabled: true,
    bundleLabel: null,
    bundleSize: 0,
    crossSell: null,
    bundleDiscount: { type: "percentage", value: 15, minQty: 2, note: "Bundle savings applied at checkout" },
  },
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

const product = (id: number, handle: string) => ({
  id, handle, title: handle, price: 1200, available: true, featured_image: null, images: [],
  variants: [{ id: id * 10, price: 1200, available: true, featured_image: null }],
});

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

let applicable = true;
let fetchMock: ReturnType<typeof vi.fn>;
function routedFetch(url: string, init?: { body?: string }) {
  if (url.includes("/api/storefront/quiz-config")) return json(configOverride ?? CONFIG);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  if (url.includes("/api/storefront/quiz-recommend")) return json(RECOMMEND);
  if (url.includes("/api/storefront/quiz-bundle-discount")) return json({ code: "BUNDLE15" });
  if (url.includes("/products/red-flare.js")) return json(product(1, "red-flare"));
  if (url.includes("/products/golden-hour.js")) return json(product(2, "golden-hour"));
  if (url.includes("/cart/add.js")) return json({ items: [] });
  if (url.includes("/cart/update.js")) {
    const body = JSON.parse(init?.body || "{}");
    if (typeof body.discount === "string") {
      return json({ token: "c1", discount_codes: [{ code: "BUNDLE15", applicable }] });
    }
    return json({ token: "c1", discount_codes: [] });
  }
  if (url.includes("/cart.js")) return json({ token: "c1", item_count: 0, discount_codes: [] });
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

async function settle(n = 8) {
  for (let i = 0; i < n; i++) await tick();
}

async function toResults() {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="review-store.myshopify.com"></div>';
  fetchMock = vi.fn(routedFetch);
  (window as any).fetch = fetchMock;
  evalWidget();
  await settle();
  await wait(SWAP);
  const root = document.getElementById("gleame-quiz-root")!;
  (root.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
  await wait(220 + SWAP);
  (root.querySelector(".gq-option-block button") as HTMLElement).click();
  await wait(220 + SWAP);
  await settle(12);
  return root;
}

const trackedEvents = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/api/storefront/track-event"))
    .map((c) => JSON.parse(String((c[1] as any)?.body || "{}")).eventType);

beforeEach(() => {
  configOverride = null;
  sessionStorage.clear();
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).Shopify;
});

let configOverride: Record<string, unknown> | null = null;

describe("bundle discount on the live storefront path", () => {
  it("offers the saving in the Bundle & save card and applies the code after the add", async () => {
    applicable = true;
    const root = await toResults();
    const card = root.querySelector(".gq-bundle-offer")!;
    expect(card, "bundle card").not.toBeNull();
    const btn = card.querySelector(".gq-add-btn--bundle") as HTMLButtonElement;
    expect(card.querySelector(".gq-bo-title")!.textContent).toBe("Bundle all 2 and save 15%");
    // 2 × 12.00 = 24.00, 15% off saves 3.60
    expect(btn.textContent).toMatch(/^Add all 2 to bag · Save .*3\.60$/);
    expect(btn.disabled).toBe(false);

    btn.click();
    await settle(20);

    const discountPost = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/cart/update.js") && String((c[1] as any)?.body || "").includes("discount"),
    );
    expect(JSON.parse(String((discountPost![1] as any).body))).toEqual({ discount: "BUNDLE15" });
    expect(card.classList.contains("is-applied")).toBe(true);
    expect(card.querySelector(".gq-bo-status")!.textContent).toBe("15% off applied. You’ll see it at checkout.");
    expect(trackedEvents()).toContain("quiz_bundle_discount_applied");
  });

  it("mix and match: only the picked items go to the cart, and no code below the minimum", async () => {
    applicable = true;
    const root = await toResults();
    (root.querySelectorAll(".gq-bo-item")[1] as HTMLButtonElement).click(); // drop Golden Hour
    (root.querySelector(".gq-add-btn--bundle") as HTMLButtonElement).click();
    await settle(20);

    const add = fetchMock.mock.calls.find((c) => String(c[0]).includes("/cart/add.js"));
    expect(JSON.parse(String((add![1] as any).body)).items).toEqual([{ id: 10, quantity: 1 }]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/storefront/quiz-bundle-discount"))).toBe(false);
    expect(trackedEvents()).toContain("quiz_add_bundle_to_bag");
  });

  it("per-product adds that reach the minimum earn the bundle code too", async () => {
    applicable = true;
    const root = await toResults();
    const own = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-match-card .gq-add-btn:not(.gq-add-btn--bundle)"));
    expect(own.length).toBe(2);
    own[0].click();
    await settle(12);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/storefront/quiz-bundle-discount"))).toBe(false);
    own[1].click();
    await settle(20);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/storefront/quiz-bundle-discount"))).toBe(true);
    const card = root.querySelector(".gq-bundle-offer")!;
    expect(card.classList.contains("is-applied")).toBe(true);
    expect(trackedEvents()).toContain("quiz_bundle_discount_applied");
  });

  it("after a bundle add the button stays 'Added' until the selection changes", async () => {
    applicable = true;
    const root = await toResults();
    const btn = root.querySelector<HTMLButtonElement>(".gq-add-btn--bundle")!;
    btn.click();
    await settle(20);
    expect(btn.textContent).toBe("Added to bag ✓");
    expect(btn.disabled).toBe(true);
    (root.querySelectorAll(".gq-bo-item")[1] as HTMLButtonElement).click();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/^Add 1 to bag/);
  });

  it("grid results never say 'applied' when Shopify refuses the code", async () => {
    applicable = false;
    configOverride = { ...CONFIG, results: { ...CONFIG.results, layout: "grid" } };
    const root = await toResults();
    const adds = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-gr-add"));
    expect(adds.length).toBe(2);
    adds[0].click();
    await settle(12);
    adds[1].click();
    await settle(25);
    const text = root.textContent ?? "";
    expect(text).not.toMatch(/off applied|Discount applied/);
    expect(text).toMatch(/couldn’t apply|couldn’t be applied/i);
  });

  it("does not claim the saving when Shopify marks the code not applicable", async () => {
    applicable = false;
    const root = await toResults();
    (root.querySelector(".gq-add-btn--bundle") as HTMLButtonElement).click();
    await settle(20);

    const card = root.querySelector(".gq-bundle-offer")!;
    expect(card.classList.contains("is-applied")).toBe(false);
    // Says so plainly instead of leaving the "applied at checkout" promise up.
    expect(card.classList.contains("is-refused")).toBe(true);
    expect(card.querySelector(".gq-bo-status")!.textContent).toBe("We couldn’t apply the bundle discount to this cart.");
    expect(trackedEvents()).toContain("quiz_add_bundle_to_bag");
    expect(trackedEvents()).not.toContain("quiz_bundle_discount_applied");
  });
});
