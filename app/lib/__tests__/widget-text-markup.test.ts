// @vitest-environment jsdom
//
// Text & labels values are plain text. Whatever a merchant, the copilot
// or a translation stores, the widget must show it as text and never parse
// it as markup. Every registry key gets an HTML payload and every screen
// the preview can reach is checked for the injected element. Also pins the
// merchant link rule (only http(s) and site paths become an href). Same
// harness as widget-text-cta.test.ts: the widget runs verbatim in jsdom
// in Studio-preview mode (no network).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { UI_TEXT_ENTRIES } from "../quiz-ui-text";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const PAYLOAD = "<img src=x id=gqxss>";

// Column-backed entries reach the widget as config fields, not uiText.
const COLUMN_FIELDS: Record<string, [string, string]> = {
  quiz_show_matches_label: ["results", "showMatchesLabel"],
  quiz_gate_photo_label: ["gate", "photoLabel"],
  quiz_gate_skip_label: ["gate", "skipLabel"],
  quiz_best_match_pill: ["results", "bestMatchPill"],
  quiz_also_matched_label: ["results", "alsoMatchedLabel"],
  quiz_view_product_label: ["results", "viewProductLabel"],
  end_restart_label: ["results", "restartLabel"],
  quiz_add_button_template: ["results", "addButtonTemplate"],
  quiz_lead_button_label: ["lead", "buttonLabel"],
  quiz_lead_skip_label: ["lead", "skipLabel"],
};

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
const question = (axisKey: string, prompt: string, extra: Record<string, unknown>, options: unknown[]) => ({
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
  ...extra,
});

function makeFlow() {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      question("vibe", "What's the vibe?", { optionStyle: "boxed" }, [
        opt("Clean Girl Minimalism", "model_off_duty", { displayMeta: { sublabel: "quiet luxury" } }),
        opt("Soft & Sweet", "soft_sweet"),
        opt("Surprise me", "model_off_duty", { selectAll: true }),
      ]),
      question("length", "How long do you like your nails?", { optionStyle: "visual", multiSelect: true }, [
        opt("Short", "short", { imageUrl: IMG + "short.png" }),
        opt("Long", "long", { imageUrl: IMG + "long.png" }),
        opt("Open to anything", "short", { selectAll: true }),
      ]),
      question("shape", "Which shapes are you into?", { multiSelect: true, maxSelections: 2 }, [
        opt("Almond", "almond"),
        opt("Coffin", "coffin"),
        opt("Oval", "oval"),
      ]),
      question("color_family", "Any colors calling your name?", { optionStyle: "nails", multiSelect: true }, [
        opt("Nudes & neutrals", "nudes", { displayMeta: { swatch: "#F8E6E0", swatch2: "#D6A899" } }),
        opt("Bold & bright", "bold", { displayMeta: { swatch: "#FF7A59" } }),
      ]),
    ],
  };
}

function pj(handle: string, title: string, price: number) {
  return {
    id: 1,
    handle,
    title,
    price,
    available: true,
    featured_image: IMG + handle + ".jpg",
    images: [IMG + handle + ".jpg"],
    variants: [{ id: 900 + price, price, available: true, featured_image: null }],
  };
}
const PRODUCT_JSON = { "love-current": pj("love-current", "Love Current", 1799), hailey: pj("hailey", "Hailey", 1999) };
const SAMPLE = {
  matrixApplied: true,
  partial: false,
  matches: [
    { productId: "p1", productHandle: "love-current", productName: "Love Current", variantTitle: "Default Title", variantNumericId: null, quantity: 1, reasons: ["Short almond"] },
    { productId: "p2", productHandle: "hailey", productName: "Hailey", variantTitle: "Short / Almond", variantNumericId: null, quantity: 2, reasons: [] },
  ],
};

function makeConfig(overrides: Record<string, unknown> = {}, results: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: true,
    compactLayout: false,
    uiStyle: null,
    landing: {
      eyebrow: "Find Your Nail Match",
      headline: "Meet Your **Perfect** Mani.",
      subtext: "Five quick questions.",
      trustItems: ["Photo optional", "Vegan & cruelty-free"],
      beforeImageUrl: IMG + "before.jpg",
      afterImageUrl: IMG + "after.jpg",
      visualCaption: null,
      altAudienceLabel: null,
      altAudienceUrl: null,
      photoNote: "You'll add a pic at the end",
    },
    gate: { enabled: true, headline: "Want to see it on you?", helper: null, photoLabel: null, skipLabel: null, privacyNote: "Never stored." },
    results: {
      layout: null,
      headlineNoPhoto: "We found your fit",
      subtext: "{count} picks made for your answers.",
      bundleEnabled: true,
      bundleLabel: null,
      bundleSize: 2,
      bundleDiscount: { type: "percentage", value: 15, minQty: 2, note: null },
      crossSell: null,
      ...results,
    },
    upsell: { title: "See these on you", body: null, cta: "Try them on me" },
    shadeGate: {},
    lead: {
      enabled: true,
      collectPhone: true,
      headline: "Want us to send your matches?",
      body: null,
      buttonLabel: null,
      skipLabel: null,
      consentText: null,
      hasDiscount: true,
      discountCode: "QUIZ10",
      discountMessage: "You unlocked 10% off",
    },
    ...overrides,
  };
}

/** Every Text & labels key set to the payload, column-backed ones included. */
function withPayload(config: Record<string, any>) {
  const uiText: Record<string, string> = {};
  for (const e of UI_TEXT_ENTRIES) {
    if (e.column) {
      const [group, field] = COLUMN_FIELDS[e.key];
      config[group] = { ...(config[group] || {}), [field]: PAYLOAD };
    } else {
      uiText[e.key] = PAYLOAD;
    }
  }
  config.uiText = uiText;
  return config;
}

// Reduced motion makes swapScreen synchronous, so the sweep doesn't wait
// out a 160ms transition on every screen. Nothing else reads matchMedia.
(window as any).matchMedia = (q: string) => ({
  matches: /prefers-reduced-motion/.test(q),
  media: q,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});

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
async function boot(config: Record<string, unknown>, step: string, sample: unknown = SAMPLE) {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="glamrco.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = { config, flow: makeFlow(), sampleRecommend: sample, productJson: PRODUCT_JSON, studio: false, overrides: { step } };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  await wait(20);
  return document.getElementById("gleame-quiz-root")!;
}

function expectNoMarkup(where: string) {
  expect(document.getElementById("gqxss"), where).toBeNull();
  expect(document.querySelector('img[src="x"]'), where).toBeNull();
}

// Press what a shopper can press here (add and bundle buttons, the start
// button, lead submit with an empty field) so progress, error and
// next-screen labels render too.
async function pokeButtons(root: HTMLElement, where: string) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(
    "button.gq-add-btn, button.gq-gr-add, button.gq-bundle-btn, button.gq-xsell-add, form button[type=submit], .gq-lead button",
  ));
  for (const b of buttons.slice(0, 6)) {
    if (!b.isConnected || b.disabled) continue;
    b.click();
    await tick();
    await wait(30);
    expectNoMarkup(where + " after click");
  }
}

const STEPS = ["intro", "q1", "q2", "q3", "q4", "gate", "lead", "results"];
// Cases that boot the widget many times get room on a busy machine.
const SLOW = 30000;

const LAYOUTS: Array<[string, () => Record<string, unknown>]> = [
  ["classic", () => makeConfig()],
  ["classic grid", () => makeConfig({ emailPlacement: "after_results" }, { layout: "grid" })],
  ["compact", () => makeConfig({ compactLayout: true })],
  ["boutique", () => makeConfig({ uiStyle: "boutique" }, { layout: "grid" })],
  ["boutique, email under results", () => makeConfig({ uiStyle: "boutique", emailPlacement: "after_results" }, { layout: "grid" })],
  ...(["t1", "t2", "t3", "t4", "t5"] as const).map((t): [string, () => Record<string, unknown>] => [
    t,
    () => makeConfig({ template: t, emailPlacement: t === "t2" ? "hook_start" : null, theme: { heroImage: null }, imageSlots: {} }),
  ]),
];

describe("Text & labels payloads never render as markup", () => {
  it("every column-backed entry has a config field in this test", () => {
    const missing = UI_TEXT_ENTRIES.filter((e) => e.column && !COLUMN_FIELDS[e.key]).map((e) => e.key);
    expect(missing).toEqual([]);
  });

  for (const [name, make] of LAYOUTS) {
    it(name, async () => {
      for (const step of STEPS) {
        const root = await boot(withPayload(make()), step);
        expectNoMarkup(`${name} / ${step}`);
        await pokeButtons(root, `${name} / ${step}`);
      }
    }, SLOW);
  }

  it("the compact and boutique photo tags show the label as text", async () => {
    for (const style of [{ compactLayout: true }, { uiStyle: "boutique" }]) {
      const root = await boot(withPayload(makeConfig(style)), "intro");
      const tags = root.querySelectorAll(".gq-ba-tag");
      expect(tags.length).toBe(2);
      tags.forEach((t) => {
        expect(t.textContent).toBe(PAYLOAD);
        expect(t.children.length).toBe(0);
      });
    }
  }, SLOW);

  it("default photo tags are unchanged", async () => {
    const compact = await boot(makeConfig({ compactLayout: true }), "intro");
    expect(Array.from(compact.querySelectorAll(".gq-ba-tag")).map((t) => t.textContent)).toEqual(["Your photo", "Your try-on"]);
    const boutique = await boot(makeConfig({ uiStyle: "boutique" }), "intro");
    expect(Array.from(boutique.querySelectorAll(".gq-ba-tag")).map((t) => t.textContent)).toEqual(["Before", "Tried on"]);
    const amp = await boot(makeConfig({ compactLayout: true, uiText: { yourPhotoTag: "Before & after" } }), "intro");
    expect(amp.querySelector(".gq-ba-tag")!.textContent).toBe("Before & after");
  }, SLOW);
});

describe("Merchant links only use web urls", () => {
  const altLink = async (url: string, style: Record<string, unknown>) => {
    const config = makeConfig(style);
    (config.landing as Record<string, unknown>).altAudienceLabel = "Shopping for him?";
    (config.landing as Record<string, unknown>).altAudienceUrl = url;
    const root = await boot(config, "intro");
    return root.querySelector<HTMLAnchorElement>("a.gq-alt-audience-link");
  };

  it("https, http and site paths render as the link", async () => {
    for (const style of [{}, { compactLayout: true }]) {
      for (const url of ["https://brand.example/men", "http://brand.example/men", "/collections/men", "  /pages/him  "]) {
        const a = await altLink(url, style);
        expect(a, url).not.toBeNull();
        expect(a!.getAttribute("href")).toBe(url.trim());
      }
    }
  }, SLOW);

  it("javascript:, data: and other schemes never become an href", async () => {
    const rejected = [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "\tjavascript:alert(1)",
      "\u0001javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "mailto:x@example.com",
      "brand.example/men",
    ];
    for (const style of [{}, { compactLayout: true }]) {
      for (const url of rejected) {
        expect(await altLink(url, style), JSON.stringify(url)).toBeNull();
      }
    }
  }, SLOW);

  it("product links stay site paths even for a scheme-shaped handle", async () => {
    const odd = { ...SAMPLE, matches: [{ ...SAMPLE.matches[0], productHandle: "javascript:alert(1)" }, SAMPLE.matches[1]] };
    for (const results of [{}, { layout: "grid" }, { primaryCta: "view" }]) {
      const root = await boot(makeConfig({}, results), "results", odd);
      const hrefs = Array.from(root.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")!);
      expect(hrefs).toContain("/products/javascript%3Aalert(1)");
      for (const h of hrefs) expect(h.startsWith("/")).toBe(true);
    }
  }, SLOW);
});
