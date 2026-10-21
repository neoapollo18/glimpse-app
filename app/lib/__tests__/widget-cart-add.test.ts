// @vitest-environment jsdom
//
// Add to cart on the LIVE storefront path, with /cart/add.js answering the
// way Shopify does. Shopify App Review (2026-10-19, t3 routine template):
// "Add routine to cart" showed the add-failed label and nothing went in
// the bag. Shopify refuses a multi-item add as a whole when ONE line
// can't be added (sold out, subscription-only, unknown or unpublished
// variant), so one bad line sank the routine, and the shopper was never
// told which line or why. Pinned here:
// - a refused set goes again line by line; what Shopify accepts is added
//   and the button says which line couldn't be and Shopify's reason
// - a set Shopify refused AFTER adding its good lines (seen in the wild)
//   is not added twice
// - a 2xx whose body can't be read is a success
// - nothing after a successful add (bundle code, tracking) can turn it into
//   "Couldn't add"
// The fixture is the reviewer's own results: 3 matches, t3, bundle on,
// 20% bundle discount from 2 items.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

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
    question("vibe", "Vibe", "What matters most to you?", [opt("Everyday reliability", "everyday"), opt("Top performance", "performance")]),
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

// The reviewer's three matches (quiz_recommendations_served, 2026-10-19).
const TONER = "51646674567224";
const MASK = "51779489628216";
const PANTS = "51775803064376";
const MATCHES = [
  { handle: "hydrating-green-tea-toner", name: "Hydrating green tea toner", product: 10595493642296, variant: TONER, price: 2000 },
  { handle: "purifying-clay-mask", name: "Purifying Clay Mask", product: 10595492888632, variant: MASK, price: 1500 },
  { handle: "wide-leg-yoga-pants", name: "Wide-Leg Yoga Pants", product: 10603010293816, variant: PANTS, price: 10000 },
];

// /products/{handle}.js as Shopify serves it (the fields the widget reads).
function productJson(m: (typeof MATCHES)[number]) {
  return {
    id: m.product, title: m.name, handle: m.handle, price: m.price, available: true,
    featured_image: "//cdn.shopify.com/s/files/" + m.handle + ".png", images: [],
    requires_selling_plan: false, selling_plan_groups: [],
    variants: [{
      id: Number(m.variant), title: "Default Title", name: m.name, price: m.price, available: true,
      featured_image: null, requires_selling_plan: false, selling_plan_allocations: [],
    }],
  };
}

// A shopper who finished the quiz (sessionStorage restore lands on results).
const savedResults = () => ({
  v: 1,
  s: {
    screen: "results",
    screenIndex: 0,
    criteria: { shopping_for: "skincare", vibe: "everyday", budget: "value" },
    answers: [
      { axisKey: "shopping_for", values: ["skincare"], labels: ["Skincare"] },
      { axisKey: "vibe", values: ["everyday"], labels: ["Everyday reliability"] },
      { axisKey: "budget", values: ["value"], labels: ["Under $100"] },
    ],
    hasPhoto: false,
    detectedShade: null,
    matches: MATCHES.map((m, i) => ({
      productId: "gid://shopify/Product/" + m.product,
      variantId: "gid://shopify/ProductVariant/" + m.variant,
      variantNumericId: m.variant,
      productHandle: m.handle,
      productName: m.name,
      variantTitle: null,
      title: m.name,
      tagline: null,
      whyFits: null,
      rank: i + 1,
      quantity: 1,
      reasons: [],
    })),
    matrixApplied: true,
    partial: false,
    columnar: null,
    quizStarted: true,
    leadDone: true,
    leadToken: null,
    leadReportedKey: null,
  },
});

// ---- A Shopify cart answering the Cart AJAX API ----
type Refusal = { status: number; description: string };
const SOLD_OUT: Refusal = { status: 422, description: "The product 'Wide-Leg Yoga Pants - Orange / L' is already sold out." };
const PLAN_ONLY: Refusal = { status: 422, description: "Variant can only be purchased with a selling plan." };
const NOT_FOUND: Refusal = { status: 404, description: "Cannot find variant" };

let cart: Map<string, number>;
let refuse: (variantId: string) => Refusal | null;
let addBodyUnreadable = false;
let refusedSetStillAdds = false;
let addNetworkError = false;
let discountEndpoint: (url: string) => Promise<unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let config: Record<string, unknown>;

const res = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const cartJson = () => ({
  token: "hWN4x1abc?key=7f3c",
  item_count: [...cart.values()].reduce((a, b) => a + b, 0),
  items: [...cart.entries()].map(([id, quantity]) => ({ variant_id: Number(id), quantity })),
  discount_codes: [],
});

function cartAdd(init: { body?: unknown }) {
  if (addNetworkError) return Promise.reject(new TypeError("Failed to fetch"));
  let items: Array<{ id: string; quantity: number }>;
  if (init.body instanceof FormData) {
    items = [{ id: String(init.body.get("id")), quantity: Number(init.body.get("quantity") || 1) }];
  } else {
    const parsed = JSON.parse(String(init.body || "{}"));
    items = (parsed.items || []).map((it: { id: unknown; quantity: unknown }) => ({ id: String(it.id), quantity: Number(it.quantity || 1) }));
  }
  const refused = items.map((it) => refuse(it.id)).find(Boolean) || null;
  if (refused) {
    // Documented: a refused set adds nothing. Seen in the wild: a 422 that
    // still put the acceptable lines in the cart.
    if (refusedSetStillAdds) {
      items.filter((it) => !refuse(it.id)).forEach((it) => cart.set(it.id, (cart.get(it.id) || 0) + it.quantity));
    }
    return res(refused.status, { status: refused.status, message: "Cart Error", description: refused.description });
  }
  items.forEach((it) => cart.set(it.id, (cart.get(it.id) || 0) + it.quantity));
  if (addBodyUnreadable) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new TypeError("body stream already read")) });
  }
  return res(200, {
    items: items.map((it) => ({ variant_id: Number(it.id), quantity: cart.get(it.id) })),
    sections: { "cart-icon-bubble": null, "cart-drawer": null },
  });
}

function routedFetch(url: string, init: { body?: unknown } = {}) {
  if (url.includes("/api/storefront/quiz-config")) return res(200, config);
  if (url.includes("/api/storefront/recommendation-config")) return res(200, FLOW);
  if (url.includes("/api/storefront/quiz-bundle-discount")) return discountEndpoint(url);
  for (const m of MATCHES) if (url.includes("/products/" + m.handle + ".js")) return res(200, productJson(m));
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

async function bootResults(template: string | null, results: Record<string, unknown> = {}) {
  config = makeConfig(template, results);
  sessionStorage.setItem("gleame-quiz-state-v2", JSON.stringify(savedResults()));
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="review-store.myshopify.com"></div>';
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
const tracked = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("/api/storefront/track-event"))
    .map((c) => JSON.parse(String((c[1] as any)?.body || "{}")));
const discountAsked = () => fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/storefront/quiz-bundle-discount"));
const cartLines = () => Object.fromEntries(cart);

function routineButton(root: HTMLElement) {
  const btn = root.querySelector(".gq-t3r-addall .gq-add-btn--bundle") as HTMLButtonElement;
  expect(btn, "t3 Add routine to cart").not.toBeNull();
  expect(btn.textContent).toBe("Add routine to cart");
  expect(btn.disabled).toBe(false);
  return btn;
}
const problemText = (root: HTMLElement, scope: string) =>
  (root.querySelector(scope + " .gq-add-problem")?.textContent || "").trim();

beforeEach(() => {
  cart = new Map();
  refuse = () => null;
  addBodyUnreadable = false;
  refusedSetStillAdds = false;
  addNetworkError = false;
  discountEndpoint = () => res(200, { code: "GLEAME-BUNDLE-20" });
  sessionStorage.clear();
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).Shopify;
});

describe("t3 Add routine to cart (the reviewer's routine)", () => {
  it("adds the whole routine in one call when Shopify accepts it", async () => {
    const root = await bootResults("t3");
    const btn = routineButton(root);
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();

    expect(cartCalls(from)[0]).toBe(`POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS}x1`);
    expect(cartCalls(from).filter((c) => c.startsWith("POST /cart/add.js"))).toHaveLength(1);
    expect(btn.textContent).toBe("Added to bag ✓");
    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1, [PANTS]: 1 });
    expect(problemText(root, ".gq-t3r-addall")).toBe("");
    expect(discountAsked()).toBe(true);
  });

  for (const [label, refusal] of [["sold out", SOLD_OUT], ["subscription only", PLAN_ONLY], ["unknown variant", NOT_FOUND]] as const) {
    it(`one line Shopify refuses (${label}) no longer sinks the other two`, async () => {
      refuse = (id) => (id === PANTS ? refusal : null);
      const root = await bootResults("t3");
      const btn = routineButton(root);
      const from = fetchMock.mock.calls.length;
      btn.click();
      await settle();

      // The set is refused as a whole, so the lines go again one at a time.
      expect(cartCalls(from)).toEqual([
        `POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS}x1`,
        "GET /cart.js",
        `POST /cart/add.js items=${TONER}x1`,
        `POST /cart/add.js items=${MASK}x1`,
        `POST /cart/add.js items=${PANTS}x1`,
        "GET /cart.js",
        ...cartCalls(from).slice(6),
      ]);
      expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1 });
      expect(btn.textContent).toBe("Added 2 of 3 to bag");
      expect(problemText(root, ".gq-t3r-addall")).toBe("Couldn’t add Wide-Leg Yoga Pants. " + refusal.description);
      expect(root.querySelector(".gq-t3r-addall .gq-add-problem")!.getAttribute("role")).toBe("status");
      // Two units still reach the bundle minimum: the code goes on.
      expect(discountAsked()).toBe(true);
      const bundleEvent = tracked().find((e) => e.eventType === "quiz_add_bundle_to_bag");
      expect(bundleEvent.properties.items.map((it: { v: string }) => it.v)).toEqual([TONER, MASK]);
      expect(bundleEvent.properties.price).toBe(3500);
    });
  }

  it("a set Shopify refused after adding its good lines is not added twice", async () => {
    refuse = (id) => (id === PANTS ? SOLD_OUT : null);
    refusedSetStillAdds = true;
    const root = await bootResults("t3");
    const btn = routineButton(root);
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();

    expect(cartCalls(from).filter((c) => c.startsWith("POST /cart/add.js"))).toEqual([
      `POST /cart/add.js items=${TONER}x1,${MASK}x1,${PANTS}x1`,
      `POST /cart/add.js items=${PANTS}x1`,
    ]);
    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1 });
    expect(btn.textContent).toBe("Added 2 of 3 to bag");
  });

  it("only one unit in: no bundle code, and the reasons for both refusals", async () => {
    refuse = (id) => (id === PANTS ? SOLD_OUT : id === MASK ? PLAN_ONLY : null);
    const root = await bootResults("t3");
    const btn = routineButton(root);
    btn.click();
    await settle();

    expect(cartLines()).toEqual({ [TONER]: 1 });
    expect(btn.textContent).toBe("Added 1 of 3 to bag");
    expect(problemText(root, ".gq-t3r-addall")).toBe(
      "Couldn’t add Purifying Clay Mask. " + PLAN_ONLY.description + " Couldn’t add Wide-Leg Yoga Pants. " + SOLD_OUT.description,
    );
    expect(discountAsked()).toBe(false);
  });

  it("nothing Shopify accepts: Couldn't add, with Shopify's reason", async () => {
    refuse = () => SOLD_OUT;
    const root = await bootResults("t3");
    const btn = routineButton(root);
    btn.click();
    await settle();

    expect(cartLines()).toEqual({});
    expect(btn.textContent).toBe("Couldn’t add — try again");
    expect(problemText(root, ".gq-t3r-addall")).toBe(SOLD_OUT.description);
    expect(discountAsked()).toBe(false);
    expect(tracked().some((e) => e.eventType === "quiz_add_bundle_to_bag")).toBe(false);
  });

  it("a network failure is not retried line by line (it may have landed)", async () => {
    addNetworkError = true;
    const root = await bootResults("t3");
    const btn = routineButton(root);
    const from = fetchMock.mock.calls.length;
    btn.click();
    await settle();

    expect(cartCalls(from).filter((c) => c.startsWith("POST /cart/add.js"))).toHaveLength(1);
    expect(btn.textContent).toBe("Couldn’t add — try again");
  });

  it("a 2xx whose body can't be read is a success, not Couldn't add", async () => {
    addBodyUnreadable = true;
    const root = await bootResults("t3");
    const btn = routineButton(root);
    btn.click();
    await settle();

    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1, [PANTS]: 1 });
    expect(btn.textContent).toBe("Added to bag ✓");
  });

  it("the bundle code step can't turn a successful add into Couldn't add", async () => {
    // A storefront script that wraps window.fetch and throws on the app's
    // cross-origin request, synchronously, inside the success handler.
    discountEndpoint = () => {
      throw new TypeError("blocked by a fetch wrapper");
    };
    const root = await bootResults("t3");
    const btn = routineButton(root);
    btn.click();
    await settle();

    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1, [PANTS]: 1 });
    expect(btn.textContent).toBe("Added to bag ✓");
    expect(problemText(root, ".gq-t3r-addall")).toBe("");
  });

  it("a refused or failing bundle code leaves the add alone", async () => {
    discountEndpoint = () => res(500, { error: "boom" });
    const root = await bootResults("t3");
    const btn = routineButton(root);
    btn.click();
    await settle();
    expect(btn.textContent).toBe("Added to bag ✓");
    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1, [PANTS]: 1 });
  });
});

describe("single Add to bag", () => {
  it("adds the matched variant with the form body Shopify expects", async () => {
    const root = await bootResults("t3");
    const steps = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-t3r-step-add"));
    expect(steps).toHaveLength(3);
    const from = fetchMock.mock.calls.length;
    steps[0].click();
    await settle();
    expect(cartCalls(from)[0]).toBe(`POST /cart/add.js id=${TONER} quantity=1`);
    expect(steps[0].textContent).toBe("Added to bag ✓");
    expect(cartLines()).toEqual({ [TONER]: 1 });
  });

  it("a refused line says why under the step", async () => {
    refuse = (id) => (id === PANTS ? PLAN_ONLY : null);
    const root = await bootResults("t3");
    const pants = root.querySelectorAll<HTMLButtonElement>(".gq-t3r-step-add")[2];
    pants.click();
    await settle();
    expect(pants.textContent).toBe("Couldn’t add — try again");
    const line = pants.parentNode!.querySelector(".gq-add-problem") || pants.parentNode!.parentNode!.querySelector(".gq-add-problem");
    expect(line?.textContent).toBe(PLAN_ONLY.description);
    expect(line?.getAttribute("role")).toBe("status");

    // The next tap clears it, and a success leaves none.
    refuse = () => null;
    await wait(2700);
    pants.click();
    await settle();
    expect(pants.textContent).toBe("Added to bag ✓");
    expect(root.querySelector(".gq-t3r-step .gq-add-problem")).toBeNull();
  });

  it("a 2xx whose body can't be read is a success", async () => {
    addBodyUnreadable = true;
    const root = await bootResults("t3");
    const toner = root.querySelector<HTMLButtonElement>(".gq-t3r-step-add")!;
    toner.click();
    await settle();
    expect(toner.textContent).toBe("Added to bag ✓");
  });

  it("the bundle code step can't turn a successful single add into Couldn't add", async () => {
    discountEndpoint = () => {
      throw new TypeError("blocked by a fetch wrapper");
    };
    const root = await bootResults("t3");
    const steps = Array.from(root.querySelectorAll<HTMLButtonElement>(".gq-t3r-step-add"));
    steps[0].click();
    await settle();
    steps[1].click(); // reaches the 2-unit minimum: the code step runs
    await settle();
    expect(steps[1].textContent).toBe("Added to bag ✓");
    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1 });
  });
});

describe("Bundle & save card (classic and t1/t2/t5)", () => {
  it("adds what Shopify accepts and names the line it refused", async () => {
    refuse = (id) => (id === PANTS ? SOLD_OUT : null);
    const root = await bootResults("t5");
    const card = root.querySelector(".gq-bundle-offer")!;
    expect(card, "bundle card").not.toBeNull();
    const btn = card.querySelector(".gq-bo-add") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    await settle();

    expect(cartLines()).toEqual({ [TONER]: 1, [MASK]: 1 });
    expect(btn.textContent).toBe("Added 2 of 3 to bag");
    expect(problemText(root, ".gq-bundle-offer")).toBe("Couldn’t add Wide-Leg Yoga Pants. " + SOLD_OUT.description);
    expect(discountAsked()).toBe(true);
  });

  it("all refused: Couldn't add with the reason, which stays until the next tap", async () => {
    refuse = () => SOLD_OUT;
    const root = await bootResults(null);
    const btn = root.querySelector(".gq-bundle-offer .gq-bo-add") as HTMLButtonElement;
    btn.click();
    await settle();
    expect(btn.textContent).toBe("Couldn’t add — try again");
    expect(problemText(root, ".gq-bundle-offer")).toBe(SOLD_OUT.description);
    await wait(2700);
    expect(problemText(root, ".gq-bundle-offer")).toBe(SOLD_OUT.description);
  });
});

describe("theme cart drawer after a quiz add", () => {
  // Dawn-family themes mark <cart-drawer> "is-empty" while the cart is
  // empty, which hides the drawer header and items. renderContents only
  // swaps what is inside it, so a first add into an empty cart must drop
  // the class too (as the theme's own product form does), or the drawer
  // opens showing only the subtotal.
  it("Dawn-family drawer: renders the sections we asked for and drops the empty-cart class", async () => {
    const root = await bootResults(null);
    const drawer = document.createElement("cart-drawer");
    drawer.className = "drawer is-empty";
    const rendered: unknown[] = [];
    (drawer as any).renderContents = (state: unknown) => rendered.push(state);
    document.body.appendChild(drawer);
    const sections = { "cart-drawer": '<div id="CartDrawer"></div>', "cart-icon-bubble": "<span></span>" };
    fetchMock = vi.fn((url: string, init: any = {}) =>
      url.includes("/cart/add.js")
        ? cartAdd(init).then((r: any) => ({ ...r, json: () => r.json().then((b: any) => ({ ...b, sections })) }))
        : routedFetch(url, init),
    );
    (window as any).fetch = fetchMock;

    const btn = root.querySelector(".gq-bundle-offer .gq-bo-add") as HTMLButtonElement;
    btn.click();
    await settle();

    expect(btn.textContent).toBe("Added to bag ✓");
    expect(rendered).toHaveLength(1);
    expect((rendered[0] as any).sections).toEqual(sections);
    expect(drawer.classList.contains("is-empty")).toBe(false);
  });
});

describe("bundles switched off for the store (server allowlist, 2026-10-20)", () => {
  it("t3 shows no Add routine to cart; each step keeps its own Add to bag", async () => {
    const root = await bootResults("t3", { bundleEnabled: false, bundleDiscount: null });
    expect(root.querySelector(".gq-t3r-addall")).toBeNull();
    expect(root.querySelector(".gq-add-btn--bundle")).toBeNull();
    expect(root.querySelector(".gq-t3r-total")).not.toBeNull();
    const singles = [...root.querySelectorAll<HTMLButtonElement>("button")].filter((b) => /^Add to bag/.test(b.textContent || ""));
    expect(singles.length).toBeGreaterThanOrEqual(3);
  });

  it("classic and t5 show no Bundle & save card", async () => {
    for (const template of [null, "t5"]) {
      const root = await bootResults(template, { bundleEnabled: false, bundleDiscount: null });
      expect(root.querySelector(".gq-bundle-offer"), String(template)).toBeNull();
      expect(root.querySelector(".gq-add-btn--bundle"), String(template)).toBeNull();
    }
  });
});
