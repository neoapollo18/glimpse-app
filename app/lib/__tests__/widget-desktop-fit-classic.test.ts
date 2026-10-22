// @vitest-environment jsdom
//
// Desktop fit for the classic pool boutique steps (Glamnetic, card
// 2026-10-21 "don't scroll on desktop every time"): a question step whose
// Continue row would sit past the fold under the store's sticky header
// steps through the gq-fit levels and scales its photo answers down whole,
// and a step change brings the quiz top to just under the header instead
// of scrolling it under the header (the old jump to the page top). Same
// layout model as widget-desktop-fit.test.ts: jsdom has no layout, so the
// step's height is driven by what the widget sets.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const IMG = "https://cdn.example.com/img/";
const opt = (label: string, axisValue: string, extra: Record<string, unknown> = {}) => ({
  label, axisValue, reasonText: null, imageUrl: null, showIf: null, selectAll: false, displayMeta: null, ...extra,
});
const question = (axisKey: string, prompt: string, extra: Record<string, unknown>, options: unknown[]) => ({
  axisKey, axisLabel: axisKey, prompt, helperText: null, multiSelect: false, maxSelections: null,
  screenGroup: null, showIf: null, optionStyle: null, options, ...extra,
});

// Glamnetic's shape: vibe on the landing, then photo and swatch steps.
function makeFlow(pool: boolean) {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      question("vibe", "What's the vibe?", { optionStyle: "boxed" }, [
        opt("Clean Girl & Minimalist", "model_off_duty"),
        opt("Soft & Sweet", "soft_sweet"),
      ]),
      question("length", "How long do you like your nails?", { optionStyle: "visual", multiSelect: true }, [
        opt("Super Short", "super_short", { imageUrl: IMG + "ss.jpg" }),
        opt("Short", "short", { imageUrl: IMG + "s.jpg" }),
        opt("Medium", "medium", { imageUrl: IMG + "m.jpg" }),
      ]),
      question("style_tier", "Last one: how much drama?", { optionStyle: "visual", multiSelect: true }, [
        opt("Clean & classic", "clean", { imageUrl: IMG + "c.jpg" }),
        opt("A little extra", "extra", { imageUrl: IMG + "e.jpg" }),
        opt("Statement", "statement", { imageUrl: IMG + "st.jpg" }),
        opt("Full-on nail art", "art", { imageUrl: IMG + "a.jpg" }),
      ]),
    ],
    // The pool engine's branching block is what makes a shop "pool".
    ...(pool ? { branching: { threshold: 6, questions: {}, pool: { columns: [], rows: [] } } } : {}),
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    template: null,
    brandTokens: null,
    tryonEnabled: false,
    compactLayout: true,
    uiStyle: "boutique",
    landing: { eyebrow: null, headline: "Meet your perfect mani.", subtext: null, trustItems: [], beforeImageUrl: null, afterImageUrl: null, visualCaption: null, altAudienceLabel: null, altAudienceUrl: null, photoNote: null },
    gate: { enabled: false },
    results: { layout: "grid", bundleEnabled: false, crossSell: null },
    upsell: {},
    shadeGate: {},
    lead: { enabled: false },
    ...overrides,
  };
}

// ---- Viewport + layout model ----
let desktop = true;
let reduceMotion = true;
(window as any).matchMedia = (q: string) => ({
  matches: /prefers-reduced-motion/.test(q) ? reduceMotion : /min-width:\s*990px/.test(q) ? desktop : false,
  media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
});

const model = {
  base: 300, // text + chrome height of the step (px)
  saved: [0, 40, 70, 90], // cumulative savings at gq-fit-1..3
  rootTop: 0,
};
const PAD = 24; // root padding above the stage
const WIDTH = 960; // the boutique step column
const GAP = 12;
const TILE_PAD = 20; // card padding around the photo
const LABEL = 50; // name + line under the photo

function stepLevel(step: Element) {
  for (let l = 3; l >= 1; l--) if (step.classList.contains("gq-fit-" + l)) return l;
  return 0;
}
// A CSS grid of photo answers, one row (3 lengths, 4 styles); the answer
// block's max-width narrows every column; photos keep 4:3.
function gridGeom(list: HTMLElement) {
  const n = list.children.length;
  const cols = n;
  const maxW = parseFloat((list.parentElement as HTMLElement).style.maxWidth);
  const w = isNaN(maxW) ? WIDTH : Math.min(WIDTH, maxW);
  const tile = (w - (cols - 1) * GAP) / cols;
  const iw = tile - TILE_PAD;
  const ih = iw * 0.75;
  return { n, cols, w, iw, ih, height: ih + TILE_PAD + LABEL };
}
const GRIDS = ".gq-option-grid:not(.gq-option-grid--boxed)";
function stepHeight(step: HTMLElement) {
  let h = model.base - model.saved[stepLevel(step)];
  step.querySelectorAll<HTMLElement>(GRIDS).forEach((list) => {
    h += gridGeom(list).height;
  });
  return h;
}
function rect(top: number, bottom: number, width = 0) {
  return { top, bottom, left: 0, right: width, width, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
}
const headerRects: Record<string, [number, number]> = {};

const proto = window.HTMLElement.prototype;
const nativeRect = proto.getBoundingClientRect;
const nativeProps = ["offsetHeight", "offsetWidth", "offsetTop"].map((p) => [p, Object.getOwnPropertyDescriptor(proto, p)] as const);
const nativeScrollIntoView = (proto as any).scrollIntoView;
beforeAll(() => {
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const stageTop = model.rootTop + PAD;
    if (headerRects[this.id]) return rect(headerRects[this.id][0], headerRects[this.id][1], 1280);
    if (this.id === "gleame-quiz-root") return rect(model.rootTop, model.rootTop + 2000);
    if (this.classList.contains("gq-stage") || this.classList.contains("gq-step")) return rect(stageTop, stageTop + 2000);
    if (this.classList.contains("gq-cta-bar")) {
      const bottom = stageTop + stepHeight(this.closest(".gq-step") as HTMLElement);
      return rect(bottom - 48, bottom);
    }
    if (this.matches(GRIDS)) return rect(0, 0, gridGeom(this).w);
    return nativeRect.call(this);
  };
  const imgSize = (el: HTMLElement, key: "iw" | "ih") => {
    const list = el.classList.contains("gq-option-img") ? (el.closest(GRIDS) as HTMLElement | null) : null;
    return list ? gridGeom(list)[key] : 0;
  };
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get() { return imgSize(this, "iw"); } });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get() { return imgSize(this, "ih"); } });
  Object.defineProperty(proto, "offsetTop", { configurable: true, get() { return 0; } });
});
afterAll(() => {
  proto.getBoundingClientRect = nativeRect;
  for (const [p, d] of nativeProps) if (d) Object.defineProperty(proto, p, d);
  (proto as any).scrollIntoView = nativeScrollIntoView;
});

// ---- Boot (Studio-preview harness, as widget-desktop-fit.test.ts) ----
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
const GRID_CSS = "<style>.gq-option-grid { display: grid; }</style>";
async function boot(step: string, opts: { header?: string; pool?: boolean; config?: Record<string, unknown> } = {}) {
  document.body.innerHTML = GRID_CSS + (opts.header || "") + '<div id="gleame-quiz-root" data-shop-domain="glamrco.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = {
    config: makeConfig(opts.config),
    flow: makeFlow(opts.pool !== false),
    sampleRecommend: { matches: [], matrixApplied: false, partial: false },
    productJson: {},
    studio: false,
    overrides: { step },
  };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  return document.getElementById("gleame-quiz-root")!;
}
const currentStep = () => document.querySelector(".gq-stage > .gq-screen") as HTMLElement;
const fitClasses = (el: Element) => Array.from(el.classList).filter((c) => c.startsWith("gq-fit")).sort();
const fits = (step: HTMLElement, room: number) => PAD + stepHeight(step) <= room;
const firstGrid = () => currentStep().querySelector<HTMLElement>(GRIDS)!;
// The swap takes 160ms and the keep-in-view check runs 180ms after it.
const NAV = 500;

const STICKY = '<header id="hdr" style="position: sticky; top: 0px"></header>';
function hitTest() {
  (document as any).elementsFromPoint = (_x: number, y: number) => {
    const hit = Object.keys(headerRects).find((id) => headerRects[id][0] <= y && y < headerRects[id][1]);
    const el = hit ? document.getElementById(hit) : null;
    return el ? [el, document.body, document.documentElement] : [document.body, document.documentElement];
  };
}
async function continueStep() {
  const s = currentStep();
  (s.querySelector(".gq-option-block .gq-option") as HTMLElement).click();
  (s.querySelector(".gq-continue-btn") as HTMLElement).click();
  await wait(NAV);
}

beforeEach(() => {
  desktop = true;
  reduceMotion = true;
  Object.assign(model, { base: 300, saved: [0, 40, 70, 90], rootTop: 0 });
  (window as any).innerHeight = 720;
  (window as any).innerWidth = 1280;
  for (const k of Object.keys(headerRects)) delete headerRects[k];
  (proto as any).scrollIntoView = vi.fn();
});
afterEach(() => {
  delete (window as any).scrollBy;
  delete (document as any).elementsFromPoint;
});

describe("desktop fit for the classic pool boutique steps", () => {
  it("a step that fits is left as designed", async () => {
    model.base = 200;
    await boot("q2");
    expect(currentStep().classList.contains("gq-step")).toBe(true);
    expect(fitClasses(currentStep())).toEqual([]);
  });

  it("keeps Continue in the window under a 100px sticky header: rhythm first", async () => {
    // 24 + 300 + 287 = 611 > 720 - 100 - 16; level 1 saves 40.
    headerRects.hdr = [0, 100];
    model.rootTop = 100;
    hitTest();
    await boot("q2", { header: STICKY });
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1"]);
    expect(fits(currentStep(), 720 - 100 - 16)).toBe(true);
    // The photos keep their designed size.
    expect(firstGrid().parentElement!.style.maxWidth).toBe("");
  });

  it("scales the photo answers down whole when the levels are not enough", async () => {
    model.base = 420; // 24 + 330 + 287 at level 3 still runs over 604
    headerRects.hdr = [0, 100];
    model.rootTop = 100;
    hitTest();
    await boot("q2", { header: STICKY });
    const step = currentStep();
    expect(fitClasses(step)).toContain("gq-fit-img");
    expect(fits(step, 720 - 100 - 16)).toBe(true);
    const g = gridGeom(firstGrid());
    // The designed photo: the same grid without the fitted block width.
    const designed = gridGeom(document.createElement("div").appendChild(firstGrid().cloneNode(true)) as HTMLElement);
    expect(parseFloat(firstGrid().parentElement!.style.maxWidth)).toBeLessThan(WIDTH);
    expect(g.ih).toBeLessThan(designed.ih);
    expect(g.ih).toBeGreaterThanOrEqual(110);
    expect(g.iw / g.ih).toBeCloseTo(designed.iw / designed.ih, 5); // nothing cropped
    // Still one row: the designed columns never change.
    expect(firstGrid().classList.contains("gq-fit-cols")).toBe(false);
  });

  it("never runs below 990px: phones and tablets render as before", async () => {
    desktop = false;
    model.base = 2000;
    await boot("q2");
    expect(fitClasses(currentStep())).toEqual([]);
    expect(firstGrid().parentElement!.style.maxWidth).toBe("");
  });

  it("other classic quizzes are untouched (not on the pool engine, or not boutique)", async () => {
    model.base = 2000;
    await boot("q2", { pool: false });
    expect((currentStep() as any).gqFit).toBeUndefined();
    expect(fitClasses(currentStep())).toEqual([]);
    await boot("q2", { config: { uiStyle: null } });
    expect((currentStep() as any).gqFit).toBeUndefined();
    expect(fitClasses(currentStep())).toEqual([]);
  });
});

describe("step changes never tuck the quiz under the sticky header", () => {
  it("the shopper scrolled down to Continue: the next step starts just under the header", async () => {
    reduceMotion = false; // the keep-in-view timer only runs with motion
    headerRects.hdr = [0, 100];
    model.rootTop = 100;
    hitTest();
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("q2", { header: STICKY });
    await wait(NAV);
    model.rootTop = -180; // scrolled past the quiz top to reach Continue
    await continueStep();
    expect(currentStep().querySelector(".gq-question-title")!.textContent).toBe("Last one: how much drama?");
    // Before: root.scrollIntoView, which put the quiz top (Back, progress)
    // under the 100px header and the jump read as "back to the top".
    expect((proto as any).scrollIntoView).not.toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0].top).toBe(-280);
  });

  it("the quiz top already under the header (not past the window edge) is brought out too", async () => {
    reduceMotion = false;
    headerRects.hdr = [0, 100];
    model.rootTop = 100;
    hitTest();
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("q2", { header: STICKY });
    await wait(NAV);
    model.rootTop = 40;
    await continueStep();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0].top).toBe(-60);
  });

  it("below the header, it scrolls just enough to show Continue, never past the quiz top", async () => {
    reduceMotion = false;
    model.base = 520; // too tall for 720 even fitted, so Continue needs a scroll
    headerRects.bar = [0, 40];
    headerRects.hdr = [40, 140]; // rests at top 0 once scrolled
    model.rootTop = 188; // where the page opens: bar + header + section padding
    hitTest();
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("q2", { header: '<div id="bar"></div>' + STICKY });
    await wait(NAV);
    expect(scrollBy).not.toHaveBeenCalled(); // first paint never scrolls
    await continueStep();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    const need = 188 + PAD + stepHeight(currentStep()) + 16 - 720;
    expect(scrollBy.mock.calls[0][0].top).toBe(Math.min(188 - 100, need));
  });

  it("other classic quizzes keep the old keep-in-view scroll", async () => {
    reduceMotion = false;
    headerRects.hdr = [0, 100];
    model.rootTop = 100;
    hitTest();
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("q2", { header: STICKY, pool: false });
    await wait(NAV);
    model.rootTop = -180;
    await continueStep();
    expect((proto as any).scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
