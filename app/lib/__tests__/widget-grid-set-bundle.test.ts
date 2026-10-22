// @vitest-environment jsdom
//
// Grid results bundle without a live discount (card 2026-10-21 "Glamnetic
// Set up Bundling: just make it appear again"). The grid only drew its
// Mix & match bar with a live bundle discount, and Glamnetic's code isn't
// created yet, so the bundle vanished. Now the bar shows without one: pick
// toggles on the cards, one tap adds the picked sets, and nothing promises
// a saving. With a live discount the designed discount bar is unchanged.
// Live storefront path (routed fetch), so the cart call itself is pinned.

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
  screenGroup: null, showIf: null, optionStyle: "boxed", options,
});
const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    question("vibe", "What's the vibe?", [opt("Clean Girl", "model_off_duty"), opt("Soft & Sweet", "soft_sweet")]),
    question("finish", "What's your finish?", [opt("Classic Glossy", "option_1"), opt("Matte", "option_5")]),
  ],
};

// Glamnetic's live results settings (2026-10-21): bundles on, size 2, the
// mix & match label, no bundle discount served (its code isn't set yet).
function makeConfig(results: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: false,
    compactLayout: true,
    uiStyle: "boutique",
    landing: { eyebrow: null, headline: "Meet your perfect mani.", subtext: null, trustItems: [], beforeImageUrl: null, afterImageUrl: null, visualCaption: null, altAudienceLabel: null, altAudienceUrl: null, photoNote: null },
    gate: { enabled: false },
    results: {
      layout: "grid",
      headlineNoPhoto: "Six sets, picked for you.",
      bundleEnabled: true,
      bundleLabel: "**Mix & match:** add any {range} sets and save {discount}",
      bundleSize: 2,
      bundleDiscount: null,
      crossSell: null,
      primaryCta: "add",
      secondaryLink: true,
      ...results,
    },
    upsell: {},
    shadeGate: {},
    lead: { enabled: false },
  };
}

const HANDLES = ["chocolat", "cafe-creme", "heavenly"];
const PRICES = [1599, 1599, 1999];
const RECOMMEND = {
  matrixApplied: false,
  partial: false,
  matches: HANDLES.map((h, i) => ({
    productId: "p" + i, productHandle: h, productName: h[0].toUpperCase() + h.slice(1), variantTitle: null,
    variantId: "gid://shopify/ProductVariant/" + (100 + i), variantNumericId: String(100 + i), quantity: 1, reasons: [],
  })),
};
const product = (i: number) => ({
  id: i + 1, handle: HANDLES[i], title: HANDLES[i], price: PRICES[i], available: true, featured_image: null, images: [],
  variants: [{ id: 100 + i, price: PRICES[i], available: true, featured_image: null }],
});

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
let config: Record<string, unknown> = makeConfig();
let fetchMock: ReturnType<typeof vi.fn>;
function routedFetch(url: string, init?: { body?: string }) {
  if (url.includes("/api/storefront/quiz-config")) return json(config);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  if (url.includes("/api/storefront/quiz-recommend")) return json(RECOMMEND);
  const p = /\/products\/([a-z-]+)\.js/.exec(url);
  if (p) return json(product(HANDLES.indexOf(p[1])));
  if (url.includes("/cart/add.js")) {
    // A card's own add posts form data; the set posts JSON items.
    const items = typeof init?.body === "string" ? JSON.parse(init.body).items || [] : [];
    return json({ items: items.map((it: any) => ({ id: it.id, variant_id: it.id, quantity: it.quantity })) });
  }
  if (url.includes("/cart")) return json({ token: "c1", items: [], item_count: 0, discount_codes: [] });
  return json({});
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
async function settle(n = 10) {
  for (let i = 0; i < n; i++) await tick();
}
async function toResults() {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="glamrco.myshopify.com"></div>';
  fetchMock = vi.fn(routedFetch);
  (window as any).fetch = fetchMock;
  evalWidget();
  await settle();
  await wait(250);
  const root = document.getElementById("gleame-quiz-root")!;
  (root.querySelector(".gq-ci-ask .gq-option") as HTMLElement).click();
  await wait(500);
  (root.querySelector(".gq-option-block .gq-option") as HTMLElement).click();
  await wait(500);
  await settle(20);
  expect(root.querySelector(".gq-results--grid")).not.toBeNull();
  return root;
}
const cartAdds = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/cart/add.js") && typeof (c[1] as any)?.body === "string")
    .map((c) => JSON.parse(String((c[1] as any).body)).items);
const tracked = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/api/storefront/track-event"))
    .map((c) => JSON.parse(String((c[1] as any)?.body || "{}")).eventType);

beforeEach(() => {
  config = makeConfig();
  sessionStorage.clear();
  history.replaceState(null, "", "/pages/find-my-match");
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).Shopify;
  (window as any).matchMedia = (q: string) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
});

describe("grid results bundle without a live discount", () => {
  it("shows the mix & match bar with picks and no saving promised", async () => {
    const root = await toResults();
    const bar = root.querySelector(".gq-gr-bundle.gq-gr-bundle--set")!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector(".gq-gr-bundle-text")!.innerHTML).toBe("<strong>Mix &amp; match:</strong> add any 2+ sets");
    // Nothing anywhere promises a saving while no discount is live.
    expect(root.textContent!).not.toMatch(/save|%|discount/i);
    expect(bar.querySelector(".gq-gr-bundle-progress, .gq-gr-pips")).toBeNull();
    // The bundle size is the pre-selection: the top two matches.
    const picks = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-gr-card .gq-gr-pick"));
    expect(picks).toHaveLength(3);
    expect(picks.map((p) => p.classList.contains("is-picked"))).toEqual([true, true, false]);
    const btn = bar.querySelector<HTMLButtonElement>(".gq-gr-bundle-add")!;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Add 2 to bag · $31.98");
    // Mix and match: any two or more.
    picks[2].click();
    expect(btn.textContent).toBe("Add 3 to bag · $51.97");
    picks[0].click();
    picks[1].click();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Pick 1 more");
  });

  it("one tap adds the picked sets in one cart call, and the cards say Added", async () => {
    const root = await toResults();
    const picks = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-gr-card .gq-gr-pick"));
    picks[0].click(); // drop Chocolat
    picks[2].click(); // take Heavenly
    const btn = root.querySelector<HTMLButtonElement>(".gq-gr-bundle-add")!;
    expect(btn.textContent).toBe("Add 2 to bag · $35.98");
    btn.click();
    await settle(20);
    expect(cartAdds()).toEqual([[{ id: "101", quantity: 1 }, { id: "102", quantity: 1 }]]);
    expect(btn.textContent).toBe("Added to bag ✓");
    const adds = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-gr-card .gq-gr-add"));
    expect(adds.map((a) => a.textContent)).toEqual(["Add to bag", "Added", "Added"]);
    // Sets in the bag drop out of the pick; no discount code is fetched.
    expect(picks.map((p) => p.style.display)).toEqual(["", "none", "none"]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("quiz-bundle-discount"))).toBe(false);
    await wait(20);
    expect(tracked()).toContain("quiz_add_bundle_to_bag");
    // The last set added from its own card leaves nothing to pick.
    adds[0].click();
    await settle(20);
    expect(adds[0].textContent).toBe("Added");
    expect(picks.every((p) => p.style.display === "none")).toBe(true);
    expect(cartAdds()).toHaveLength(1); // the set's one JSON call
  });

  it("with a live discount the designed discount bar shows, unchanged", async () => {
    config = makeConfig({ bundleDiscount: { type: "percentage", value: 15, minQty: 2, note: "Bundle savings applied at checkout" } });
    const root = await toResults();
    expect(root.querySelector(".gq-gr-bundle-text")!.innerHTML).toBe("<strong>Mix &amp; match:</strong> add any 2+ sets and save 15%");
    expect(root.querySelector(".gq-gr-bundle-status")!.textContent).toBe("0 of 2 added");
    expect(root.querySelector(".gq-gr-bundle--set, .gq-gr-pick, .gq-gr-bundle-add")).toBeNull();
  });

  it("no bundle at all where bundles are off (every store but Glamnetic)", async () => {
    config = makeConfig({ bundleEnabled: false });
    const root = await toResults();
    expect(root.querySelector(".gq-gr-bundle, .gq-gr-pick")).toBeNull();
  });
});
