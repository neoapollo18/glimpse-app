// @vitest-environment jsdom
//
// Pool-engine (columnar) quiz in the storefront widget, Glamnetic v3:
// branching from recommendation-config's `branching` block (contract 3),
// the columnar results extras from quiz-recommend (contract 4) and the
// analytics they add (contract 5). The widget runs verbatim in jsdom; the
// pool is the Oct 17 Glamnetic export (416 eligible rows), so the brief's
// section 6 cases are checked against real counts.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deriveProduct, splitPool } from "../columnar/attributes";
import { buildBranching, fullVisibleBits, hardVisibleBits } from "../columnar/pipeline";
import { SHAPE_IDS } from "../columnar/spec";
import { glamneticSpec, loadGlamneticFlow, loadGlamneticPool } from "./fixtures/glamnetic-columnar";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

// [length, shape, finish] combination counts in the Oct 17 pool (brief IDs).
const POOL_COUNTS: Record<string, number> = {
  "medium|almond|chrome": 1, "medium|almond|glazed_pearl": 5, "medium|almond|glossy": 13, "medium|almond|velvet_cateye": 4,
  "medium|coffin|glazed_pearl": 6, "medium|coffin|glossy": 11, "medium|coffin|matte": 1, "medium|coffin|velvet_cateye": 5,
  "medium|oval|glazed_pearl": 3, "medium|oval|glossy": 8, "medium|oval|velvet_cateye": 7,
  "medium|square|chrome": 1, "medium|square|glazed_pearl": 2, "medium|square|glossy": 4,
  "short|almond|chrome": 14, "short|almond|glazed_pearl": 21, "short|almond|glossy": 96, "short|almond|matte": 4, "short|almond|velvet_cateye": 49,
  "short|oval|chrome": 3, "short|oval|glazed_pearl": 12, "short|oval|glossy": 30, "short|oval|matte": 1, "short|oval|velvet_cateye": 22,
  "short|round|glazed_pearl": 5, "short|round|glossy": 18, "short|round|velvet_cateye": 3,
  "short|squoval|chrome": 4, "short|squoval|glazed_pearl": 12, "short|squoval|glossy": 20, "short|squoval|velvet_cateye": 7,
  "super_short|super_short|chrome": 3, "super_short|super_short|glazed_pearl": 7, "super_short|super_short|glossy": 11, "super_short|super_short|velvet_cateye": 3,
};
const POOL_ROWS: string[][] = [];
for (const [combo, n] of Object.entries(POOL_COUNTS)) for (let i = 0; i < n; i++) POOL_ROWS.push(combo.split("|"));

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
  multiSelect: true,
  maxSelections: null,
  screenGroup: null,
  showIf: null,
  optionStyle: null,
  options,
  ...extra,
});

const SHAPES = ["almond", "coffin", "oval", "round", "squoval", "square"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// The v3 flow with the contract's axis keys and values.
function makeFlow(branching: Record<string, unknown> | null = { threshold: 6 }) {
  const flow: Record<string, unknown> = {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      question("vibe", "What's the vibe?", { multiSelect: false, optionStyle: "boxed" }, [
        opt("Clean Girl & Minimalist", "model_off_duty"),
        opt("Main Character Energy", "main_character"),
        opt("Surprise me", "model_off_duty", { selectAll: true }),
      ]),
      question("length", "How long do you like your nails?", { optionStyle: "visual" }, [
        opt("Super short", "super_short"),
        opt("Short", "short"),
        opt("Medium", "medium"),
      ]),
      question("shape", "Which shapes are you into?", { optionStyle: "visual" },
        SHAPES.map((s) => opt(cap(s), s)).concat([opt("Open to anything", "almond", { selectAll: true })])),
      question("color_family", "Any colors calling your name?", { optionStyle: "nails", maxSelections: 3 }, [
        opt("Nudes & neutrals", "nudes_neutrals", { displayMeta: { swatch: "#F8E6E0", swatch2: "#D6A899" } }),
        opt("Pinks & purples", "pinks_pastels", { displayMeta: { swatch: "#FBD8E3", swatch2: "#B48BD1" } }),
        opt("Surprise me", "nudes_neutrals", { selectAll: true }),
      ]),
      question("question_6", "What's your finish?", { optionStyle: "nails", maxSelections: 2 }, [
        opt("Classic Glossy", "option_1", { displayMeta: { texture: "glossy" } }),
        opt("Glazed & Pearlescent", "option_2", { displayMeta: { texture: "glazed" } }),
        opt("Velvet & Cateye", "option_3", { displayMeta: { texture: "velvet" } }),
        opt("Bold Chrome", "option_4", { displayMeta: { texture: "chrome" } }),
        opt("Matte", "option_5", { displayMeta: { texture: "matte" } }),
        opt("Surprise Me!", "option_6", { selectAll: true }),
      ]),
      question("style_tier", "Last one: how much drama?", { optionStyle: "visual", maxSelections: 2 }, [
        opt("Clean & classic", "clean"),
        opt("A little extra", "extra"),
        opt("Statement", "statement"),
        opt("Full-on nail art", "art"),
      ]),
    ],
  };
  if (branching) {
    flow.branching = {
      threshold: 6,
      ...branching,
      questions: {
        length: { column: "length", values: { super_short: "super_short", short: "short", medium: "medium" } },
        shape: { column: "shape", values: Object.fromEntries(SHAPES.map((s) => [s, s])) },
        question_6: { column: "finish", values: { option_1: "glossy", option_2: "glazed_pearl", option_3: "velvet_cateye", option_4: "chrome", option_5: "matte" } },
      },
      pool: { columns: ["length", "shape", "finish"], rows: POOL_ROWS },
    };
  }
  return flow;
}

function makeConfig(results: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: true,
    compactLayout: true,
    uiStyle: "boutique",
    landing: { eyebrow: "Find my match", headline: "Meet your **perfect** mani.", subtext: null, trustItems: [], beforeImageUrl: null, afterImageUrl: null, visualCaption: null, altAudienceLabel: null, altAudienceUrl: null, photoNote: null },
    gate: { enabled: false },
    results: {
      layout: "grid",
      headlineNoPhoto: "Six sets, picked for you.",
      subtext: "{count} picks made for your answers.",
      bestMatchPill: "Best match",
      alsoMatchedLabel: "Also matched for you",
      bundleEnabled: true,
      bundleSize: 3,
      bundleDiscount: { type: "percentage", value: 15, minQty: 2, note: null },
      crossSell: null,
      ...results,
    },
    upsell: { title: null, body: null, cta: null },
    shadeGate: {},
    lead: { enabled: false },
  };
}

const IMG = "https://cdn.example.com/";
function pj(handle: string, price: number) {
  return { id: 1, handle, title: handle, price, available: true, featured_image: IMG + handle + ".jpg", images: [IMG + handle + ".jpg"], variants: [{ id: 900 + price, price, available: true }] };
}
const match = (h: string, meta: Record<string, string> | null, why: string | null = null) => ({
  productId: "p-" + h, productHandle: h, productName: cap(h), variantTitle: "Default Title", variantNumericId: null, quantity: 1,
  reasons: why ? [why] : [], ...(meta ? { meta } : {}),
});
const META = { length: "Short", shape: "Almond", finish: "Cat eye" };
const SIX = ["moscow", "topaz", "velvet-chrome", "moonstone", "diamond", "tourmaline"].map((h, i) => match(h, META, i === 0 ? "Cat-eye chrome in your short almond." : "Shimmer in your almond."));
const ALSO = ["aurora", "boba", "caviar"].map((h) => match(h, { length: "Short", shape: "Oval", finish: "Glossy" }));
const PRODUCT_JSON: Record<string, unknown> = {};
for (const m of SIX.concat(ALSO)) PRODUCT_JSON[m.productHandle] = pj(m.productHandle, 1799);

const ANSWERS = { vibe: ["main_character"], length: ["short", "medium"], shape: ["almond", "oval"], color_family: ["pinks_pastels"], question_6: ["option_3"], style_tier: ["statement"] };
function columnar(kind: "normal" | "relaxed" | "fewer" | "none", over: Record<string, unknown> = {}) {
  const header = {
    normal: { kind: "normal", text: null },
    relaxed: { kind: "relaxed", text: "Here's what we have in short almond. A few step outside your color picks." },
    fewer: { kind: "fewer", text: "3 sets match exactly. Change an answer above to see more." },
    none: { kind: "none", text: "We don't have that combination yet." },
  }[kind];
  const matches = kind === "none" ? [] : kind === "fewer" ? SIX.slice(0, 3) : SIX;
  return {
    matrixApplied: true,
    partial: false,
    matches,
    columnar: {
      rung: kind === "normal" ? 1 : kind === "relaxed" ? 3 : 5,
      exactCount: kind === "none" ? 0 : kind === "fewer" ? 3 : 24,
      header,
      bestMatchBadge: kind === "normal",
      alsoMatched: kind === "normal" || kind === "relaxed" ? ALSO : [],
      resultKey: "c1.8.6.5.2.4.4",
      loosen: kind === "none" ? { axisKey: "question_6", label: "Show me any finish" } : null,
      answers: ANSWERS,
      ...over,
    },
  };
}

// ---- Harness ----

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

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/pages/find-my-match");
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  (window as any).Shopify = undefined;
  // Reduced motion: screens swap synchronously.
  (window as any).matchMedia = (q: string) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
});

async function settle() {
  for (let i = 0; i < 4; i++) await tick();
  await wait(30);
}

// Studio-preview boot (no network; recommendUrl answers with `recommend`).
async function bootPreview(opts: { flow?: unknown; config?: unknown; step?: string; recommend?: (body: any) => unknown; sample?: unknown } = {}) {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="glamrco.myshopify.com"></div>';
  const posts: any[] = [];
  (window as any).GLEAME_QUIZ_PREVIEW = {
    config: opts.config ?? makeConfig(),
    flow: opts.flow ?? makeFlow(),
    sampleRecommend: opts.sample ?? columnar("normal"),
    productJson: PRODUCT_JSON,
    studio: false,
    recommendUrl: "/preview-recommend",
    overrides: opts.step ? { step: opts.step } : undefined,
  };
  (window as any).fetch = vi.fn((url: string, init?: any) => {
    if (url === "/preview-recommend") {
      const body = JSON.parse(init.body);
      posts.push(body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve((opts.recommend ?? (() => columnar("normal")))(body)) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  evalWidget();
  await settle();
  return { root: document.getElementById("gleame-quiz-root")!, posts };
}

const screenEl = (root: HTMLElement) => root.querySelector(".gq-stage > .gq-screen") as HTMLElement;
function labels(root: HTMLElement) {
  return Array.from(screenEl(root).querySelectorAll(".gq-option-block button")).map((b) =>
    ((b.querySelector(".gq-option-visual-label") || b) as HTMLElement).textContent!.trim());
}
async function tap(root: HTMLElement, label: string) {
  const btn = Array.from(screenEl(root).querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    ((b.querySelector(".gq-option-visual-label") || b) as HTMLElement).textContent!.trim() === label);
  if (!btn) throw new Error(`no "${label}" in [${labels(root).join(", ")}]`);
  btn.click();
  await wait(btn.closest(".gq-ci-ask") ? 260 : 5);
  await settle();
}
async function next(root: HTMLElement) {
  (screenEl(root).querySelector(".gq-continue-btn") as HTMLButtonElement).click();
  await settle();
}
const title = (root: HTMLElement) => screenEl(root).querySelector(".gq-question-title")?.textContent;
const stepCount = (root: HTMLElement) => screenEl(root).querySelector(".gq-step-count")?.textContent;
/** Logic v6.1 progress (pool boutique): dots only, one per question
 * screen. "d" done, "c" current, "." to come. */
const dots = (root: HTMLElement) =>
  Array.from(screenEl(root).querySelectorAll(".gq-pips .gq-pip"))
    .map((e) => (e.classList.contains("gq-pip--done") ? "d" : e.classList.contains("gq-pip--current") ? "c" : "."))
    .join("");
const stepNote = (root: HTMLElement) => screenEl(root).querySelector(".gq-step-note")?.textContent ?? null;

async function toLength(root: HTMLElement) {
  await tap(root, "Main Character Energy");
  expect(title(root)).toBe("How long do you like your nails?");
}

describe("branching (contract 3) against the Oct 17 pool", () => {
  it("Super Short only: the shape step is skipped and says so (items 1-2), nothing recorded, dots never jump (item 5)", async () => {
    const { root, posts } = await bootPreview();
    await toLength(root);
    // Dots only: no "Step 2 of 6".
    expect(stepCount(root)).toBeUndefined();
    expect(dots(root)).toBe("dc....");
    await tap(root, "Super short");
    await next(root);
    expect(title(root)).toBe("Any colors calling your name?");
    expect(stepCount(root)).toBeUndefined();
    // Six dots still; the skipped Shape step reads as done.
    expect(dots(root)).toBe("dddc..");
    expect(stepNote(root)).toBe("Super short has one shape, so we skipped that step.");
    await tap(root, "Pinks & purples");
    await next(root);
    await tap(root, "Classic Glossy");
    await next(root);
    await tap(root, "Statement");
    await next(root);
    await wait(20);
    expect(posts[0].criteria.length).toEqual(["super_short"]);
    expect("shape" in posts[0].criteria).toBe(false);
  });

  it("Short only hides Coffin and Square; the six-shape tiles stay that size, centred", async () => {
    const { root } = await bootPreview();
    expect(root.classList.contains("gq-pool")).toBe(true);
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    expect(labels(root)).toEqual(["Almond", "Oval", "Round", "Squoval", "Open to anything"]);
    // gq-n-6 keeps the tile size; gq-grid-trimmed centres the four left
    // and gq-shown-4 lets phones sit them 2x2 instead of 3 + 1.
    expect(screenEl(root).querySelector(".gq-option-grid.gq-n-6.gq-grid-trimmed.gq-shown-4")).not.toBeNull();
  });

  it("a grid the pool doesn't trim stays a plain grid", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Short");
    await tap(root, "Medium");
    await next(root);
    expect(screenEl(root).querySelector(".gq-option-grid.gq-n-6")).not.toBeNull();
    expect(screenEl(root).querySelector(".gq-grid-trimmed")).toBeNull();
  });

  it("a trimmed finish grid keeps the six-swatch grid and centres", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Super short");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    expect(screenEl(root).querySelector(".gq-nail-grid.gq-n-6.gq-grid-trimmed")).not.toBeNull();
  });

  it("a finish grid trimmed to four tiles is tagged for the 2x2 layout", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    await tap(root, "Oval");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    expect(labels(root)).toEqual(["Classic Glossy", "Glazed & Pearlescent", "Velvet & Cateye", "Surprise Me!"]);
    expect(screenEl(root).querySelector(".gq-nail-grid.gq-n-6.gq-grid-trimmed.gq-shown-4")).not.toBeNull();
  });

  it("Medium only hides Round and Squoval (Square stays with 7)", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Medium");
    await next(root);
    expect(labels(root)).toEqual(["Almond", "Coffin", "Oval", "Square", "Open to anything"]);
  });

  it("Short + Medium is a union: all six shapes show", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Short");
    await tap(root, "Medium");
    await next(root);
    expect(labels(root)).toEqual(["Almond", "Coffin", "Oval", "Round", "Squoval", "Square", "Open to anything"]);
  });

  it("finish after Super Short: only Glossy and Glazed, plus Surprise me", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Super short");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    expect(title(root)).toBe("What's your finish?");
    expect(labels(root)).toEqual(["Classic Glossy", "Glazed & Pearlescent", "Surprise Me!"]);
    expect(dots(root)).toBe("ddddc.");
    // Only the step right after the skipped one carries the note.
    expect(stepNote(root)).toBeNull();
  });

  it("Short + Medium, Coffin: finish counts the union path (medium coffin)", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Short");
    await tap(root, "Medium");
    await next(root);
    await tap(root, "Coffin");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    expect(labels(root)).toEqual(["Classic Glossy", "Glazed & Pearlescent", "Surprise Me!"]);
  });

  it("one finish left (Short Round): the step shows it beside Surprise me, and nothing is picked for the shopper (item 6)", async () => {
    const { root, posts } = await bootPreview();
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    await tap(root, "Round");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    // v4 skipped this step and recorded Classic Glossy.
    expect(title(root)).toBe("What's your finish?");
    expect(labels(root)).toEqual(["Classic Glossy", "Surprise Me!"]);
    expect((screenEl(root).querySelector(".gq-continue-btn") as HTMLButtonElement).disabled).toBe(true);
    await tap(root, "Surprise Me!");
    await next(root);
    expect(title(root)).toBe("Last one: how much drama?");
    await tap(root, "Statement");
    await next(root);
    await wait(20);
    expect(posts[0].criteria.question_6).toEqual(["_any"]);
  });

  it("no finish left (Medium Square): skipped with no answer, so the engine filters nothing", async () => {
    const { root, posts } = await bootPreview();
    await toLength(root);
    await tap(root, "Medium");
    await next(root);
    await tap(root, "Square");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    expect(title(root)).toBe("Last one: how much drama?");
    await tap(root, "Statement");
    await next(root);
    await wait(20);
    expect(posts).toHaveLength(1);
    expect(posts[0].criteria.question_6).toBeUndefined();
    expect(posts[0].criteria.shape).toEqual(["square"]);
  });

  it("the threshold comes from the branching block", async () => {
    const { root } = await bootPreview({ flow: makeFlow({ threshold: 4 }) });
    await toLength(root);
    await tap(root, "Medium");
    await next(root);
    await tap(root, "Coffin");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    // Velvet (5) clears a threshold of 4; matte (1) still doesn't.
    expect(labels(root)).toEqual(["Classic Glossy", "Glazed & Pearlescent", "Velvet & Cateye", "Surprise Me!"]);
  });

  it("without a branching block nothing changes: every option, fixed counter, today's boutique", async () => {
    const flow = makeFlow(null) as { questions: Array<{ options: unknown[] }> };
    const vibe = flow.questions[0].options;
    vibe.splice(1, 0, vibe.pop()); // mid-list, as in live data
    const { root } = await bootPreview({ flow });
    // The v3 boutique rules (CSS scoped to .gq-pool, sparkles, Surprise
    // me last) wait for the shop's columnar spec.
    expect(root.classList.contains("gq-boutique")).toBe(true);
    expect(root.classList.contains("gq-pool")).toBe(false);
    expect(Array.from(root.querySelectorAll(".gq-option-visual-label")).map((e) => e.textContent)).toEqual([
      "Clean Girl & Minimalist", "Surprise me", "Main Character Energy",
    ]);
    expect(root.querySelector(".gq-option-sparkle")).toBeNull();
    await toLength(root);
    await tap(root, "Super short");
    await next(root);
    expect(title(root)).toBe("Which shapes are you into?");
    expect(stepCount(root)).toBe("Step 3 of 6");
    expect(labels(root)).toHaveLength(7);
    expect(screenEl(root).querySelector(".gq-option-sparkle, .gq-grid-trimmed")).toBeNull();
  });

  it("v3 boutique: Surprise me is the last vibe tile, with a sparkle", async () => {
    const flow = makeFlow() as { questions: Array<{ options: unknown[] }> };
    // Live data has it mid-list.
    const vibe = flow.questions[0].options;
    vibe.splice(1, 0, vibe.pop());
    const { root } = await bootPreview({ flow });
    const tiles = Array.from(root.querySelectorAll(".gq-option-visual-label"));
    expect(tiles.map((e) => e.textContent)).toEqual(["Clean Girl & Minimalist", "Main Character Energy", "Surprise me"]);
    expect(tiles[2].querySelector(".gq-option-sparkle")).not.toBeNull();
  });
});

describe("Back skips a skipped step", () => {
  it("Studio preview: Back from color returns to length, not the skipped shape step", async () => {
    const { root } = await bootPreview();
    await toLength(root);
    await tap(root, "Super short");
    await next(root);
    expect(title(root)).toBe("Any colors calling your name?");
    (screenEl(root).querySelector(".gq-back") as HTMLButtonElement).click();
    await settle();
    expect(title(root)).toBe("How long do you like your nails?");
    expect(dots(root)).toBe("dc....");
  });

  it("storefront: a history entry for a now-skipped step steps further back", async () => {
    const root = await bootStorefront();
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    await tap(root, "Almond");
    await next(root);
    expect(title(root)).toBe("Any colors calling your name?");
    // Edit length to Super Short from here: the shape entry (q3) stays
    // in history below color but its screen is now skipped.
    (screenEl(root).querySelector(".gq-back") as HTMLButtonElement).click();
    await wait(30);
    await settle();
    expect(title(root)).toBe("Which shapes are you into?");
    window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: { screen: "question", screenIndex: 1 } } }));
    await settle();
    expect(title(root)).toBe("How long do you like your nails?");
    await tap(root, "Short");
    await tap(root, "Super short");
    await next(root);
    expect(title(root)).toBe("Any colors calling your name?");
    // Popping a stale shape entry while going back lands on length.
    window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: { screen: "question", screenIndex: 2 } } }));
    await settle();
    expect(title(root)).toBe("How long do you like your nails?");
    expect(location.hash).toBe("#gq-q2");
  });
});

// ---- Storefront boot (routed fetch; events captured) ----

let events: Array<{ eventType: string; properties: Record<string, unknown> }> = [];
let recommendBodies: any[] = [];
let recommendReply: (body: any) => unknown = () => columnar("normal");
const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
async function bootStorefront(opts: { flow?: unknown; config?: unknown } = {}) {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="glamrco.myshopify.com"></div>';
  events = [];
  recommendBodies = [];
  (window as any).fetch = vi.fn((url: string, init?: any) => {
    if (url.includes("/api/storefront/quiz-config")) return json(opts.config ?? makeConfig());
    if (url.includes("/api/storefront/recommendation-config")) return json(opts.flow ?? makeFlow());
    if (url.includes("/api/storefront/quiz-recommend")) {
      const body = JSON.parse(init.body);
      recommendBodies.push(body);
      return json(recommendReply(body));
    }
    if (url.includes("/api/storefront/track-event")) {
      const b = JSON.parse(init.body);
      events.push({ eventType: b.eventType, properties: b.properties });
      return json({ success: true });
    }
    if (url.includes("/cart")) return json({ token: "c1", items: [] });
    const h = /\/products\/([^/.?]+)/.exec(url);
    if (h) return json(PRODUCT_JSON[h[1]] || pj(h[1], 1500));
    return json({});
  });
  evalWidget();
  for (let i = 0; i < 6; i++) await tick();
  await settle();
  return document.getElementById("gleame-quiz-root")!;
}

async function playToResults(root: HTMLElement) {
  await toLength(root);
  await tap(root, "Short");
  await next(root);
  await tap(root, "Round");
  await next(root);
  await tap(root, "Pinks & purples");
  await next(root);
  await tap(root, "Classic Glossy");
  await next(root);
  await tap(root, "Statement");
  await next(root);
  await wait(30);
  await settle();
}

describe("analytics (contract 5)", () => {
  beforeEach(() => {
    recommendReply = () => columnar("normal");
  });

  it("step events carry answer IDs; nothing fires as auto (v6.1 records no answer); results carry handles + rung", async () => {
    const root = await bootStorefront();
    await playToResults(root);
    const answered = events.filter((e) => e.eventType === "quiz_question_answered").map((e) => e.properties);
    const byQ = (q: string) => answered.find((p) => p.q === q)!;
    expect(byQ("length").ids).toEqual(["short"]);
    expect(byQ("shape").ids).toEqual(["round"]);
    expect(byQ("question_6")).toMatchObject({ vals: ["option_1"], ids: ["glossy"] });
    expect(answered.some((p) => p.auto)).toBe(false);
    // No pool mapping for color in the branching block: raw values only.
    expect(byQ("color_family").ids).toBeUndefined();
    const shown = events.find((e) => e.eventType === "quiz_results_shown")!.properties;
    expect(shown.handles).toEqual(SIX.map((m) => m.productHandle));
    expect(shown.rung).toBe(1);
    expect(recommendBodies[0].criteria.question_6).toEqual(["option_1"]);
  });

  it("other shops' events are unchanged (no ids, handles or rung)", async () => {
    recommendReply = () => ({ matrixApplied: true, partial: false, matches: SIX.map((m) => ({ ...m, meta: undefined })) });
    const root = await bootStorefront({ flow: makeFlow(null) });
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    const answered = events.filter((e) => e.eventType === "quiz_question_answered").map((e) => e.properties);
    expect(answered.every((p) => !("ids" in p) && !("auto" in p))).toBe(true);
  });
});

describe("columnar results (contract 4)", () => {
  it("normal: today's headline, Best Match badge, meta line, why line", async () => {
    const { root } = await bootPreview({ step: "results", sample: columnar("normal") });
    await wait(20);
    const res = root.querySelector(".gq-results--grid")!;
    expect(res.querySelector(".gq-results-headline")!.textContent).toBe("Six sets, picked for you.");
    expect(res.querySelector(".gq-results-headline--note")).toBeNull();
    expect(res.querySelector(".gq-results-subtext")!.textContent).toBe("6 picks made for your answers.");
    const pills = res.querySelectorAll(".gq-gr-grid .gq-gr-pill");
    expect(pills).toHaveLength(1);
    const first = res.querySelector(".gq-gr-grid .gq-gr-card")!;
    expect(first.querySelector(".gq-gr-pill")).not.toBeNull();
    // length · shape · finish; the third token is the one phones drop.
    const meta = first.querySelector(".gq-gr-meta")!;
    expect(meta.textContent).toBe("Short · Almond · Cat eye");
    expect(Array.from(meta.querySelectorAll(".gq-gr-meta-tok:not(.gq-gr-meta--extra)")).map((t) => t.textContent)).toEqual(["Short", "Almond"]);
    expect(meta.querySelectorAll(".gq-gr-meta--extra")).toHaveLength(2); // the finish and its separator
    expect(first.querySelector(".gq-gr-why")!.textContent).toBe("✓Cat-eye chrome in your short almond.");
  });

  it("relaxed and fewer: the header says so, no badge, no merchant subtext", async () => {
    for (const kind of ["relaxed", "fewer"] as const) {
      const sample = columnar(kind);
      const { root } = await bootPreview({ step: "results", sample });
      await wait(20);
      const h = root.querySelector(".gq-results-headline")!;
      expect(h.classList.contains("gq-results-headline--note")).toBe(true);
      expect(h.textContent).toBe(sample.columnar.header.text);
      expect(root.querySelector(".gq-results-subtext")).toBeNull();
      expect(root.querySelector(".gq-gr-pill")).toBeNull();
      expect(root.querySelectorAll(".gq-gr-grid .gq-gr-card")).toHaveLength(kind === "fewer" ? 3 : 6);
    }
  });

  it("no badge when the engine says so, even if the merchant's rules applied", async () => {
    const { root } = await bootPreview({ step: "results", sample: columnar("normal", { bestMatchBadge: false }) });
    await wait(20);
    expect(root.querySelector(".gq-gr-pill")).toBeNull();
  });

  // Card 2026-10-21 ("What is this 'Also matched for you' section?"): a
  // response that still carries Also matched sets (an older server, a
  // cached result) shows the six matches and nothing under them, in the
  // Studio preview and on the storefront.
  it("never renders an Also matched row, even when the response carries one", async () => {
    const sample = columnar("normal");
    expect(sample.columnar.alsoMatched).toHaveLength(3);
    const { root } = await bootPreview({ step: "results", sample });
    await wait(30);
    const noAlso = (r: HTMLElement) => {
      expect(r.querySelectorAll(".gq-gr-card")).toHaveLength(6);
      expect(r.querySelector(".gq-gr-also, .gq-gr-card--compact")).toBeNull();
      expect(r.textContent).not.toContain("Also matched");
      for (const h of ALSO) expect(r.innerHTML).not.toContain(h.productName);
    };
    noAlso(root);
    delete (window as any).GLEAME_QUIZ_PREVIEW;
    sessionStorage.clear();
    recommendReply = () => columnar("normal");
    const store = await bootStorefront();
    await playToResults(store);
    expect(store.querySelector(".gq-results--grid")).not.toBeNull();
    noAlso(store);
  });

  it("zero state: plain header, the loosen tap re-runs with that answer open", async () => {
    const replies = [columnar("none"), columnar("normal")];
    const { root, posts } = await bootPreview({ recommend: () => replies.shift() });
    await playPreview(root);
    const zero = root.querySelector(".gq-gr-zero")!;
    expect(zero).not.toBeNull();
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe("We don't have that combination yet.");
    expect(root.querySelector(".gq-gr-answers-edit")).not.toBeNull();
    const loosen = zero.querySelector<HTMLButtonElement>(".gq-gr-loosen")!;
    expect(loosen.textContent).toBe("Show me any finish");
    loosen.click();
    await wait(30);
    await settle();
    expect(posts).toHaveLength(2);
    expect(posts[1].criteria.question_6).toEqual(["_any"]);
    expect(root.querySelectorAll(".gq-gr-grid .gq-gr-card")).toHaveLength(6);
    // The answers line reads the loosened answer back.
    const answers = Array.from(root.querySelectorAll(".gq-gr-answers-value")).map((e) => e.textContent);
    expect(answers).toContain("Surprise Me!");
  });

  it("a loosened answer survives an edit back through the quiz", async () => {
    // Short + Round leaves one finish (glossy), the shopper taps it; the
    // zero state then loosens exactly that answer.
    const replies = [columnar("none"), columnar("normal"), columnar("normal")];
    const { root, posts } = await bootPreview({ recommend: () => replies.shift() });
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    await tap(root, "Round");
    await next(root);
    await tap(root, "Pinks & purples");
    await next(root);
    await tap(root, "Classic Glossy");
    await next(root);
    await tap(root, "Statement");
    await next(root);
    await wait(30);
    await settle();
    expect(posts[0].criteria.question_6).toEqual(["option_1"]);
    (root.querySelector(".gq-gr-loosen") as HTMLButtonElement).click();
    await wait(30);
    await settle();
    expect(posts[1].criteria.question_6).toEqual(["_any"]);
    // Edit the vibe: back to results, the finish still open.
    (root.querySelector(".gq-gr-answers-edit") as HTMLButtonElement).click();
    await settle();
    await tap(root, "Clean Girl & Minimalist");
    await wait(400);
    await settle();
    expect(posts).toHaveLength(3);
    expect(posts[2].criteria.vibe).toBe("model_off_duty");
    expect(posts[2].criteria.question_6).toEqual(["_any"]);
  });

  it("zero state without a loosen offers Edit and the retake only", async () => {
    const { root } = await bootPreview({ recommend: () => columnar("none", { loosen: null }) });
    await playPreview(root);
    expect(root.querySelector(".gq-gr-zero")).not.toBeNull();
    expect(root.querySelector(".gq-gr-loosen")).toBeNull();
    expect(root.querySelector(".gq-gr-zero-text")!.textContent).toBe("Change an answer above to see what we have.");
  });
});

// Logic v6.1 replies: every match carries its tier; the header says how
// many match everything.
function tiered(tiers: string[], header: Record<string, unknown>) {
  const base = columnar("normal");
  return {
    ...base,
    matches: SIX.slice(0, tiers.length).map((m, i) => ({ ...m, tier: tiers[i] })),
    columnar: { ...base.columnar, alsoMatched: [], bestMatchBadge: tiers[0] === "perfect", header },
  };
}

describe("logic v6.1 results (items 8-10, 12)", () => {
  const pills = (root: HTMLElement) =>
    Array.from(root.querySelectorAll(".gq-gr-grid .gq-gr-card")).map((c) => c.querySelector(".gq-gr-pill")?.textContent ?? null);

  it("every perfect match carries the badge; the closest picks carry none, all in one grid", async () => {
    const sample = tiered(["perfect", "perfect", "vibe", "drama", "color", "finish"], {
      kind: "relaxed",
      text: "2 perfect matches, plus our next-best picks",
      match: "some",
      perfect: 2,
    });
    const { root } = await bootPreview({ step: "results", sample });
    await wait(20);
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe("2 perfect matches, plus our next-best picks");
    expect(pills(root)).toEqual(["Perfect match", "Perfect match", null, null, null, null]);
    expect(root.querySelectorAll(".gq-gr-pill--perfect")).toHaveLength(2);
    // Trello 2026-10-23: no "Different x" labels, no heading splitting the grid.
    expect(root.textContent).not.toMatch(/Different|Next best picks/);
    const grid = root.querySelector(".gq-gr-grid")!;
    expect(Array.from(grid.children).every((c) => c.classList.contains("gq-gr-card"))).toBe(true);
    expect(grid.children).toHaveLength(6);
    // The merchant's "Best match" pill gives way to the per-card badges.
    expect(root.textContent).not.toContain("Best match");
  });

  it("the header matches the count: all six, some, none (Aaron's lines)", async () => {
    const all = tiered(Array(6).fill("perfect"), { kind: "normal", text: "x", match: "all", perfect: 6 });
    let { root } = await bootPreview({ step: "results", sample: all });
    await wait(20);
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe("Six sets that match everything you picked");
    const one = tiered(["perfect", "color", "color", "color", "color", "color"], { kind: "relaxed", text: "x", match: "some", perfect: 1 });
    ({ root } = await bootPreview({ step: "results", sample: one }));
    await wait(20);
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe("1 perfect match, plus our next-best picks");
    const none = tiered(["vibe", "vibe", "color", "color", "finish", "color_finish"], { kind: "relaxed", text: "x", match: "closest", perfect: 0 });
    ({ root } = await bootPreview({ step: "results", sample: none }));
    await wait(20);
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe("Nothing matches every pick yet, so here are the closest.");
    // No perfect match: no badge at all (and no Best match on the first).
    expect(pills(root)).toEqual([null, null, null, null, null, null]);
  });

  it("every new string comes from Text & labels", async () => {
    const config = makeConfig();
    (config as Record<string, unknown>).uiText = {
      poolHeaderSome: "{n} spot on, then close calls",
      perfectMatch: "Spot on",
    };
    const sample = tiered(["perfect", "perfect", "perfect", "color", "color", "color"], { kind: "relaxed", text: "x", match: "some", perfect: 3 });
    const { root } = await bootPreview({ step: "results", sample, config });
    await wait(20);
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe("3 spot on, then close calls");
    expect(pills(root)).toEqual(["Spot on", "Spot on", "Spot on", null, null, null]);
  });

  it("a reply from before v6.1 (no tiers) renders as it did: header text, Best match on the first card", async () => {
    const { root } = await bootPreview({ step: "results", sample: columnar("relaxed") });
    await wait(20);
    expect(root.querySelector(".gq-results-headline")!.textContent).toBe(columnar("relaxed").columnar.header.text);
    expect(root.querySelector(".gq-gr-pill--perfect")).toBeNull();
  });

  it("the landing shows dots for the six steps, not 1 of 6 (item 5)", async () => {
    const { root } = await bootPreview();
    const head = root.querySelector(".gq-ci-ask-head")!;
    expect(head.querySelector(".gq-ci-count")).toBeNull();
    expect(head.querySelectorAll(".gq-pip")).toHaveLength(6);
    expect(head.querySelectorAll(".gq-pip--current")).toHaveLength(1);
    // Every other boutique quiz keeps its counter.
    const plain = await bootPreview({ flow: makeFlow(null) });
    expect(plain.root.querySelector(".gq-ci-count")!.textContent).toBe("1 of 6");
  });
});

async function playPreview(root: HTMLElement) {
  await toLength(root);
  await tap(root, "Short");
  await next(root);
  await tap(root, "Almond");
  await next(root);
  await tap(root, "Pinks & purples");
  await next(root);
  await tap(root, "Classic Glossy");
  await next(root);
  await tap(root, "Statement");
  await next(root);
  await wait(30);
  await settle();
}

describe("results permalink (contract 4)", () => {
  beforeEach(() => {
    recommendReply = () => columnar("normal");
  });

  it("results set ?r=<resultKey> in place, keeping other params", async () => {
    history.replaceState(null, "", "/pages/find-my-match?utm_source=ig");
    const root = await bootStorefront();
    await playToResults(root);
    expect(root.querySelector(".gq-results--grid")).not.toBeNull();
    expect(location.search).toBe("?utm_source=ig&r=c1.8.6.5.2.4.4");
    expect(location.hash).toBe("#gq-results");
  });

  it("?r= boots straight into those results with the answers restored", async () => {
    history.replaceState(null, "", "/pages/find-my-match?r=c1.8.6.5.2.4.4");
    const root = await bootStorefront();
    await wait(20);
    await settle();
    expect(recommendBodies).toHaveLength(1);
    // No criteria: the key names the result. The analytics context rides
    // along like any quiz run (the engine ignores it for a key lookup).
    expect(recommendBodies[0]).toMatchObject({ shopDomain: "glamrco.myshopify.com", resultKey: "c1.8.6.5.2.4.4", deviceType: "desktop" });
    expect(recommendBodies[0].criteria).toBeUndefined();
    expect(root.querySelectorAll(".gq-gr-grid .gq-gr-card")).toHaveLength(6);
    const answers = Array.from(root.querySelectorAll(".gq-gr-answers-value")).map((e) => e.textContent);
    expect(answers).toEqual(["Main Character Energy", "Short, Medium", "Almond, Oval", "Pinks & purples", "Velvet & Cateye", "Statement"]);
    // Opening a link is not a finished quiz: no results event for Analytics
    // or the ad pixels.
    expect(events.find((e) => e.eventType === "quiz_results_shown")).toBeUndefined();
    // Edit reopens the quiz on the restored answers.
    (root.querySelector(".gq-gr-answers-edit") as HTMLButtonElement).click();
    await settle();
    expect(title(root)).toBe("What's the vibe?");
    expect(screenEl(root).querySelector(".is-selected .gq-option-visual-label")!.textContent).toBe("Main Character Energy");
  });

  // What the engine actually sends for a key it can't decode (or one the
  // route drops): a full result for "no answers" under the empty key.
  const engineNoAnswers = () => columnar("normal", { resultKey: "c1.x.x.x.x.x.x", answers: {} });

  it("a dead or foreign ?r= (the engine's no-answers reply) keeps the quiz and the param", async () => {
    for (const r of ["garbage123", "affiliate42"]) {
      sessionStorage.clear();
      history.replaceState(null, "", `/pages/find-my-match?utm_source=ig&r=${r}`);
      recommendReply = engineNoAnswers;
      const root = await bootStorefront();
      await wait(20);
      await settle();
      expect(recommendBodies).toHaveLength(1);
      expect(root.querySelector(".gq-intro")).not.toBeNull();
      expect(root.querySelector(".gq-results")).toBeNull();
      expect(location.search).toBe(`?utm_source=ig&r=${r}`);
      expect(events.some((e) => e.eventType === "quiz_results_shown")).toBe(false);
      // This tab doesn't ask about it again.
      await bootStorefront();
      expect(recommendBodies).toHaveLength(0);
    }
  });

  it("a key echoed back with no answers is dead too", async () => {
    history.replaceState(null, "", "/pages/find-my-match?r=c1.x.x.x.x.x.x");
    recommendReply = engineNoAnswers;
    const root = await bootStorefront();
    await wait(20);
    await settle();
    expect(recommendBodies).toHaveLength(1);
    expect(root.querySelector(".gq-intro")).not.toBeNull();
    expect(root.querySelector(".gq-gr-pill")).toBeNull();
  });

  it("an error reply falls back the same way", async () => {
    history.replaceState(null, "", "/pages/find-my-match?r=c1.8.6.5.2.4.4");
    recommendReply = () => ({ error: "Internal server error" });
    const root = await bootStorefront();
    await wait(20);
    await settle();
    expect(root.querySelector(".gq-intro")).not.toBeNull();
    expect(location.search).toBe("?r=c1.8.6.5.2.4.4");
  });

  it("a dead ?r= leaves a shopper's quiz in progress where it was", async () => {
    let root = await bootStorefront();
    await toLength(root);
    await tap(root, "Short");
    await next(root);
    await tap(root, "Almond");
    await next(root);
    expect(title(root)).toBe("Any colors calling your name?");
    history.replaceState(history.state, "", "/pages/find-my-match?r=garbage123" + location.hash);
    recommendReply = engineNoAnswers;
    root = await bootStorefront();
    await wait(20);
    await settle();
    expect(recommendBodies).toHaveLength(1);
    expect(title(root)).toBe("Any colors calling your name?");
    expect(dots(root)).toBe("dddc..");
  });

  it("reloading your own results link re-renders from the session; Start over drops only that r", async () => {
    history.replaceState(null, "", "/pages/find-my-match?utm_source=ig");
    let root = await bootStorefront();
    await playToResults(root);
    expect(location.search).toBe("?utm_source=ig&r=c1.8.6.5.2.4.4");
    root = await bootStorefront();
    await wait(20);
    expect(recommendBodies).toHaveLength(0);
    expect(root.querySelectorAll(".gq-gr-grid .gq-gr-card")).toHaveLength(6);
    (root.querySelector(".gq-gr-restart .gq-link-btn") as HTMLButtonElement).click();
    await settle();
    expect(location.search).toBe("?utm_source=ig");
  });

  it("shops without the pool engine ignore ?r=", async () => {
    history.replaceState(null, "", "/pages/find-my-match?r=whatever");
    const root = await bootStorefront({ flow: makeFlow(null) });
    expect(recommendBodies).toHaveLength(0);
    expect(root.querySelector(".gq-intro")).not.toBeNull();
    expect(location.search).toBe("?r=whatever");
  });
});

describe("finish swatches", () => {
  it("draws glossy, glazed, velvet, chrome and matte nails", async () => {
    const { root } = await bootPreview({ flow: makeFlow(null), step: "q5" });
    const nails = Array.from(root.querySelectorAll(".gq-nail-grid .gq-nail")).map((n) => n.className);
    expect(nails).toEqual(["gq-nail gq-nail--glossy", "gq-nail gq-nail--glazed", "gq-nail gq-nail--velvet", "gq-nail gq-nail--chrome", "gq-nail gq-nail--matte", "gq-nail gq-nail--any"]);
  });
});

// ---- Full-match branching (fix spec v4): the live questions and the real
// pool, the block built by the server's own buildBranching ----

const fixtureFlow = loadGlamneticFlow();
const v4Spec = glamneticSpec();
const v4Eligible = splitPool(loadGlamneticPool().map((p) => deriveProduct(p, { holidayCollections: v4Spec.holidayCollections }))).eligible;
const v4Block = buildBranching(v4Spec, v4Eligible, fixtureFlow);
const v4Full = v4Block.full!;

function liveFlow(): Record<string, unknown> {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: fixtureFlow.map((q) =>
      question(
        q.axisKey,
        q.prompt ?? q.axisKey,
        { multiSelect: q.multiSelect, maxSelections: q.maxSelections, optionStyle: q.axisKey === "vibe" ? "boxed" : "visual" },
        q.options.map((o) => opt(o.label, o.axisValue, { selectAll: o.selectAll })),
      ),
    ),
    branching: JSON.parse(JSON.stringify(v4Block)),
  };
}

/** The widget's own fullVisibleBits, lifted out verbatim. */
function widgetFullVisibleBits(): (f: unknown, qi: number, answers: number[]) => number[] {
  const m = /\/\/ <gleame-full-branching>[^\n]*\n(?:\s*\/\/[^\n]*\n)*([\s\S]*?)\n\s*\/\/ <\/gleame-full-branching>/.exec(source);
  if (!m) throw new Error("gleame-full-branching markers not found");
  return new Function(`${m[1]}\nreturn fullVisibleBits;`)();
}

/** The widget's own hardVisibleBits (logic v6.1), lifted out verbatim. */
function widgetHardVisibleBits(): (f: unknown, qi: number, answers: number[]) => number[] {
  const m = /\/\/ <gleame-hard-branching>[^\n]*\n(?:\s*\/\/[^\n]*\n)*([\s\S]*?)\n\s*\/\/ <\/gleame-hard-branching>/.exec(source);
  if (!m) throw new Error("gleame-hard-branching markers not found");
  return new Function(`${m[1]}\nreturn hardVisibleBits;`)();
}

describe("full-match branching (fix spec v4): the rules a widget before v6.1 runs", () => {
  it("the widget's check matches the server's on every prefix of 600 random walks", () => {
    const widget = widgetFullVisibleBits();
    const max = fixtureFlow.map((q) => (q.multiSelect ? q.maxSelections ?? 9 : 1));
    let seed = 11;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let compared = 0;
    for (let walk = 0; walk < 600; walk++) {
      const masks: number[] = [];
      for (let qi = 0; qi < v4Full.questions.length; qi++) {
        const server = fullVisibleBits(v4Full, qi, masks);
        expect(widget(JSON.parse(JSON.stringify(v4Full)), qi, masks), `${qi}: ${masks.join(",")}`).toEqual(server);
        compared++;
        let mask = 0;
        if (server.length === 1) mask = 1 << server[0];
        else if (server.length > 1) {
          for (const b of server.filter(() => r() < 0.4).slice(0, max[qi])) mask |= 1 << b;
          if (!mask && !v4Full.questions[qi].any) mask = 1 << server[0];
        }
        masks.push(mask);
      }
    }
    expect(compared).toBe(600 * 6);
  });

  it("served without the v6.1 rules (an app not yet deployed), the new widget runs v4's but never picks for the shopper", async () => {
    const flow = liveFlow();
    delete ((flow.branching as { full: Record<string, unknown> }).full).hard;
    recommendReply = () => columnar("normal");
    const root = await bootStorefront({ flow });
    // v4 left Holiday + Medium one shape (Aaron: Oval) and recorded it.
    const holiday = 1 << v4Full.questions[0].values.option_8;
    const medium = 1 << v4Full.questions[1].values.medium;
    const v4Shapes = fullVisibleBits(v4Full, 2, [holiday, medium]);
    expect(v4Shapes).toHaveLength(1);
    await tap(root, "Holiday-Ready");
    await tap(root, "Medium");
    await next(root);
    // The step shows that shape beside Open to anything for the shopper to tap.
    expect(title(root)).toBe("Which shapes are you into?");
    const shape = fixtureFlow[2].options.find((o) => !o.selectAll && v4Full.questions[2].values[o.axisValue] === v4Shapes[0])!.label;
    expect(labels(root)).toEqual([shape, "Open to anything"]);
  });
});

describe("logic v6.1 branching in the widget (items 1-6)", () => {
  it("the widget's check matches the server's on every prefix of 600 random walks", () => {
    const widget = widgetHardVisibleBits();
    const max = fixtureFlow.map((q) => (q.multiSelect ? q.maxSelections ?? 9 : 1));
    let seed = 23;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let compared = 0;
    for (let walk = 0; walk < 600; walk++) {
      const masks: number[] = [];
      for (let qi = 0; qi < v4Full.questions.length; qi++) {
        const server = hardVisibleBits(v4Full, qi, masks);
        expect(widget(JSON.parse(JSON.stringify(v4Full)), qi, masks), `${qi}: ${masks.join(",")}`).toEqual(server);
        compared++;
        let mask = 0;
        for (const b of server.filter(() => r() < 0.4).slice(0, max[qi])) mask |= 1 << b;
        if (!mask && server.length && !v4Full.questions[qi].any) mask = 1 << server[0];
        masks.push(mask);
      }
    }
    expect(compared).toBe(600 * 6);
  });

  it("...and on every single-pick prefix", () => {
    const widget = widgetHardVisibleBits();
    let compared = 0;
    const walk = (qi: number, masks: number[]) => {
      if (qi === v4Full.questions.length) return;
      const server = hardVisibleBits(v4Full, qi, masks);
      expect(widget(v4Full, qi, masks), `${qi}: ${masks.join(",")}`).toEqual(server);
      compared++;
      const choices = server.length ? server.map((b) => 1 << b) : [0];
      if (server.length && v4Full.questions[qi].any) choices.push(0);
      // Past the color step the tree is wide: follow the first two choices.
      for (const m of qi >= 3 ? choices.slice(0, 2) : choices) walk(qi + 1, [...masks, m]);
    };
    walk(0, []);
    expect(compared).toBeGreaterThan(500);
  });

  // Plays the live quiz from the vibe step, checking each screen against
  // the server's check: picks[qi] names the option to tap, else the first.
  async function playChecked(root: HTMLElement, picks: Record<number, string>) {
    const nameOf = (qi: number, bit: number) =>
      fixtureFlow[qi].options.find((o) => !o.selectAll && v4Full.questions[qi].values[o.axisValue] === bit)!.label;
    const masks: number[] = [];
    const screens: string[] = [];
    for (let qi = 0; qi < v4Full.questions.length; qi++) {
      const vis = hardVisibleBits(v4Full, qi, masks);
      if (vis.length === 0) {
        // Skipped, nothing recorded.
        masks.push(0);
        continue;
      }
      const any = fixtureFlow[qi].options.filter((o) => o.selectAll).map((o) => o.label);
      if (qi > 0) expect(title(root)).toBe(fixtureFlow[qi].prompt);
      const shown = qi > 0 ? labels(root) : Array.from(root.querySelectorAll(".gq-option-visual-label")).map((e) => e.textContent!.trim());
      expect(shown.sort(), fixtureFlow[qi].axisKey).toEqual([...vis.map((b) => nameOf(qi, b)), ...any].sort());
      screens.push(fixtureFlow[qi].axisKey);
      const label = picks[qi] ?? nameOf(qi, vis[0]);
      const bit = v4Full.questions[qi].values[fixtureFlow[qi].options.find((o) => o.label === label && !o.selectAll)!.axisValue];
      await tap(root, label);
      // The vibe tiles advance on their own.
      if (qi > 0) await next(root);
      masks.push(1 << bit);
    }
    await wait(30);
    await settle();
    return { masks, screens };
  }

  it("Lisa's Alt & Edgy + Super Short: every step but Shape asks, with every color (v4 skipped four of six)", async () => {
    recommendReply = () => columnar("normal");
    const root = await bootStorefront({ flow: liveFlow() });
    const alt = 1 << v4Full.questions[0].values.option_7;
    const ss = 1 << v4Full.questions[1].values.super_short;
    expect(hardVisibleBits(v4Full, 3, [alt, ss, 0])).toHaveLength(8);
    const { screens } = await playChecked(root, { 0: "Alternative & Edgy", 1: "Super Short", 3: "Pinks & purples" });
    expect(screens).toEqual(["vibe", "length", "color_family", "question_6", "style_tier"]);
    expect(recommendBodies).toHaveLength(1);
    expect(recommendBodies[0].criteria).toMatchObject({ vibe: "option_7", length: ["super_short"], color_family: ["pinks_pastels"] });
    expect("shape" in recommendBodies[0].criteria).toBe(false);
  });

  it("every screen shows exactly the options the server keeps, three or more after Length (Clean Girl, Short, Nudes, Glossy: v4 skipped Drama)", async () => {
    recommendReply = () => columnar("normal");
    const root = await bootStorefront({ flow: liveFlow() });
    const { screens } = await playChecked(root, { 0: "Clean Girl & Minimalist", 1: "Short", 3: "Nudes & neutrals", 4: "Classic Glossy" });
    expect(screens).toEqual(["vibe", "length", "shape", "color_family", "question_6", "style_tier"]);
    expect(recommendBodies[0].criteria.style_tier).toBeDefined();
  });

  it("Holiday + Medium: four shapes to choose from, so Oval is the shopper's tap (v4 recorded it, item 6)", async () => {
    const root = await bootStorefront({ flow: liveFlow() });
    await tap(root, "Holiday-Ready");
    await tap(root, "Medium");
    await next(root);
    expect(title(root)).toBe("Which shapes are you into?");
    expect(labels(root)).toEqual(["Almond", "Oval", "Square", "Coffin", "Open to anything"]);
    // No Round or Squoval: Medium has none (item 4).
    expect(labels(root)).not.toContain("Round");
  });
});

describe("store preview token (fix spec v4, item 6)", () => {
  it("quiz-recommend gets the signed preview token, not just the flag", async () => {
    (window as any).GLEAME_QUIZ_STORE_PREVIEW = { token: "signed.jwt.token", id: "live" };
    try {
      const root = await bootStorefront();
      await playToResults(root);
      expect(recommendBodies[0]).toMatchObject({ storePreview: true, previewToken: "signed.jwt.token", previewId: "live" });
    } finally {
      delete (window as any).GLEAME_QUIZ_STORE_PREVIEW;
    }
  });

  it("a shopper's request carries no token", async () => {
    const root = await bootStorefront();
    await playToResults(root);
    expect(recommendBodies[0].previewToken).toBeUndefined();
    expect(recommendBodies[0].storePreview).toBeUndefined();
  });
});
