// @vitest-environment jsdom
//
// Email capture placement "both" (card 2026-10-21 "Glamnetic Email
// Placement Bug": it could only be a question step OR the card under the
// results). "both" asks in its own step before results AND keeps the card
// under the grid results, without asking twice: a shopper who gave their
// email in the step sees the card as saved, one who skipped gets the card.
// The other placements are unchanged. Live storefront path (routed fetch).

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

function makeConfig(emailPlacement: string | null, extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: false,
    compactLayout: true,
    uiStyle: "boutique",
    landing: { eyebrow: null, headline: "Meet your perfect mani.", subtext: null, trustItems: [], beforeImageUrl: null, afterImageUrl: null, visualCaption: null, altAudienceLabel: null, altAudienceUrl: null, photoNote: null },
    gate: { enabled: false },
    results: { layout: "grid", headlineNoPhoto: "Six sets, picked for you.", bundleEnabled: false, crossSell: null },
    upsell: {},
    shadeGate: {},
    lead: { enabled: true, collectPhone: false, headline: "Want us to send your matches?", body: null, buttonLabel: "Save my results", skipLabel: "Skip", consentText: null },
    emailPlacement,
    ...extra,
  };
}

const RECOMMEND = {
  matrixApplied: false,
  partial: false,
  matches: ["chocolat", "plum"].map((h, i) => ({
    productId: "p" + i, productHandle: h, productName: h, variantTitle: null, variantId: null,
    variantNumericId: String(100 + i), quantity: 1, reasons: [],
  })),
};

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
let config: Record<string, unknown> = makeConfig("both");
let fetchMock: ReturnType<typeof vi.fn>;
function routedFetch(url: string) {
  if (url.includes("/api/storefront/quiz-config")) return json(config);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  if (url.includes("/api/storefront/quiz-recommend")) return json(RECOMMEND);
  if (url.includes("/api/storefront/quiz-lead-results")) return json({ ok: true });
  if (url.includes("/api/storefront/quiz-lead")) return json({ success: true, leadToken: "lt-1" });
  const p = /\/products\/([a-z-]+)\.js/.exec(url);
  if (p) return json({ id: 1, handle: p[1], title: p[1], price: 1599, available: true, featured_image: null, images: [], variants: [{ id: 100, price: 1599, available: true }] });
  if (url.includes("/cart")) return json({ token: "c1", items: [], item_count: 0 });
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
const screenEl = (root: HTMLElement) => root.querySelector(".gq-stage > .gq-screen") as HTMLElement;
// Through the questions to wherever the flow goes next.
async function answerAll() {
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
  return root;
}
async function submitEmail(scope: Element) {
  (scope.querySelector(".gq-lead-input") as HTMLInputElement).value = "shopper@example.com";
  scope.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle(20);
  await wait(300);
  await settle(20);
}
const leadPosts = () => fetchMock.mock.calls.filter((c) => /\/api\/storefront\/quiz-lead$/.test(String(c[0])));
const tracked = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/api/storefront/track-event"))
    .map((c) => JSON.parse(String((c[1] as any)?.body || "{}")).eventType);

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/pages/find-my-match");
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).Shopify;
  (window as any).matchMedia = (q: string) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
});

describe('email placement "both" (classic grid)', () => {
  it("asks in the step, and the results card shows it saved instead of asking again", async () => {
    config = makeConfig("both");
    const root = await answerAll();
    expect(screenEl(root).classList.contains("gq-step--lead")).toBe(true);
    await submitEmail(screenEl(root));
    const res = root.querySelector(".gq-results--grid")!;
    expect(res).not.toBeNull();
    const card = res.querySelector(".gq-gr-lead")!;
    expect(card.classList.contains("gq-gr-lead--saved")).toBe(true);
    expect(card.querySelector(".gq-lead-input, form")).toBeNull();
    expect(card.querySelector(".gq-gr-lead-done")!.textContent).toBe("Saved ✓ You’re on the list.");
    expect(leadPosts()).toHaveLength(1);
    await wait(20);
    expect(tracked().filter((e) => e === "quiz_lead_view")).toHaveLength(1);
  });

  it("a shopper who skipped the step gets the card under the results", async () => {
    config = makeConfig("both");
    const root = await answerAll();
    expect(screenEl(root).classList.contains("gq-step--lead")).toBe(true);
    (screenEl(root).querySelector(".gq-skip-link") as HTMLElement).click();
    await settle(20);
    await wait(300);
    await settle(20);
    const card = root.querySelector(".gq-results--grid .gq-gr-lead")!;
    expect(card.classList.contains("gq-gr-lead--saved")).toBe(false);
    expect(card.querySelector(".gq-lead-input")).not.toBeNull();
    await submitEmail(card);
    expect(card.querySelector(".gq-gr-lead-done")!.textContent).toBe("Saved ✓ You’re on the list.");
    expect(leadPosts()).toHaveLength(1);
    // The step already counted the view: the card doesn't count it again.
    expect(tracked().filter((e) => e === "quiz_lead_view")).toHaveLength(1);
  });

  it("other placements are unchanged: the step alone, or the card alone", async () => {
    config = makeConfig(null);
    let root = await answerAll();
    expect(screenEl(root).classList.contains("gq-step--lead")).toBe(true);
    (screenEl(root).querySelector(".gq-skip-link") as HTMLElement).click();
    await settle(20);
    await wait(300);
    await settle(20);
    expect(root.querySelector(".gq-results--grid")).not.toBeNull();
    expect(root.querySelector(".gq-gr-lead")).toBeNull();

    sessionStorage.clear();
    config = makeConfig("after_results");
    root = await answerAll();
    expect(root.querySelector(".gq-step--lead")).toBeNull();
    expect(root.querySelector(".gq-results--grid .gq-gr-lead .gq-lead-input")).not.toBeNull();
  });
});
