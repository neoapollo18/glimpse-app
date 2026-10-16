// @vitest-environment jsdom
//
// 2026-10-16 storefront latency pass (Built for Shopify review):
//   - images are requested resized (Supabase render endpoint, Shopify CDN
//     width) with a one-shot fallback to the original on error;
//   - the theme block's inline GLEAME_QUIZ_BOOT fetches are reused instead
//     of fetched again, only on an exact url match;
//   - the block's reserved min-height is released once the quiz renders,
//     or when it won't render at all.
// The widget runs verbatim in jsdom, like the other widget-*.test.ts files.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const SUPA = "https://glglqybgabptczqskbcj.supabase.co/storage/v1";
const SUPA_PNG = `${SUPA}/object/public/reference-images/shop.myshopify.com/avatar-1.png`;
const SUPA_SVG = `${SUPA}/object/public/reference-images/shop.myshopify.com/logo.svg`;
const CDN_PNG = "https://cdn.shopify.com/s/files/1/0001/files/Short.png?v=123";
const CDN_SIZED = "https://cdn.shopify.com/s/files/1/0001/files/Long.png?v=1&width=500&height=500&crop=center";
const OTHER = "https://images.example.com/medium.png";

const opt = (label: string, axisValue: string, imageUrl: string | null) => ({
  label,
  axisValue,
  reasonText: null,
  imageUrl,
  showIf: null,
  selectAll: false,
  displayMeta: null,
});

function makeFlow() {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      {
        axisKey: "length",
        axisLabel: "length",
        prompt: "How long?",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: "visual",
        options: [
          opt("Super short", "super_short", SUPA_PNG),
          opt("Short", "short", CDN_PNG),
          opt("Medium", "medium", OTHER),
          opt("Long", "long", CDN_SIZED),
          opt("Logo", "logo", SUPA_SVG),
        ],
      },
    ],
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: true,
    compactLayout: false,
    uiStyle: null,
    landing: { eyebrow: null, headline: "Find your fit", subtext: null, trustItems: [] },
    gate: { enabled: false },
    results: { layout: null, bundleEnabled: false, bundleDiscount: null, crossSell: null },
    upsell: {},
    shadeGate: {},
    lead: { enabled: false },
    ...overrides,
  };
}

const PRODUCT_JSON = {
  hailey: {
    id: 1,
    handle: "hailey",
    title: "Hailey",
    price: 1999,
    available: true,
    featured_image: "//cdn.shopify.com/s/files/1/0001/products/hailey.jpg?v=9",
    images: [],
    variants: [{ id: 901, price: 1999, available: true, featured_image: null }],
  },
};
const SAMPLE = {
  matrixApplied: false,
  partial: false,
  matches: [
    { productId: "p1", productHandle: "hailey", productName: "Hailey", variantTitle: "Default Title", variantNumericId: null, quantity: 1, reasons: [] },
  ],
};

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

const ROOT_HTML =
  '<div id="gleame-quiz-root" data-shop-domain="shop.myshopify.com" style="--gq-pad-top: 24px; min-height: 100vh;"></div>';

async function bootPreview(step: string) {
  document.body.innerHTML = ROOT_HTML;
  (window as any).GLEAME_QUIZ_PREVIEW = {
    config: makeConfig(),
    flow: makeFlow(),
    sampleRecommend: SAMPLE,
    productJson: PRODUCT_JSON,
    studio: false,
    overrides: { step },
  };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  await wait(250);
  return document.getElementById("gleame-quiz-root")!;
}

const API = "https://glimpse-app-charles.onrender.com/api/storefront/";
const CONFIG_URL = `${API}quiz-config?shopDomain=shop.myshopify.com&tpl=3`;
const FLOW_URL = `${API}recommendation-config?shopDomain=shop.myshopify.com`;

// Storefront (non-preview) boot with a fetch spy. `boot` mimics the block's
// inline script.
async function bootStorefront(opts: { boot?: Record<string, unknown> | null; config?: Record<string, unknown> }) {
  document.body.innerHTML = ROOT_HTML;
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  const config = opts.config ?? makeConfig();
  const calls: string[] = [];
  (window as any).fetch = (url: string) => {
    calls.push(String(url));
    const body = String(url).includes("quiz-config") ? config : String(url).includes("recommendation-config") ? makeFlow() : {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  (window as any).GLEAME_QUIZ_BOOT = opts.boot ?? undefined;
  try {
    sessionStorage.clear();
  } catch {
    // jsdom always has it; real storefronts may not.
  }
  evalWidget();
  for (let i = 0; i < 6; i++) await tick();
  await wait(50);
  return { root: document.getElementById("gleame-quiz-root")!, calls };
}

afterEach(() => {
  delete (window as any).GLEAME_QUIZ_BOOT;
});

describe("image sizing", () => {
  it("requests answer art resized on Supabase and Shopify's CDN, leaves the rest alone", async () => {
    const root = await bootPreview("q1");
    const srcs = Array.from(root.querySelectorAll<HTMLImageElement>("img.gq-option-img")).map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([
      `${SUPA}/render/image/public/reference-images/shop.myshopify.com/avatar-1.png?width=540&quality=75&resize=contain`,
      `${CDN_PNG}&width=540`,
      OTHER,
      CDN_SIZED, // already sized by the merchant
      SUPA_SVG, // not transformable
    ]);
    const first = root.querySelector<HTMLImageElement>("img.gq-option-img")!;
    expect(first.getAttribute("data-gq-orig")).toBe(SUPA_PNG);
    expect(root.querySelectorAll("img.gq-option-img")[2].hasAttribute("data-gq-orig")).toBe(false);
  });

  it("falls back to the original once when the resized image fails", async () => {
    const root = await bootPreview("q1");
    const img = root.querySelector<HTMLImageElement>("img.gq-option-img")!;
    let ownHandlerRan = false;
    img.addEventListener("error", () => {
      ownHandlerRan = true;
    });
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe(SUPA_PNG);
    expect(img.hasAttribute("data-gq-orig")).toBe(false);
    expect(ownHandlerRan).toBe(false);
    // The original failing too reaches the element's own handlers.
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe(SUPA_PNG);
    expect(ownHandlerRan).toBe(true);
  });

  it("leaves an image alone once something else replaced its src", async () => {
    const root = await bootPreview("q1");
    const img = root.querySelector<HTMLImageElement>("img.gq-option-img")!;
    img.src = "data:image/jpeg;base64,AAAA";
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });

  it("sizes result card product photos from protocol-relative product JSON", async () => {
    const root = await bootPreview("results");
    await wait(50);
    const srcs = Array.from(root.querySelectorAll<HTMLImageElement>("img")).map((i) => i.getAttribute("src") || "");
    expect(srcs).toContain("https://cdn.shopify.com/s/files/1/0001/products/hailey.jpg?v=9&width=900");
  });
});

describe("early config fetch (GLEAME_QUIZ_BOOT)", () => {
  it("reuses the block's in-flight requests on an exact url match", async () => {
    const { root, calls } = await bootStorefront({
      boot: {
        configUrl: CONFIG_URL,
        flowUrl: FLOW_URL,
        config: Promise.resolve(makeConfig()),
        flow: Promise.resolve(makeFlow()),
      },
    });
    expect(root.classList.contains("gq-active")).toBe(true);
    expect(calls.filter((u) => u.includes("quiz-config") || u.includes("recommendation-config"))).toEqual([]);
  });

  it("fetches itself when the block's url doesn't match", async () => {
    const { root, calls } = await bootStorefront({
      boot: {
        configUrl: CONFIG_URL.replace("tpl=3", "tpl=2"),
        flowUrl: FLOW_URL,
        config: Promise.resolve(null),
        flow: Promise.resolve(makeFlow()),
      },
    });
    expect(root.classList.contains("gq-active")).toBe(true);
    expect(calls).toContain(CONFIG_URL);
    expect(calls).not.toContain(FLOW_URL);
  });

  it("fetches both without a boot object (one-click Publish pages)", async () => {
    const { calls } = await bootStorefront({ boot: null });
    expect(calls).toContain(CONFIG_URL);
    expect(calls).toContain(FLOW_URL);
  });
});

describe("reserved height", () => {
  it("is released after the quiz renders", async () => {
    const { root } = await bootStorefront({ boot: null });
    expect(root.classList.contains("gq-active")).toBe(true);
    expect(root.style.minHeight).toBe("");
    expect(root.style.getPropertyValue("--gq-pad-top")).toBe("24px");
  });

  it("is released when the quiz is off and nothing renders", async () => {
    const { root } = await bootStorefront({ boot: null, config: makeConfig({ enabled: false }) });
    expect(root.classList.contains("gq-active")).toBe(false);
    expect(root.style.minHeight).toBe("");
  });
});
