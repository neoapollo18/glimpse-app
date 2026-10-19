// @vitest-environment jsdom
//
// Routine (t3) name capture, "To start, who is the routine for?"
// (2026-10-19 App Review: "The Continue button isn't working; we can only
// get to the quiz by hitting Skip"). The Continue CTA came from tplCta,
// which makes type="button", so clicking it never submitted the name form;
// only Enter in the field (implicit submission) advanced. These boot the
// LIVE storefront path (no GLEAME_QUIZ_PREVIEW) against a routed fetch
// stub, with a t3 config shaped like the reviewer store's (minimal intro,
// split intro layout, lead + photo step + try-on + bundle on, no uiText).
// The old tests dispatched "submit" on the form directly, which skipped
// the button and hid the bug, so these click the real controls.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const opt = (label: string, axisValue: string) => ({
  label,
  axisValue,
  botResponse: null,
  reasonText: null,
  imageUrl: null,
  showIf: null,
  selectAll: false,
  displayMeta: null,
});
const question = (axisKey: string, prompt: string, options: unknown[]) => ({
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

const FLOW = {
  configured: true,
  photoAxes: [],
  photoAxisDetails: [],
  questions: [
    question("shopping_for", "What are you shopping for today?", [opt("Apparel", "apparel"), opt("Skincare", "skincare")]),
    question("budget", "Where should we keep the price?", [opt("Under $100", "value"), opt("$100 and up", "premium")]),
  ],
};

function makeConfig(template: string | null, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    enabled: true,
    currency: "USD",
    assistantMode: "both",
    assistantName: "Laura",
    uiText: null,
    introLayout: "split",
    compactLayout: false,
    template,
    brandTokens: null,
    tryonEnabled: true,
    landing: {
      eyebrow: "Find My Fit",
      headline: "Let's find your perfect match",
      subtext: "A few quick questions.",
      trustItems: ["Fit-matched picks", "Real catalog only", "Takes under a minute"],
      beforeImageUrl: null,
      afterImageUrl: null,
      visualCaption: "",
      altAudienceLabel: "",
      altAudienceUrl: "",
      photoNote: null,
      ...(template ? { founder: null, rating: null, benefitChips: ["Fit-matched picks"] } : {}),
    },
    gate: { enabled: true, headline: null, helper: null, photoLabel: null, skipLabel: null, privacyNote: null },
    results: { bundleEnabled: true, bundleLabel: null, bundleSize: 0, crossSell: null, bundleDiscount: null },
    upsell: { title: null, body: null, cta: null },
    shadeGate: {},
    lead: { enabled: true, collectPhone: false, headline: null, body: null, buttonLabel: null, skipLabel: null, consentText: null, ...(template ? { hasDiscount: false } : {}) },
    ...(template ? { emailPlacement: "gate_results", phases: [], theme: { heroImage: null }, imageSlots: {} } : {}),
  };
  return { ...base, ...overrides };
}

let CONFIG: Record<string, unknown> = makeConfig("t3");
let customerFirstName = "";

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
function routedFetch(url: string) {
  if (url.includes("/api/storefront/quiz-config")) return json(CONFIG);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  return json({});
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SWAP = 250; // swapScreen replaces the node after 160ms

// Every boot evaluates the widget IIFE again; drop the window listeners
// the previous boot registered so instances don't pile up.
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

async function boot() {
  document.body.innerHTML =
    '<div id="gleame-quiz-root" data-shop-domain="review-store.myshopify.com" data-cart-token=""' +
    ' data-customer-first-name="' + customerFirstName + '"></div>';
  (window as any).fetch = routedFetch;
  evalWidget();
  for (let i = 0; i < 6; i++) await tick();
  await wait(SWAP);
  return document.getElementById("gleame-quiz-root")!;
}

async function openNameStep() {
  const root = await boot();
  (root.querySelector(".gq-tpl-begin") as HTMLElement).click();
  await wait(SWAP);
  expect(root.querySelector(".gq-t3-name")).not.toBeNull();
  return root;
}

function typeName(root: Element, value: string) {
  const input = root.querySelector(".gq-t3-name-input") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

const continueBtn = (root: Element) => root.querySelector(".gq-t3-name-continue") as HTMLButtonElement;
const savedState = () => JSON.parse(sessionStorage.getItem("gleame-quiz-state-v2") || "{}").s || {};

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/pages/find-my-match");
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).GLEAME_QUIZ_FORCE;
  delete (window as any).GLEAME_QUIZ_STORE_PREVIEW;
  delete (window as any).GLEAME_QUIZ_BOOT;
  CONFIG = makeConfig("t3");
  customerFirstName = "";
});

describe("Routine (t3) name capture on the storefront", () => {
  it("clicking Continue after typing a name advances to question 1 with the greeting", async () => {
    const root = await openNameStep();
    typeName(root, "App Tester");
    expect(continueBtn(root).disabled).toBe(false);
    continueBtn(root).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-name")).toBeNull();
    expect(root.querySelector(".gq-t3-q")!.textContent).toBe("Nice to meet you, App Tester.");
    expect(root.querySelector(".gq-t3-sub")!.textContent).toBe("What are you shopping for today?");
    expect(savedState().screen).toBe("question");
    expect(savedState().shopperName).toBe("App Tester");
    expect(location.hash).toBe("#gq-q1");
  });

  it("Continue is the name form's one submit button and Skip sits outside the form", async () => {
    // Enter in the field submits through the form's default button (its
    // first submit button), so it must be Continue and never Skip.
    const root = await openNameStep();
    const form = root.querySelector(".gq-t3-name-form") as HTMLFormElement;
    const cont = continueBtn(root);
    expect(cont.type).toBe("submit");
    expect(cont.form).toBe(form);
    expect(form.querySelectorAll('button[type="submit"], input[type="submit"]').length).toBe(1);
    const skip = root.querySelector(".gq-t3-name-body > .gq-tpl-skip") as HTMLButtonElement;
    expect(skip.type).toBe("button");
    expect(skip.form).toBeNull();
  });

  it("a blank name keeps Continue disabled and stays on the step", async () => {
    const root = await openNameStep();
    expect(continueBtn(root).disabled).toBe(true);
    typeName(root, "   ");
    expect(continueBtn(root).disabled).toBe(true);
    continueBtn(root).click();
    // A submit with no name (as Enter would send it) is ignored too.
    (root.querySelector(".gq-t3-name-form") as HTMLFormElement).requestSubmit();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-name")).not.toBeNull();
    expect(savedState().screen).toBe("name");
  });

  it("whitespace in the name is collapsed and trimmed", async () => {
    const root = await openNameStep();
    typeName(root, "  App   Tester ");
    continueBtn(root).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-q")!.textContent).toBe("Nice to meet you, App Tester.");
  });

  it("Skip still advances without a name", async () => {
    const root = await openNameStep();
    typeName(root, "App Tester");
    (root.querySelector(".gq-tpl-skip") as HTMLElement).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-name")).toBeNull();
    expect(root.querySelector(".gq-t3-q")!.textContent).toBe("What are you shopping for today?");
    expect(savedState().shopperName).toBe("");
  });

  it("a renamed Continue (Text & labels next) still submits", async () => {
    CONFIG = makeConfig("t3", { uiText: { next: "Weiter" } });
    const root = await openNameStep();
    expect(continueBtn(root).textContent).toBe("Weiter");
    typeName(root, "Maya");
    continueBtn(root).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-q")!.textContent).toBe("Nice to meet you, Maya.");
  });

  it("a logged-in customer never sees the step", async () => {
    customerFirstName = "Jess";
    const root = await boot();
    (root.querySelector(".gq-tpl-begin") as HTMLElement).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-name")).toBeNull();
    expect(root.querySelector(".gq-t3-q")!.textContent).toBe("Nice to meet you, Jess.");
  });

  it("other templates and the classic quiz have no name step", async () => {
    for (const t of ["t1", "t2", "t4", "t5"]) {
      CONFIG = makeConfig(t);
      sessionStorage.clear();
      const root = await boot();
      (root.querySelector(".gq-tpl-begin") as HTMLElement).click();
      await wait(SWAP);
      expect(root.querySelector(".gq-t3-name"), t).toBeNull();
      expect(root.querySelector('input[name="name"]'), t).toBeNull();
      expect(savedState().screen, t).toBe("question");
    }
    CONFIG = makeConfig(null);
    sessionStorage.clear();
    const classic = await boot();
    expect(classic.querySelector(".gq-intro")).not.toBeNull();
    expect(classic.querySelector('input[name="name"]')).toBeNull();
    (classic.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
    await wait(220 + SWAP);
    expect(classic.querySelector('input[name="name"]')).toBeNull();
    expect(savedState().screen).toBe("question");
  });
});
