// @vitest-environment jsdom
//
// "Try them on me" (2026-10-19 App Review). The reviewer's store runs the
// Routine template (t3) with try-on left on by default, but none of its
// products was ever set up for try-on: the results showed "See these on you
// ✨ ... Try them on me", the click took a photo, and nothing could render.
// The CTA must appear only when the click leads somewhere: try-on on, the
// product(s) the renderer would try on set up for it (quiz-recommend's
// per-match `tryon` flag), and a way to hand over a photo. Booted on the
// live storefront path (no preview stubs) so the real photo flow and the
// real quiz-tryon request run.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const TEMPLATES = ["t1", "t2", "t3", "t4", "t5"] as const;
type Renderer = (typeof TEMPLATES)[number] | null; // null = the classic renderer

const opt = (label: string, axisValue: string) => ({
  label,
  axisValue,
  reasonText: null,
  imageUrl: null,
  showIf: null,
  selectAll: false,
  displayMeta: null,
});
const question = (axisKey: string, prompt: string, options: Array<ReturnType<typeof opt>>) => ({
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

// The reviewer's flow shape: no photo axis, so a photo only feeds try-on.
const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    question("shopping_for", "What are you shopping for today?", [opt("Apparel", "apparel"), opt("Skincare", "skincare")]),
    question("vibe", "What matters most to you?", [opt("Everyday reliability", "everyday"), opt("A great gift", "gifting")]),
  ],
};

function makeConfig(template: Renderer, overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template,
    brandTokens: null,
    tryonEnabled: true,
    compactLayout: false,
    uiStyle: null,
    uiText: null,
    numRecommendations: 3,
    photoFrameHint: "Position your face in the frame",
    landing: {
      eyebrow: "Find My Fit",
      headline: "Let's find your perfect match",
      subtext: null,
      trustItems: [],
      beforeImageUrl: null,
      afterImageUrl: null,
      visualCaption: null,
      altAudienceLabel: null,
      altAudienceUrl: null,
      photoNote: null,
      ...(template ? { founder: null, rating: null, benefitChips: [] } : {}),
    },
    gate: { enabled: true, headline: "Your match is ready", helper: null, photoLabel: "Show my match on me", skipLabel: "Just take me to my results", privacyNote: null },
    results: {
      headlinePhoto: "Here's your fit",
      headlineNoPhoto: "Here's your fit",
      bundleEnabled: false,
      bundleLabel: null,
      bundleSize: 0,
      crossSell: null,
      bundleDiscount: null,
      layout: null,
      ...(template ? { trustLines: [], proseTemplate: null, archetypeTitle: null, archetypeLine: null } : {}),
    },
    // quiz-config serves the copy whether or not the CTA can work.
    upsell: { title: "See these on you", body: "One quick photo, we'll re-render your matches on you.", cta: "Try them on me" },
    shadeGate: {},
    lead: { enabled: false },
    ...(template ? { emailPlacement: null, phases: [], theme: { heroImage: null }, imageSlots: {} } : {}),
    ...overrides,
  };
}

const PRODUCTS = [
  { handle: "hydrating-green-tea-toner", name: "Hydrating green tea toner", id: 10595493642296, vid: 51001, price: 2000 },
  { handle: "purifying-clay-mask", name: "Purifying Clay Mask", id: 10595492888632, vid: 51002, price: 1500 },
  { handle: "wide-leg-yoga-pants", name: "Wide-Leg Yoga Pants", id: 10595490000001, vid: 51003, price: 10000 },
];

/** tryon[i]: the per-match flag quiz-recommend sends; undefined = absent (a
 * server or saved session from before the flag). */
function makeMatches(tryon: Array<boolean | undefined>) {
  return PRODUCTS.map((p, i) => ({
    productId: `gid://shopify/Product/${p.id}`,
    variantId: `gid://shopify/ProductVariant/${p.vid}`,
    variantNumericId: p.vid,
    productHandle: p.handle,
    productName: p.name,
    variantTitle: null,
    title: p.name,
    tagline: null,
    whyFits: null,
    rank: i + 1,
    quantity: 1,
    reasons: [],
    ...(tryon[i] === undefined ? {} : { tryon: tryon[i] }),
  }));
}

const productJson = (p: (typeof PRODUCTS)[number]) => ({
  id: p.id,
  handle: p.handle,
  title: p.name,
  price: p.price,
  available: true,
  featured_image: `https://cdn.example.com/${p.handle}.png`,
  images: [`https://cdn.example.com/${p.handle}.png`],
  options: [{ name: "Title" }],
  variants: [{ id: p.vid, title: "Default Title", price: p.price, available: true, featured_image: null }],
});

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(body) });

let CONFIG: ReturnType<typeof makeConfig>;
let tryonPosts: Array<{ productId: string | null }> = [];
function routedFetch(url: string, init?: { body?: unknown }) {
  if (url.includes("/api/storefront/quiz-config")) return json(CONFIG);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  if (url.includes("/api/storefront/quiz-tryon")) {
    const fd = init?.body as FormData;
    tryonPosts.push({ productId: fd && typeof fd.get === "function" ? (fd.get("productId") as string) : null });
    return json({ tryOnPreview: "AAAA", error: null });
  }
  const pm = /^\/products\/([^/.]+)\.js$/.exec(url);
  if (pm) {
    const p = PRODUCTS.find((x) => x.handle === decodeURIComponent(pm[1]));
    return p ? json(productJson(p)) : Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  }
  if (url === "/cart.js" || url.startsWith("/cart/")) return json({ token: "c1", items: [] });
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

/** Land on the results the reviewer reached: questions answered, photo
 * step skipped, matches from quiz-recommend. */
async function bootResults(template: Renderer, tryon: Array<boolean | undefined>, configOverrides: Record<string, unknown> = {}) {
  CONFIG = makeConfig(template, configOverrides);
  sessionStorage.setItem(
    "gleame-quiz-state-v2",
    JSON.stringify({
      v: 1,
      s: {
        screen: "results",
        screenIndex: 0,
        criteria: { shopping_for: "skincare", vibe: "everyday" },
        answers: [
          { axisKey: "shopping_for", values: ["skincare"], labels: ["Skincare"] },
          { axisKey: "vibe", values: ["everyday"], labels: ["Everyday reliability"] },
        ],
        hasPhoto: false,
        detectedShade: null,
        matches: makeMatches(tryon),
        matrixApplied: false,
        partial: false,
        columnar: null,
        quizStarted: true,
        leadDone: true,
        leadToken: null,
        leadReportedKey: null,
        t2ComputeDone: true,
      },
    }),
  );
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="pqkzt0-gb.myshopify.com"></div>';
  (window as any).fetch = vi.fn(routedFetch);
  evalWidget();
  for (let i = 0; i < 8; i++) await tick();
  await wait(SWAP);
  const root = document.getElementById("gleame-quiz-root")!;
  expect(root.querySelector(".gq-results"), `${template ?? "classic"} reached results: ${root.textContent}`).not.toBeNull();
  return root;
}

const upsellOf = (root: HTMLElement) => root.querySelector(".gq-upsell");
const label = (t: Renderer) => t ?? "classic";

const realFormData = window.FormData;
beforeEach(() => {
  sessionStorage.clear();
  tryonPosts = [];
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).GLEAME_QUIZ_BOOT;
  delete (window as any).gleameCamera;
  (window as any).Shopify = {};
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  (window as any).FormData = realFormData;
  vi.restoreAllMocks();
});

describe("Try them on me: only offered when the click can work", () => {
  it("the reviewer's store (t3, no product set up for try-on): no CTA, and no try-on request", async () => {
    const root = await bootResults("t3", [false, false, false]);
    expect(root.querySelector(".gq-t3r")).not.toBeNull();
    expect(upsellOf(root)).toBeNull();
    expect(root.textContent).not.toContain("Try them on me");
    expect(root.textContent).not.toContain("See these on you");
    expect(tryonPosts).toEqual([]);
  });

  it.each([...TEMPLATES, null] as Renderer[])("%s: hidden when no shown match is set up for try-on", async (t) => {
    const root = await bootResults(t, [false, false, false]);
    expect(upsellOf(root), label(t)).toBeNull();
    expect(root.querySelector(".gq-media-see, .gq-gr-see"), label(t)).toBeNull();
  });

  it.each([...TEMPLATES, null] as Renderer[])(
    "%s: shown when the lead match is set up, and the click opens the photo flow that renders it",
    async (t) => {
      const root = await bootResults(t, [true, false, false]);
      const upsell = upsellOf(root);
      expect(upsell, label(t)).not.toBeNull();
      expect(upsell!.textContent).not.toMatch(/✨/);

      const open = vi.fn((onCapture: (f: File) => void) => {
        onCapture(new File([new Uint8Array([1, 2, 3])], "selfie.jpg", { type: "image/jpeg" }));
      });
      (window as any).gleameCamera = { open, isDesktop: () => true };
      (upsell!.querySelector(".gq-upsell-cta") as HTMLButtonElement).click();
      expect(open, label(t)).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 6; i++) await tick();
      await wait(SWAP);
      for (let i = 0; i < 6; i++) await tick();

      // The photo is in: the banner gives way and the set-up match renders.
      expect(upsellOf(root), label(t)).toBeNull();
      expect(tryonPosts, label(t)).toEqual([{ productId: `gid://shopify/Product/${PRODUCTS[0].id}` }]);
    },
  );

  it.each(TEMPLATES)("%s: hidden when only a non-lead match is set up (templates try on the lead match only)", async (t) => {
    const root = await bootResults(t, [false, true, true]);
    expect(upsellOf(root), t).toBeNull();
  });

  it("classic: one set-up match is enough; the photo renders only that one", async () => {
    const root = await bootResults(null, [false, true, false]);
    const upsell = upsellOf(root);
    expect(upsell).not.toBeNull();
    (window as any).gleameCamera = {
      open: (onCapture: (f: File) => void) => onCapture(new File([new Uint8Array([1])], "selfie.jpg", { type: "image/jpeg" })),
    };
    (upsell!.querySelector(".gq-upsell-cta") as HTMLButtonElement).click();
    for (let i = 0; i < 6; i++) await tick();
    await wait(SWAP);
    for (let i = 0; i < 6; i++) await tick();

    // No automatic transform on the hero (not set up); "See on me" only on
    // the set-up card, and it renders that card.
    expect(tryonPosts).toEqual([]);
    const cards = Array.from(root.querySelectorAll(".gq-match-card"));
    expect(cards.map((c) => Boolean(c.querySelector(".gq-media-see")))).toEqual([false, true, false]);
    (cards[1].querySelector(".gq-media-see") as HTMLButtonElement).click();
    for (let i = 0; i < 6; i++) await tick();
    expect(tryonPosts).toEqual([{ productId: `gid://shopify/Product/${PRODUCTS[1].id}` }]);
  });

  it("grid results: See on me only on cards set up for try-on", async () => {
    const root = await bootResults(null, [true, false, true], {
      results: { ...makeConfig(null).results, layout: "grid" },
    });
    const cards = Array.from(root.querySelectorAll(".gq-gr-card"));
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => Boolean(c.querySelector(".gq-gr-see")))).toEqual([true, false, true]);
  });

  it.each([...TEMPLATES, null] as Renderer[])("%s: hidden when the browser can't hand over a photo", async (t) => {
    (window as any).FormData = undefined;
    const root = await bootResults(t, [true, true, true]);
    expect(upsellOf(root), label(t)).toBeNull();
  });

  it.each([...TEMPLATES, null] as Renderer[])("%s: hidden when quiz-config says try-on is off", async (t) => {
    const root = await bootResults(t, [true, true, true], { tryonEnabled: false });
    expect(upsellOf(root), label(t)).toBeNull();
  });

  it.each([...TEMPLATES, null] as Renderer[])(
    "%s: matches without the flag (older server, saved session, pool engine) keep today's CTA",
    async (t) => {
      const root = await bootResults(t, [undefined, undefined, undefined]);
      expect(upsellOf(root), label(t)).not.toBeNull();
    },
  );
});
