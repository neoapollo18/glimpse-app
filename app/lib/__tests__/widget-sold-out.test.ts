// @vitest-environment jsdom
//
// Sold-out variants on the LIVE storefront path, app-wide (Shopify App
// Review 2026-10-19, second round). On the review store the quiz matched
// "Wide-Leg Yoga Pants - Orange / L": that VARIANT was sold out while
// Orange / S and M were in stock (the product itself was available).
// Shopify refuses a sold-out variant, and refuses a whole multi-item add
// when one line is sold out, so "Add routine to cart" and the pants' own
// Add to bag both failed. Pinned here, for the classic results, the grid,
// every template (t1-t5) and every set (Bundle & save card, t3 routine,
// t4 kit):
// - a sold-out matched variant is never sent: the closest in-stock variant
//   goes instead (keep Orange, change the size), at its own price, and the
//   card says so
// - a product sold out in every option reads "Sold out" (disabled), and
//   sets add, count and price only what can go in the bag
// - a failed product JSON fetch never blocks an add (the matched variant
//   goes, as before)
// - everything in stock: the cart requests are exactly what they were
// Plus the cart answers: a 2xx that isn't Shopify's cart JSON (a redirect
// to an HTML page) is not an add, and a refused set retried line by line
// adds each line exactly as the set would have.
// The product JSON is the review store's own (/products/<handle>.js).

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
const CSS_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.css");
const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/review-store-products.json"), "utf8"));
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

type Variant = { id: number; title: string; available: boolean; price: number; options: string[]; name: string };
type Product = { handle: string; title: string; available: boolean; price: number; variants: Variant[] };

const TONER = "51646674567224";
const MASK = "51779489628216";
const PANTS_S = "51775802998840";
const PANTS_M = "51775803031608";
const PANTS_L = "51775803064376";
const HANDLES = { toner: "hydrating-green-tea-toner", mask: "purifying-clay-mask", pants: "wide-leg-yoga-pants" };
const SWAP_NOTE = "Orange / L is sold out, so we’ll add Orange / S.";

const opt = (label: string, axisValue: string) => ({
  label, axisValue, botResponse: null, reasonText: null, imageUrl: null, showIf: null, selectAll: false, displayMeta: null,
});
const question = (axisKey: string, axisLabel: string, prompt: string, options: unknown[]) => ({
  axisKey, axisLabel, prompt, helperText: null, multiSelect: false, maxSelections: null, screenGroup: null,
  showIf: null, optionStyle: null, options,
});
const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    question("shopping_for", "Shopping for", "What are you shopping for today?", [opt("Apparel", "apparel"), opt("Skincare", "skincare")]),
    question("apparel_size", "Size", "What's your size?", [opt("S", "s"), opt("M", "m"), opt("L", "l")]),
    question("budget", "Budget", "Where should we keep the price?", [opt("Under $100", "value"), opt("$100 and up", "premium")]),
  ],
};

function makeConfig(template: string | null, results: Record<string, unknown> = {}) {
  return {
    enabled: true,
    currency: "USD",
    assistantName: "Laura",
    template,
    brandTokens: null,
    tryonEnabled: false,
    compactLayout: false,
    introLayout: "split",
    emailPlacement: "gate_results",
    phases: [],
    theme: { heroImage: null },
    imageSlots: {},
    landing: {
      eyebrow: "Find My Fit", headline: "Let's find your perfect match", subtext: null, trustItems: [],
      beforeImageUrl: null, afterImageUrl: null, visualCaption: "", altAudienceLabel: "", altAudienceUrl: "",
      photoNote: null, founder: null, rating: null, benefitChips: [],
    },
    gate: { enabled: false },
    results: {
      headlinePhoto: "Here's your fit",
      headlineNoPhoto: "Here's your fit",
      addButtonTemplate: "Add {count} to bag · {total}",
      bundleEnabled: true,
      bundleLabel: "Add all {count} to bag · {total}",
      bundleSize: 0,
      matchFootnote: null,
      crossSell: null,
      bundleDiscount: { type: "percentage", value: 20, minQty: 2, note: "bundle savings" },
      primaryCta: "add",
      secondaryLink: true,
      layout: null,
      trustLines: [],
      proseTemplate: null,
      archetypeTitle: null,
      archetypeLine: null,
      ...results,
    },
    upsell: { title: null, body: null, cta: null },
    shadeGate: {},
    lead: { enabled: false },
  };
}

// The reviewer's matches (quiz_recommendations_served, 2026-10-19).
type MatchSpec = { key: keyof typeof HANDLES; variant: string | null; title: string | null };
const REVIEW_MATCHES: MatchSpec[] = [
  { key: "toner", variant: TONER, title: "Default Title" },
  { key: "mask", variant: MASK, title: "Female" },
  { key: "pants", variant: PANTS_L, title: "Orange / L" },
];

const savedResults = (specs: MatchSpec[]) => ({
  v: 1,
  s: {
    screen: "results",
    screenIndex: 0,
    criteria: { shopping_for: "apparel", apparel_size: "l", budget: "value" },
    answers: [
      { axisKey: "shopping_for", values: ["apparel"], labels: ["Apparel"] },
      { axisKey: "apparel_size", values: ["l"], labels: ["L"] },
      { axisKey: "budget", values: ["value"], labels: ["Under $100"] },
    ],
    hasPhoto: false,
    detectedShade: null,
    matches: specs.map((m, i) => {
      const p = FIXTURE.products[HANDLES[m.key]];
      return {
        productId: "gid://shopify/Product/" + p.id,
        variantId: m.variant ? "gid://shopify/ProductVariant/" + m.variant : null,
        variantNumericId: m.variant,
        productHandle: p.handle,
        productName: p.title,
        variantTitle: m.title,
        title: p.title,
        tagline: null,
        whyFits: null,
        rank: i + 1,
        quantity: 1,
        reasons: [],
      };
    }),
    matrixApplied: true,
    partial: false,
    columnar: null,
    quizStarted: true,
    leadDone: true,
    leadToken: null,
    leadReportedKey: null,
    // t1 opens on its "computing" screen once; a restored session is past it.
    t2ComputeDone: true,
  },
});

// ---- The store: product JSON and a cart answering like Shopify ----
let products: Record<string, Product>;
let jsonDown: Set<string>;
let jsonGate: Record<string, Promise<void>>;
let cart: Map<string, number>;
let refuseExtra: (id: string) => { status: number; description: string } | null;
let refusedSetStillAdds = false;
let addAnswer: "json" | "html-redirect" | "unreadable" = "json";
let fetchMock: ReturnType<typeof vi.fn>;
let config: Record<string, unknown>;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const res = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null) },
    json: () => Promise.resolve(body),
  });
const cartJson = () => ({
  token: "hWN4x1abc?key=7f3c",
  item_count: [...cart.values()].reduce((a, b) => a + b, 0),
  items: [...cart.entries()].map(([id, quantity]) => ({ variant_id: Number(id), quantity })),
  discount_codes: [],
});

function variantById(id: string): Variant | null {
  for (const p of Object.values(products)) {
    for (const v of p.variants) if (String(v.id) === id) return v;
  }
  return null;
}
// Shopify's verdict on one line: sold out per the store's own stock.
function refusal(id: string) {
  const extra = refuseExtra(id);
  if (extra) return extra;
  const v = variantById(id);
  if (!v) return { status: 404, description: "Cannot find variant" };
  if (!v.available) return { status: 422, description: `The product '${v.name}' is already sold out.` };
  return null;
}

function cartAdd(init: { body?: unknown }) {
  let items: Array<{ id: string; quantity: number }>;
  if (init.body instanceof FormData) {
    items = [{ id: String(init.body.get("id")), quantity: Number(init.body.get("quantity") || 1) }];
  } else {
    const parsed = JSON.parse(String(init.body || "{}"));
    items = (parsed.items || []).map((it: { id: unknown; quantity: unknown }) => ({ id: String(it.id), quantity: Number(it.quantity || 1) }));
  }
  if (addAnswer === "html-redirect") {
    // A storefront that bounces the request (password page, login wall):
    // fetch follows the redirect to an HTML page; nothing is added.
    return Promise.resolve({
      ok: true,
      status: 200,
      redirected: true,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
      json: () => Promise.reject(new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON")),
    });
  }
  const refused = items.map((it) => refusal(it.id)).find(Boolean) || null;
  if (refused) {
    if (refusedSetStillAdds) {
      items.filter((it) => !refusal(it.id)).forEach((it) => cart.set(it.id, (cart.get(it.id) || 0) + it.quantity));
    }
    return res(refused.status, { status: refused.status, message: "Cart Error", description: refused.description });
  }
  items.forEach((it) => cart.set(it.id, (cart.get(it.id) || 0) + it.quantity));
  if (addAnswer === "unreadable") {
    return Promise.resolve({
      ok: true, status: 200, redirected: false,
      headers: { get: () => "application/json" },
      json: () => Promise.reject(new TypeError("body stream already read")),
    });
  }
  return res(200, {
    items: items.map((it) => ({ id: Number(it.id), variant_id: Number(it.id), quantity: cart.get(it.id) })),
    sections: { "cart-icon-bubble": null, "cart-drawer": null },
  });
}

function routedFetch(url: string, init: { body?: unknown } = {}) {
  if (url.includes("/api/storefront/quiz-config")) return res(200, config);
  if (url.includes("/api/storefront/recommendation-config")) return res(200, FLOW);
  if (url.includes("/api/storefront/quiz-bundle-discount")) return res(200, { code: "GLEAME-BUNDLE-20" });
  const pm = /\/products\/([^/?]+)\.js/.exec(url);
  if (pm) {
    const handle = decodeURIComponent(pm[1]);
    if (jsonDown.has(handle) || !products[handle]) return res(404, { status: 404 });
    return (jsonGate[handle] || Promise.resolve()).then(() => res(200, clone(products[handle])));
  }
  if (url.includes("/cart/add.js")) return cartAdd(init);
  if (url.includes("/cart/update.js")) return res(200, cartJson());
  if (url.includes("/cart.js")) return res(200, cartJson());
  return res(200, {});
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(n = 40) {
  for (let i = 0; i < n; i++) await tick();
}

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

async function boot(
  template: string | null,
  results: Record<string, unknown> = {},
  specs = REVIEW_MATCHES,
  extra: Record<string, unknown> = {},
) {
  config = { ...makeConfig(template, results), ...extra };
  sessionStorage.setItem("gleame-quiz-state-v2", JSON.stringify(savedResults(specs)));
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="pqkzt0-gb.myshopify.com"></div>';
  fetchMock = vi.fn(routedFetch);
  (window as any).fetch = fetchMock;
  evalWidget();
  await settle(20);
  await wait(400);
  await settle(20);
  return document.getElementById("gleame-quiz-root")!;
}

// Storefront cart calls made since `from`, as "METHOD path body".
function cartCalls(from = 0) {
  return fetchMock.mock.calls.slice(from)
    .filter((c) => /\/cart(\/add|\/update)?\.js/.test(String(c[0])))
    .map((c) => {
      const init = (c[1] || {}) as { method?: string; body?: unknown };
      let body = "";
      if (init.body instanceof FormData) {
        body = "id=" + init.body.get("id") + " quantity=" + init.body.get("quantity");
      } else if (typeof init.body === "string") {
        const parsed = JSON.parse(init.body);
        body = parsed.items ? "items=" + parsed.items.map((it: { id: string; quantity: number }) => it.id + "x" + it.quantity).join(",") : JSON.stringify(parsed);
      }
      return ((init.method || "GET") + " " + String(c[0]) + (body ? " " + body : "")).trim();
    });
}
const adds = (from = 0) => cartCalls(from).filter((c) => c.startsWith("POST /cart/add.js"));
const cartLines = () => Object.fromEntries(cart);
const discountAsked = () => fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/storefront/quiz-bundle-discount"));
const text = (n: Element | null | undefined) => (n?.textContent || "").replace(/\s+/g, " ").trim();

// Where each layout puts the pants (the third match) and its sets.
type Layout = {
  name: string;
  template: string | null;
  results?: Record<string, unknown>;
  pants: (root: HTMLElement) => { scope: HTMLElement; add: HTMLButtonElement };
  set?: (root: HTMLElement) => HTMLButtonElement;
  added: string;
};
const pick = (root: HTMLElement, sel: string, i: number) => {
  const all = root.querySelectorAll<HTMLElement>(sel);
  expect(all.length, sel).toBeGreaterThan(i);
  return all[i];
};
const LAYOUTS: Layout[] = [
  {
    name: "classic",
    template: null,
    pants: (r) => { const scope = pick(r, ".gq-match-card", 2); return { scope, add: scope.querySelector(".gq-add-btn")! }; },
    set: (r) => r.querySelector(".gq-bundle-offer .gq-bo-add")!,
    added: "Added to bag ✓",
  },
  {
    name: "grid",
    template: null,
    results: { layout: "grid" },
    pants: (r) => { const scope = pick(r, ".gq-gr-card", 2); return { scope, add: scope.querySelector(".gq-gr-add")! }; },
    added: "Added",
  },
  {
    name: "t1",
    template: "t1",
    pants: (r) => { const scope = pick(r, ".gq-t1-alt", 1); return { scope, add: scope.querySelector(".gq-t1-alt-add")! }; },
    set: (r) => r.querySelector(".gq-bundle-offer .gq-bo-add")!,
    added: "Added to bag ✓",
  },
  {
    name: "t2",
    template: "t2",
    pants: (r) => {
      const add = pick(r, ".gq-t2r-alt-add", 1) as HTMLButtonElement;
      return { scope: add.closest("td") as HTMLElement, add };
    },
    set: (r) => r.querySelector(".gq-bundle-offer .gq-bo-add")!,
    added: "Added to bag ✓",
  },
  {
    name: "t3",
    template: "t3",
    pants: (r) => { const scope = pick(r, ".gq-t3r-step", 2); return { scope, add: scope.querySelector(".gq-t3r-step-add")! }; },
    set: (r) => r.querySelector(".gq-t3r-addall .gq-add-btn--bundle")!,
    added: "Added to bag ✓",
  },
  {
    name: "t4",
    template: "t4",
    pants: (r) => { const scope = pick(r, ".gq-t4r-mini", 2); return { scope, add: scope.querySelector(".gq-t4r-mini-add")! }; },
    set: (r) => r.querySelector(".gq-t4r-addall .gq-add-btn--bundle")!,
    added: "Added to bag ✓",
  },
  {
    name: "t5",
    template: "t5",
    pants: (r) => { const scope = pick(r, ".gq-t5r-card", 2); return { scope, add: scope.querySelector(".gq-t5r-add")! }; },
    set: (r) => r.querySelector(".gq-bundle-offer .gq-bo-add")!,
    added: "Added to bag ✓",
  },
];

function soldOutEverywhere() {
  const p = products[HANDLES.pants];
  p.available = false;
  p.variants.forEach((v) => { v.available = false; });
}

beforeEach(() => {
  products = clone(FIXTURE.products);
  jsonDown = new Set();
  jsonGate = {};
  cart = new Map();
  refuseExtra = () => null;
  refusedSetStillAdds = false;
  addAnswer = "json";
  sessionStorage.clear();
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).Shopify;
});

describe("the review store as it is: Orange / L sold out, Orange / S and M in stock", () => {
  it("the fixture is the store's real answer", () => {
    const pants = FIXTURE.products[HANDLES.pants] as Product;
    expect(pants.available).toBe(true);
    expect(pants.variants.map((v) => [String(v.id), v.title, v.available])).toEqual([
      [PANTS_S, "Orange / S", true],
      [PANTS_M, "Orange / M", true],
      [PANTS_L, "Orange / L", false],
    ]);
  });

  for (const layout of LAYOUTS) {
    it(`${layout.name}: the pants' Add to bag adds Orange / S, says so, and shows its price`, async () => {
      const root = await boot(layout.template, layout.results);
      const { scope, add } = layout.pants(root);
      expect(add.disabled).toBe(false);
      expect(text(scope)).toContain("$100.00");
      expect(text(scope.querySelector(".gq-swap-note") || scope.parentElement?.querySelector(".gq-swap-note"))).toBe(SWAP_NOTE);
      const from = fetchMock.mock.calls.length;
      add.click();
      await settle();

      expect(adds(from)).toEqual([`POST /cart/add.js id=${PANTS_S} quantity=1`]);
      expect(cartLines()).toEqual({ [PANTS_S]: 1 });
      expect(text(add)).toBe(layout.added);
      expect(root.querySelector(".gq-add-problem:not(:empty)")).toBeNull();
    });

    if (layout.set) {
      it(`${layout.name}: the set goes in one call with Orange / S in it`, async () => {
        const root = await boot(layout.template, layout.results);
        const btn = layout.set!(root);
        expect(btn, "set button").not.toBeNull();
        expect(btn.disabled).toBe(false);
        const from = fetchMock.mock.calls.length;
        btn.click();
        await settle();

        expect(adds(from)).toEqual([`POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS_S}x1`]);
        expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1, [PANTS_S]: 1 });
        expect(text(btn)).toBe("Added to bag ✓");
        expect(root.querySelector(".gq-add-problem:not(:empty)")).toBeNull();
        expect(discountAsked()).toBe(true);
      });
    }
  }

  it("the price shown is the price of the variant that goes in the bag", async () => {
    // Same store, Orange / S on sale: the card must not show the L price.
    products[HANDLES.pants].variants[0].price = 8500;
    const root = await boot("t5");
    const { scope } = LAYOUTS.find((l) => l.name === "t5")!.pants(root);
    expect(text(scope.querySelector(".gq-t5r-price"))).toBe("$85.00");
    expect(text(scope.querySelector(".gq-t5r-add"))).toBe("Add to bag · $85.00");
    // Bundle & save: 20 + 15 + 85 = 120, 20% off.
    expect(text(root.querySelector(".gq-bundle-offer .gq-bo-add"))).toBe("Add all 3 to bag · Save $24.00");
  });

  it("t3: the routine total and the regimen prices follow the variants added", async () => {
    products[HANDLES.pants].variants[0].price = 8500;
    const root = await boot("t3");
    expect(text(root.querySelector(".gq-t3r-total-value"))).toBe("$120.00");
    expect(text(pick(root, ".gq-t3r-step", 2).querySelector(".gq-t3r-step-price"))).toBe("$85.00");
  });

  it("the product links open the variant that goes in the bag", async () => {
    const root = await boot("t3");
    const view = pick(root, ".gq-t3r-step", 2).querySelector<HTMLAnchorElement>("a.gq-tpl-view")!;
    expect(view.getAttribute("href")).toBe(`/products/${HANDLES.pants}?variant=${PANTS_S}`);
    const grid = await boot(null, { layout: "grid" });
    const link = pick(grid, ".gq-gr-card", 2).querySelector<HTMLAnchorElement>("a.gq-gr-link")!;
    expect(link.getAttribute("href")).toBe(`/products/${HANDLES.pants}?variant=${PANTS_S}`);
  });

  it("t1 with the pants as the hero: the size picker starts on Orange / S, L can't be picked", async () => {
    const root = await boot("t1", {}, [REVIEW_MATCHES[2], REVIEW_MATCHES[0], REVIEW_MATCHES[1]]);
    const pills = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-t1r-variant"));
    expect(pills.map((p) => [text(p.querySelector("span")), p.classList.contains("is-selected"), p.disabled])).toEqual([
      ["Orange / S", true, false],
      ["Orange / M", false, false],
      ["Orange / L", false, true],
    ]);
    const hero = root.querySelector<HTMLButtonElement>(".gq-t1r-add")!;
    const from = fetchMock.mock.calls.length;
    hero.click();
    await settle();
    expect(adds(from)).toEqual([`POST /cart/add.js id=${PANTS_S} quantity=1`]);

    // Picking M adds M, and the "sold out, so we'll add" note goes.
    await wait(3300);
    pills[1].click();
    expect(root.querySelector(".gq-t1r-info .gq-swap-note")).toBeNull();
    const from2 = fetchMock.mock.calls.length;
    hero.click();
    await settle();
    expect(adds(from2)).toEqual([`POST /cart/add.js id=${PANTS_M} quantity=1`]);
  });

  it("classic phone bar with the pants as the top match adds Orange / S", async () => {
    const root = await boot(null, {}, [REVIEW_MATCHES[2], REVIEW_MATCHES[0], REVIEW_MATCHES[1]]);
    const sticky = root.querySelector<HTMLButtonElement>(".gq-sticky-bar .gq-add-btn--sticky")!;
    expect(text(sticky)).toBe("Add to bag · $100.00");
    // The fixed bar keeps its one-button height: no note in it.
    expect(root.querySelector(".gq-sticky-bar .gq-swap-note")).toBeNull();
    const from = fetchMock.mock.calls.length;
    sticky.click();
    await settle();
    expect(adds(from)).toEqual([`POST /cart/add.js id=${PANTS_S} quantity=1`]);
  });

  it("a tap before the product JSON lands waits for it and still adds Orange / S", async () => {
    let release!: () => void;
    jsonGate[HANDLES.pants] = new Promise<void>((r) => { release = r; });
    const root = await boot("t3");
    const add = pick(root, ".gq-t3r-step-add", 2) as HTMLButtonElement;
    expect(add.disabled).toBe(false); // armed right away, never a dead tap
    const from = fetchMock.mock.calls.length;
    add.click();
    await settle();
    expect(adds(from)).toEqual([]);
    release();
    await settle();
    expect(adds(from)).toEqual([`POST /cart/add.js id=${PANTS_S} quantity=1`]);
    expect(text(add)).toBe("Added to bag ✓");
  });
});

describe("a sold-out variant with nothing in common in stock", () => {
  // A one-option shade product: the matched shade is sold out and only
  // other shades are in stock. Swapping would hand the shopper a shade
  // they weren't matched to, so it reads Sold out instead.
  it("reads Sold out and adds nothing instead of swapping to another shade", async () => {
    const p = products[HANDLES.pants];
    p.variants.forEach((v, i) => {
      const shade = ["Ivory 01", "Sand 02", "Honey 03"][i];
      v.title = shade;
      v.options = [shade];
      (v as any).option1 = shade;
      (v as any).option2 = null;
    });
    const layout = LAYOUTS[0];
    const root = await boot(layout.template, layout.results);
    const { add } = layout.pants(root);
    expect(text(add)).toBe("Sold out");
    expect(add.disabled).toBe(true);
    expect(root.querySelector(".gq-swap-note")).toBeNull();
    const from = fetchMock.mock.calls.length;
    add.click();
    await settle();
    expect(adds(from)).toEqual([]);
  });
});

describe("a product sold out in every option", () => {
  for (const layout of LAYOUTS) {
    it(`${layout.name}: its Add to bag reads Sold out and adds nothing`, async () => {
      soldOutEverywhere();
      const root = await boot(layout.template, layout.results);
      const { add } = layout.pants(root);
      expect(text(add)).toBe("Sold out");
      expect(add.disabled).toBe(true);
      const from = fetchMock.mock.calls.length;
      add.click();
      await settle();
      expect(adds(from)).toEqual([]);
    });

    if (layout.set) {
      it(`${layout.name}: the set adds the two in stock, in one call, and the discount still applies`, async () => {
        soldOutEverywhere();
        const root = await boot(layout.template, layout.results);
        const btn = layout.set!(root);
        expect(btn.disabled).toBe(false);
        const from = fetchMock.mock.calls.length;
        btn.click();
        await settle();
        expect(adds(from)).toEqual([`POST /cart/add.js items=${TONER}x1,${MASK}x1`]);
        expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1 });
        expect(text(btn)).toBe("Added to bag ✓");
        expect(discountAsked()).toBe(true);
      });
    }
  }

  it("Bundle & save: the sold-out tile is out of the set, the title and price count two", async () => {
    soldOutEverywhere();
    const root = await boot("t5");
    const card = root.querySelector(".gq-bundle-offer")!;
    const tiles = Array.from(card.querySelectorAll<HTMLButtonElement>(".gq-bo-item"));
    expect(tiles.map((t) => [t.disabled, t.classList.contains("is-on")])).toEqual([[false, true], [false, true], [true, false]]);
    expect(text(tiles[2].querySelector(".gq-bo-item-price"))).toBe("Sold out");
    expect(text(card.querySelector(".gq-bo-title"))).toBe("Bundle all 2 and save 20%");
    expect(text(card.querySelector(".gq-bo-add"))).toBe("Add all 2 to bag · Save $7.00");
  });

  it("t3: Today's total is what the routine adds", async () => {
    soldOutEverywhere();
    const root = await boot("t3");
    expect(text(root.querySelector(".gq-t3r-total-value"))).toBe("$35.00");
    expect(text(root.querySelector(".gq-t3r-regimen-total"))).toBe("$35.00");
  });

  it("t4: the kit's Add all counts and prices the two in stock", async () => {
    soldOutEverywhere();
    const root = await boot("t4");
    expect(text(root.querySelector(".gq-t4r-addall .gq-add-btn--bundle"))).toBe("Add all 2 — $28.00");
  });

  it("a store that translated the Unavailable label sees its own word", async () => {
    soldOutEverywhere();
    const root = await boot("t5", {}, REVIEW_MATCHES, { uiText: { unavailable: "Épuisé" } });
    expect(text(LAYOUTS.find((l) => l.name === "t5")!.pants(root).add)).toBe("Épuisé");
  });
});

describe("matches that name no variant (pool engine sized sets)", () => {
  const POOL: MatchSpec[] = [
    { key: "toner", variant: TONER, title: null },
    { key: "mask", variant: MASK, title: null },
    { key: "pants", variant: null, title: null },
  ];
  it("the first in-stock variant goes, at its price", async () => {
    products[HANDLES.pants].variants[0].available = false; // S sold out
    products[HANDLES.pants].variants[1].price = 9000; // M
    const root = await boot(null, { layout: "grid" }, POOL);
    const card = pick(root, ".gq-gr-card", 2);
    expect(text(card.querySelector(".gq-gr-price"))).toBe("$90.00");
    const from = fetchMock.mock.calls.length;
    (card.querySelector(".gq-gr-add") as HTMLButtonElement).click();
    await settle();
    expect(adds(from)).toEqual([`POST /cart/add.js id=${PANTS_M} quantity=1`]);
  });

  it("nothing in stock: Sold out", async () => {
    soldOutEverywhere();
    const root = await boot(null, { layout: "grid" }, POOL);
    const add = pick(root, ".gq-gr-card", 2).querySelector(".gq-gr-add") as HTMLButtonElement;
    expect(text(add)).toBe("Sold out");
    expect(add.disabled).toBe(true);
  });
});

describe("when the product JSON can't be loaded", () => {
  it("the matched variant still goes (an add is never blocked on a failed fetch)", async () => {
    jsonDown.add(HANDLES.pants);
    const root = await boot("t3");
    const add = pick(root, ".gq-t3r-step-add", 2) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    const from = fetchMock.mock.calls.length;
    add.click();
    await settle();
    // Shopify is the judge then: it refuses L and says why.
    expect(adds(from)).toEqual([`POST /cart/add.js id=${PANTS_L} quantity=1`]);
    expect(text(add)).toBe("Couldn’t add — try again");
    expect(text(root.querySelector(".gq-add-problem"))).toBe("The product 'Wide-Leg Yoga Pants - Orange / L' is already sold out.");
  });
});

describe("everything in stock: the requests are exactly what they were", () => {
  beforeEach(() => {
    products[HANDLES.pants].variants[2].available = true; // Orange / L back in stock
  });

  it("single add: the same form body", async () => {
    const root = await boot("t3");
    const add = pick(root, ".gq-t3r-step-add", 2) as HTMLButtonElement;
    const from = fetchMock.mock.calls.length;
    add.click();
    await settle();
    const posts = fetchMock.mock.calls.slice(from).filter((c) => String(c[0]) === "/cart/add.js");
    expect(posts).toHaveLength(1);
    const body = (posts[0][1] as { body: FormData }).body;
    expect([...body.entries()]).toEqual([
      ["id", PANTS_L],
      ["quantity", "1"],
      ["sections", "cart-icon-bubble,cart-drawer"],
      ["sections_url", "/"],
    ]);
    expect(root.querySelector(".gq-swap-note")).toBeNull();
    // Nothing read before the add: the cart calls are the add, then the
    // header count and token reads that always followed it.
    expect(cartCalls(from)).toEqual([`POST /cart/add.js id=${PANTS_L} quantity=1`, "GET /cart.js", "GET /cart.js"]);
  });

  it("routine: the same JSON body, one call", async () => {
    const root = await boot("t3");
    const btn = root.querySelector<HTMLButtonElement>(".gq-t3r-addall .gq-add-btn--bundle")!;
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();
    const posts = fetchMock.mock.calls.slice(from).filter((c) => String(c[0]) === "/cart/add.js");
    expect(posts).toHaveLength(1);
    expect((posts[0][1] as { body: string }).body).toBe(
      JSON.stringify({
        items: [{ id: TONER, quantity: 1 }, { id: MASK, quantity: 1 }, { id: PANTS_L, quantity: 1 }],
        sections: "cart-icon-bubble,cart-drawer",
        sections_url: "/",
      }),
    );
    expect(cartCalls(from)[0]).toBe(`POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS_L}x1`);
    expect(cartCalls(from)[1]).toBe("GET /cart.js");
  });
});

describe("Shopify's answer to an add", () => {
  it("a redirect to an HTML page is not an add (single)", async () => {
    addAnswer = "html-redirect";
    const root = await boot("t3");
    const toner = pick(root, ".gq-t3r-step-add", 0) as HTMLButtonElement;
    toner.click();
    await settle();
    expect(cartLines()).toEqual({});
    expect(text(toner)).toBe("Couldn’t add — try again");
  });

  it("a redirect to an HTML page is not an add (routine), and is not retried line by line", async () => {
    addAnswer = "html-redirect";
    const root = await boot("t3");
    const btn = root.querySelector<HTMLButtonElement>(".gq-t3r-addall .gq-add-btn--bundle")!;
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();
    expect(adds(from)).toHaveLength(1);
    expect(text(btn)).toBe("Couldn’t add — try again");
  });

  it("a 2xx whose body can't be read counts once the cart shows the line", async () => {
    addAnswer = "unreadable";
    const root = await boot("t3");
    const toner = pick(root, ".gq-t3r-step-add", 0) as HTMLButtonElement;
    toner.click();
    await settle();
    expect(cartLines()).toEqual({ [TONER]: 1 });
    expect(text(toner)).toBe("Added to bag ✓");
  });

  it("a 2xx whose body can't be read, with the cart unchanged, is not an add", async () => {
    addAnswer = "unreadable";
    const root = await boot("t3");
    // The response says 2xx, but the line never reaches the cart.
    const realAdd = cartAdd;
    fetchMock.mockImplementation((url: string, init: { body?: unknown } = {}) => {
      if (url.includes("/cart/add.js")) {
        const before = new Map(cart);
        return realAdd(init).then((r: unknown) => { cart = before; return r; });
      }
      return routedFetch(url, init);
    });
    const toner = pick(root, ".gq-t3r-step-add", 0) as HTMLButtonElement;
    toner.click();
    await settle();
    expect(cartLines()).toEqual({});
    expect(text(toner)).toBe("Couldn’t add — try again");
  });
});

describe("a refused set retried line by line adds each line exactly as the set would have", () => {
  const PLAN_ONLY = { status: 422, description: "Variant can only be purchased with a selling plan." };
  beforeEach(() => {
    products[HANDLES.pants].variants[2].available = true;
  });

  it("a product already in the cart before the tap is added again, like the set would", async () => {
    cart.set(TONER, 1); // added earlier, from the product page
    refuseExtra = (id) => (id === MASK ? PLAN_ONLY : null);
    const root = await boot("t3");
    const btn = root.querySelector<HTMLButtonElement>(".gq-t3r-addall .gq-add-btn--bundle")!;
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();
    expect(adds(from)).toEqual([
      `POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS_L}x1`,
      `POST /cart/add.js items=${TONER}x1`,
      `POST /cart/add.js items=${MASK}x1`,
      `POST /cart/add.js items=${PANTS_L}x1`,
    ]);
    expect(cartLines()).toEqual({ [TONER]: 2, [PANTS_L]: 1 });
    expect(text(btn)).toBe("Added 2 of 3 to bag");
  });

  it("lines a refused set put in anyway are not added twice, even on top of earlier ones", async () => {
    cart.set(TONER, 1);
    refuseExtra = (id) => (id === MASK ? PLAN_ONLY : null);
    refusedSetStillAdds = true;
    const root = await boot("t3");
    const btn = root.querySelector<HTMLButtonElement>(".gq-t3r-addall .gq-add-btn--bundle")!;
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();
    expect(adds(from)).toEqual([
      `POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS_L}x1`,
      `POST /cart/add.js items=${MASK}x1`,
    ]);
    expect(cartLines()).toEqual({ [TONER]: 2, [PANTS_L]: 1 });
    expect(text(btn)).toBe("Added 2 of 3 to bag");
  });

  it("a quiz add made just before counts as before the tap", async () => {
    refuseExtra = (id) => (id === MASK ? PLAN_ONLY : null);
    const root = await boot("t3");
    (pick(root, ".gq-t3r-step-add", 0) as HTMLButtonElement).click();
    await settle();
    expect(cartLines()).toEqual({ [TONER]: 1 });
    const btn = root.querySelector<HTMLButtonElement>(".gq-t3r-addall .gq-add-btn--bundle")!;
    btn.click();
    await settle();
    expect(cartLines()).toEqual({ [TONER]: 2, [PANTS_L]: 1 });
  });
});

describe("ORLY classic phone bar: a failed add keeps the bar's height", () => {
  it("the reason floats above the fixed bar instead of growing it", () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    const rule = /#gleame-quiz-root \.gq-sticky-bar \.gq-add-problem\s*\{([^}]*)\}/.exec(css);
    expect(rule, "sticky bar reason rule").not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).toMatch(/bottom:\s*100%/);
  });

  it("the reason sits in the bar's own box and clears itself", async () => {
    refuseExtra = (id) => (id === TONER ? { status: 422, description: "Variant can only be purchased with a selling plan." } : null);
    const root = await boot(null);
    const sticky = root.querySelector<HTMLButtonElement>(".gq-sticky-bar .gq-add-btn--sticky")!;
    sticky.click();
    await settle();
    const bar = root.querySelector(".gq-sticky-bar")!;
    expect(text(bar.querySelector(".gq-add-problem"))).toBe("Variant can only be purchased with a selling plan.");
    await wait(6100);
    expect(bar.querySelector(".gq-add-problem")).toBeNull();
  }, 15000);
});
