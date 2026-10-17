// @vitest-environment jsdom
//
// Desktop fit for template question steps (gleame-quiz.js fitTplStep): when
// a step runs past the visible frame on desktop the widget steps through
// the gq-fit-1..3 compactness levels and lays the answer images out again
// (balanced columns, then a narrower answer block so images scale down
// whole) until it fits. jsdom has no layout, so the step's height is a
// model driven by what the widget sets: each level saves a fixed amount of
// text height, and image grids (Match tiles, Consult cards) take their
// height from their columns and width like a CSS grid would.

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
  label,
  axisValue,
  reasonText: null,
  imageUrl: null,
  showIf: null,
  selectAll: false,
  displayMeta: null,
  ...extra,
});
const question = (axisKey: string, prompt: string, options: unknown[], extra: Record<string, unknown> = {}) => ({
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
const many = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => opt("Answer " + (i + 1), "a" + i, extra(i)));
const images = (n: number) => many(n, (i) => ({ imageUrl: IMG + n + "-" + i + ".jpg" }));
const swatches = (n: number) => many(n, (i) => ({ displayMeta: { swatch: i % 2 ? "#aa3355" : "#33aa55" } }));

function makeFlow() {
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      question("text6", "Pick one", many(6)),
      question("img6", "Pick a shape", images(6)),
      question("img9", "Pick a look", images(9)),
      question("swatch9", "Pick a color", swatches(9)),
      question("img2", "Day or night?", images(2)),
      question("swatch12", "Pick your shades", swatches(12)),
      question("img8", "What needs a home?", images(8)),
    ],
  };
}

function makeConfig(template: string | null) {
  return {
    enabled: true,
    template,
    brandTokens: null,
    tryonEnabled: false,
    landing: { eyebrow: "Find my fit", headline: "Find your match", subtext: "", trustItems: [], founder: null, rating: null, benefitChips: [] },
    gate: { enabled: false },
    results: { showMatchesLabel: null, bundleEnabled: false },
    upsell: {},
    shadeGate: {},
    lead: { enabled: false },
    phases: [],
    theme: { heroImage: null },
    imageSlots: {},
  };
}

// ---- Viewport + layout model ----
let desktop = true;
let reduceMotion = true;
(window as any).matchMedia = (q: string) => ({
  matches: /prefers-reduced-motion/.test(q) ? reduceMotion : /min-width:\s*990px/.test(q) ? desktop : false,
  media: q,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});

const model = {
  base: 200, // text + chrome height of the step (px)
  saved: [0, 40, 100, 140], // cumulative text savings at gq-fit-1..3
  rootTop: 0, // quiz root top in the viewport (a theme header pushes it down)
};
const PAD = 24; // root padding above the stage
const WIDTH = 720; // step width
const GAP = 16; // grid gap
const LABEL = 30; // tile label under each image

function stepLevel(step: Element) {
  for (let l = 3; l >= 1; l--) if (step.classList.contains("gq-fit-" + l)) return l;
  return 0;
}

// A CSS grid of answer images: designed columns per template, overridden
// by the widget's --gq-fit-cols (on lists tagged gq-fit-cols); the answer
// block's max-width narrows every column; images keep their aspect ratio.
const fitCols = (list: HTMLElement) =>
  list.classList.contains("gq-fit-cols") ? parseInt(list.style.getPropertyValue("--gq-fit-cols"), 10) : 0;
function gridGeom(list: HTMLElement) {
  const n = list.children.length;
  const designed = list.classList.contains("gq-t2-cards") ? 2 : list.classList.contains("gq-t1-tiles--3") ? 3 : 4;
  const cols = fitCols(list) || designed;
  const maxW = parseFloat((list.parentElement as HTMLElement).style.maxWidth);
  const w = isNaN(maxW) ? WIDTH : Math.min(WIDTH, maxW);
  const sw = (w - (cols - 1) * GAP) / cols;
  const ratio = list.classList.contains("gq-t2-cards") ? 1.5 : 1;
  const rows = Math.ceil(n / cols);
  return { n, cols, w, sw, sh: sw / ratio, rows, height: rows * (sw / ratio + LABEL) + (rows - 1) * GAP };
}
const GRIDS = ".gq-t1-tiles, .gq-t2-cards";
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
const listOf = (el: HTMLElement) => el.closest(".gq-option-block")!.firstElementChild as HTMLElement;

// Theme header stand-ins: rects by id, hit-tested by elementsFromPoint.
const headerRects: Record<string, [number, number]> = {};

const proto = window.HTMLElement.prototype;
const nativeRect = proto.getBoundingClientRect;
const nativeProps = ["offsetHeight", "offsetWidth", "offsetTop"].map((p) => [p, Object.getOwnPropertyDescriptor(proto, p)] as const);
beforeAll(() => {
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const stageTop = model.rootTop + PAD;
    if (headerRects[this.id]) return rect(headerRects[this.id][0], headerRects[this.id][1], 1280);
    if (this.id === "gleame-quiz-root") return rect(model.rootTop, model.rootTop + 2000);
    if (this.classList.contains("gq-stage") || this.classList.contains("gq-tpl-step")) return rect(stageTop, stageTop + 2000);
    if (this.classList.contains("gq-tpl-body")) {
      const step = this.closest(".gq-tpl-step") as HTMLElement;
      return rect(stageTop + 80, stageTop + stepHeight(step));
    }
    if (this.matches(GRIDS)) return rect(0, 0, gridGeom(this).w);
    return nativeRect.call(this);
  };
  const slotSize = (el: HTMLElement, key: "sw" | "sh") =>
    el.classList.contains("gq-slot") && el.closest(GRIDS) ? gridGeom(listOf(el))[key] : 0;
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get() { return slotSize(this, "sw"); } });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get() { return slotSize(this, "sh"); } });
  Object.defineProperty(proto, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      const list = this.parentElement;
      if (!list || !list.matches(GRIDS)) return 0;
      const g = gridGeom(list);
      return Math.floor(Array.prototype.indexOf.call(list.children, this) / g.cols) * (g.sh + LABEL + GAP);
    },
  });
});

// ---- Boot (same harness as widget-templates.test.ts) ----
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
const GRID_CSS = "<style>.gq-t1-tiles, .gq-t2-cards { display: grid; }</style>";
async function boot(template: string | null, step: string, opts: { studio?: boolean; header?: string } = {}) {
  document.body.innerHTML = GRID_CSS + (opts.header || "") + '<div id="gleame-quiz-root" data-shop-domain="fit-shop.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = {
    config: makeConfig(template),
    flow: makeFlow(),
    sampleRecommend: { matches: [], matrixApplied: false, partial: false },
    productJson: {},
    studio: Boolean(opts.studio),
    overrides: { step },
  };
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
  for (let i = 0; i < 4; i++) await tick();
  return document.getElementById("gleame-quiz-root")!;
}
const currentStep = () => document.querySelector(".gq-stage > .gq-screen") as HTMLElement;
// A single-select pick advances after 220ms, the swap takes 160ms and the
// keep-in-view check runs 180ms after it.
const NAV = 700;
const fitClasses = (el: Element) => Array.from(el.classList).filter((c) => c.startsWith("gq-fit")).sort();
const fits = (step: HTMLElement, room = 720 - 16) => PAD + stepHeight(step) <= room;
const firstGrid = () => currentStep().querySelector<HTMLElement>(GRIDS)!;
const cols = () => gridGeom(firstGrid()).cols;
const slotH = () => gridGeom(firstGrid()).sh;
// Designed image height (the model's grid before the widget touches it).
const designedH = (list: HTMLElement) => {
  const clone = list.cloneNode(true) as HTMLElement;
  clone.classList.remove("gq-fit-cols");
  const holder = document.createElement("div");
  holder.appendChild(clone);
  return gridGeom(clone).sh;
};

beforeEach(() => {
  desktop = true;
  reduceMotion = true;
  Object.assign(model, { base: 200, saved: [0, 40, 100, 140], rootTop: 0 });
  (window as any).innerHeight = 720;
  (window as any).innerWidth = 1280;
  for (const k of Object.keys(headerRects)) delete headerRects[k];
});
afterEach(() => {
  delete (window as any).scrollBy;
  delete (document as any).elementsFromPoint;
  delete (document as any).fonts;
});

describe("desktop fit for template question steps", () => {
  it("leaves a step that fits exactly as designed", async () => {
    model.base = 600; // 24 + 600 <= 720 - 16
    await boot("t2", "q1");
    const step = currentStep();
    expect(step.classList.contains("gq-tpl-step")).toBe(true);
    expect(fitClasses(step)).toEqual([]);
  });

  it("steps through levels until a text step fits", async () => {
    // Over by 24 + 800 - 704 = 120: level 1 saves 40, level 2 saves 100
    // (not enough), level 3 saves 140.
    model.base = 800;
    await boot("t5", "q1");
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1", "gq-fit-2", "gq-fit-3"]);
    model.saved = [0, 40, 130, 160];
    await boot("t5", "q1");
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1", "gq-fit-2"]);
  });

  it("scales images down whole (no crop) when a small shrink fits", async () => {
    // Consult cards, 6 answers: 2 columns x 3 rows of 352 x 235 images.
    // With 960px of window, 3 rows of ~212px fit at level 1 (90%).
    (window as any).innerHeight = 960;
    await boot("t2", "q2");
    const step = currentStep();
    const block = firstGrid().parentElement!;
    expect(fitClasses(step)).toEqual(["gq-fit-1", "gq-fit-img"]);
    expect(cols()).toBe(2);
    expect(parseFloat(block.style.maxWidth)).toBeLessThan(WIDTH);
    expect(slotH()).toBeGreaterThan(0.85 * designedH(firstGrid()));
    expect(fits(step, 960 - 16)).toBe(true);
    // Tallest that fits: a few px of slack at most.
    expect(fits(step, 960 - 16 - 8)).toBe(false);
    // Nothing caps or crops the image itself.
    expect(step.style.getPropertyValue("--gq-fit-img")).toBe("");
    step.querySelectorAll<HTMLElement>(".gq-slot").forEach((s) => expect(s.style.maxHeight).toBe(""));
  });

  it("adds columns before shrinking images far", async () => {
    // At 720px, 2 columns would need 133px images (57%); 3 columns fit
    // at their natural 153px. Level 3's smaller text would let 2 columns
    // of 166px fit, under the 10% a denser text layout has to win by.
    await boot("t2", "q2");
    const step = currentStep();
    expect(fitClasses(step)).toEqual(["gq-fit-1", "gq-fit-img"]);
    expect(cols()).toBe(3);
    expect(firstGrid().parentElement!.style.maxWidth).toBe("");
    expect(fits(step)).toBe(true);
  });

  it("keeps rows balanced: 9 answers go 3 + 3 + 3 or 5 + 4, never 4 + 4 + 1", async () => {
    await boot("t1", "q3");
    expect(cols()).toBe(3); // 3 rows of 166px (level 3) beat 2 full rows of 131px
    expect(fits(currentStep())).toBe(true);
    (window as any).innerHeight = 600;
    await boot("t1", "q3");
    expect(cols()).toBe(5); // 3 rows would need 93px images: below the floor
    expect(fits(currentStep(), 600 - 16)).toBe(true);
    expect(slotH()).toBeGreaterThanOrEqual(110);
  });

  it("prefers a full-width grid unless a narrowed one has 10% taller images", async () => {
    // 8 Consult cards: 3 + 3 + 2 narrowed to ~118px images, or 4 + 4 at
    // their natural 112px across the full column. The full grid wins.
    (window as any).innerHeight = 676;
    model.saved = [0, 10, 20, 30];
    await boot("t2", "q7");
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1", "gq-fit-img"]);
    expect(cols()).toBe(4);
    expect(firstGrid().parentElement!.style.maxWidth).toBe("");
    expect(fits(currentStep(), 676 - 16)).toBe(true);
    // With more room the 3-column grid's images are 10%+ taller: it wins.
    (window as any).innerHeight = 760;
    window.dispatchEvent(new Event("resize"));
    await wait(160);
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1", "gq-fit-img"]);
    expect(cols()).toBe(3);
    expect(slotH()).toBeGreaterThan(112 * 1.1);
    expect(fits(currentStep(), 760 - 16)).toBe(true);
  });

  it("never makes images larger than designed", async () => {
    // 2 Match tiles in the 3-column grid (229px squares): a 2-column grid
    // would give 352px squares; it narrows instead and shrinks from 229px.
    model.base = 540;
    model.saved = [0, 10, 20, 30]; // levels barely help: images must give
    await boot("t1", "q5");
    const list = firstGrid();
    const h0 = designedH(list);
    expect(h0).toBeCloseTo(229.33, 1);
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1", "gq-fit-2", "gq-fit-3", "gq-fit-img"]);
    expect(cols()).toBe(2);
    expect(slotH()).toBeLessThan(h0);
    expect(slotH()).toBeGreaterThanOrEqual(110);
    expect(fits(currentStep())).toBe(true);
    // Room to spare: the tiles stop at their designed size.
    (window as any).innerHeight = 900;
    window.dispatchEvent(new Event("resize"));
    await wait(160);
    expect(fitClasses(currentStep())).toEqual([]);
  });

  it("uses the most compact layout with 110px images when nothing fits", async () => {
    model.base = 2000;
    await boot("t1", "q3");
    const step = currentStep();
    expect(fitClasses(step)).toEqual(["gq-fit-1", "gq-fit-2", "gq-fit-3", "gq-fit-img"]);
    expect(cols()).toBe(5);
    expect(Math.round(slotH())).toBe(110);
  });

  it("lets flat color swatches go below the image floor", async () => {
    model.base = 2000;
    await boot("t1", "q4");
    expect(currentStep().querySelectorAll(".gq-slot--swatch").length).toBe(9);
    expect(Math.round(slotH())).toBe(72);
  });

  it("never runs below 990px: mobile and tablet render as before", async () => {
    desktop = false;
    model.base = 2000;
    for (const t of ["t1", "t2", "t3", "t4", "t5"]) {
      await boot(t, "q2");
      const step = currentStep();
      expect(fitClasses(step), t).toEqual([]);
      step.querySelectorAll<HTMLElement>(".gq-option-block").forEach((b) => {
        expect(b.style.maxWidth, t).toBe("");
        expect(fitCols(b.firstElementChild as HTMLElement), t).toBe(0);
      });
    }
  });

  it("re-fits on resize, and clears the fit when the step fits again", async () => {
    model.base = 800;
    await boot("t5", "q1");
    const step = currentStep();
    expect(fitClasses(step).length).toBeGreaterThan(0);
    (window as any).innerHeight = 1200;
    window.dispatchEvent(new Event("resize"));
    await wait(160);
    expect(fitClasses(step)).toEqual([]);
    (window as any).innerHeight = 720;
    window.dispatchEvent(new Event("resize"));
    await wait(160);
    expect(fitClasses(step).length).toBeGreaterThan(0);
    desktop = false; // shrunk to a tablet width
    window.dispatchEvent(new Event("resize"));
    await wait(160);
    expect(fitClasses(step)).toEqual([]);
  });

  it("re-fits when theme web fonts finish loading", async () => {
    let onFonts: (() => void) | null = null;
    (document as any).fonts = {
      ready: new Promise(() => {}),
      addEventListener: (type: string, fn: () => void) => {
        if (type === "loadingdone") onFonts = fn;
      },
    };
    model.base = 600;
    await boot("t5", "q1");
    expect(fitClasses(currentStep())).toEqual([]);
    model.base = 700; // the swapped-in font sets taller text
    onFonts!();
    await wait(160);
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1"]);
  });

  it("tags template answer lists with their count bucket", async () => {
    await boot("t1", "q1");
    expect(document.querySelector(".gq-t1-rows")!.classList.contains("gq-tpl-n-m")).toBe(true);
    await boot("t1", "q3");
    const tiles = document.querySelector(".gq-t1-tiles")!;
    expect(tiles.classList.contains("gq-tpl-n-xl")).toBe(true);
    expect(tiles.classList.contains("gq-tpl-c4")).toBe(false); // 9: 5 + 4
    await boot("t3", "q6");
    expect(document.querySelector(".gq-t3-icons")!.classList.contains("gq-tpl-c4")).toBe(true); // 12: 4 + 4 + 4
    await boot("t2", "q5");
    expect(document.querySelector(".gq-t2-cards")!.classList.contains("gq-tpl-n-s")).toBe(true);
  });

  it("leaves the classic (non-template) quiz untouched", async () => {
    model.base = 2000;
    const root = await boot(null, "q2");
    expect(root.querySelector('[class*="gq-tpl-n-"]')).toBeNull();
    expect(root.querySelector('[class*="gq-fit-"]')).toBeNull();
    expect((currentStep() as any).gqFit).toBeUndefined();
  });

  it("keeps the Continue row clear of the Studio's Desktop/Mobile toggle", async () => {
    model.base = 650; // 24 + 650 fits 720 - 16, not 720 - 64
    await boot("t5", "q1");
    expect(fitClasses(currentStep())).toEqual([]);
    await boot("t5", "q1", { studio: true });
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1"]);
  });
});

describe("desktop fit under a theme header", () => {
  const STICKY = '<header id="hdr" style="position: sticky; top: 0px"></header>';
  const STATIC_BAR = '<div id="bar"></div>';
  function hitTest() {
    (document as any).elementsFromPoint = (_x: number, y: number) => {
      const hit = Object.keys(headerRects).find((id) => headerRects[id][0] <= y && y < headerRects[id][1]);
      const el = hit ? document.getElementById(hit) : null;
      return el ? [el, document.body, document.documentElement] : [document.body, document.documentElement];
    };
  }

  it("leaves a sticky header's height out of the fit budget", async () => {
    model.base = 600; // fits 720, not the 620 below a 100px sticky header
    headerRects.hdr = [0, 100];
    model.rootTop = 100;
    hitTest();
    await boot("t5", "q1", { header: STICKY });
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1"]);
    expect(fits(currentStep(), 720 - 100 - 16)).toBe(true);
  });

  it("finds a sticky header below a static announcement bar", async () => {
    model.base = 600;
    headerRects.bar = [0, 40];
    headerRects.hdr = [40, 140]; // not stuck yet: it rests at top 0 once scrolled
    model.rootTop = 140;
    hitTest();
    await boot("t5", "q1", { header: STATIC_BAR + STICKY });
    expect(fits(currentStep(), 720 - 100 - 16)).toBe(true);
    expect(fitClasses(currentStep()).length).toBeGreaterThan(0);
  });

  it("adds up stacked fixed bars (announcement + header)", async () => {
    model.base = 600; // fits below a 100px header, not below 140px of bars
    headerRects.bar = [0, 40];
    headerRects.hdr = [40, 140];
    model.rootTop = 140;
    hitTest();
    await boot("t5", "q1", {
      header: '<div id="bar" style="position: fixed; top: 0px"></div><header id="hdr" style="position: fixed; top: 40px"></header>',
    });
    expect(fitClasses(currentStep())).toEqual(["gq-fit-1", "gq-fit-2"]);
    expect(fits(currentStep(), 720 - 140 - 16)).toBe(true);
  });

  it("ignores a static header: the full window is the budget", async () => {
    model.base = 600;
    headerRects.bar = [0, 120];
    model.rootTop = 120;
    hitTest();
    await boot("t5", "q1", { header: STATIC_BAR });
    expect(fitClasses(currentStep())).toEqual([]);
  });

  it("never scrolls the quiz top under a sticky header after a step change", async () => {
    reduceMotion = false; // the keep-in-view timer only runs with motion
    model.base = 2000; // too long to fit: the Continue row is always below
    headerRects.hdr = [0, 100];
    model.rootTop = 100; // the quiz sits right under the header
    hitTest();
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("t2", "q1", { header: STICKY });
    await wait(NAV);
    (currentStep().querySelector(".gq-t2-row") as HTMLElement).click(); // single select: next screen
    await wait(NAV);
    expect(currentStep().querySelector(".gq-t2-cards")).not.toBeNull();
    expect(scrollBy).not.toHaveBeenCalled();
    // Further down the page, it scrolls no further than the header's edge.
    model.rootTop = 160;
    (currentStep().querySelector(".gq-t2-card") as HTMLElement).click();
    await wait(NAV);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0].top).toBe(60);
  });

  it("brings the quiz top out from under a sticky header", async () => {
    reduceMotion = false;
    model.base = 400;
    headerRects.hdr = [0, 100];
    model.rootTop = 30; // scrolled: Back and the progress bar sit under the header
    hitTest();
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("t2", "q1", { header: STICKY });
    await wait(NAV);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0].top).toBe(-70);
  });

  it("without a sticky header, scrolls just enough to show Continue, never past the quiz top", async () => {
    reduceMotion = false;
    model.base = 640; // fits the window: 24 + 640 <= 704
    model.rootTop = 120; // a static header above the quiz
    const scrollBy = vi.fn();
    (window as any).scrollBy = scrollBy;
    await boot("t2", "q1");
    await wait(NAV);
    expect(scrollBy).not.toHaveBeenCalled(); // first paint never scrolls
    (currentStep().querySelector(".gq-t2-row") as HTMLElement).click();
    await wait(NAV);
    // The image step now fits the window; its last row ends at
    // 120 + 24 + height and needs that minus 704.
    const need = 120 + PAD + stepHeight(currentStep()) - 704;
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0].top).toBe(Math.min(120, need));
  });
});

afterAll(() => {
  proto.getBoundingClientRect = nativeRect;
  for (const [p, d] of nativeProps) if (d) Object.defineProperty(proto, p, d);
});
