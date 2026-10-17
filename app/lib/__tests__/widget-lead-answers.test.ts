// @vitest-environment jsdom
//
// Lead answers allowlist against the REAL widget: boot gleame-quiz.js on
// the live storefront path, answer a single-select, a multi-select whose
// label contains ", ", and an "open to anything" pick, submit the lead
// step, and run the captured quiz-lead payload through the server's
// allowlist. Every answer a shopper actually gives must survive it.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isAllowedLeadAnswer, leadAnswerAllowlist } from "../quiz-lead-answers";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const opt = (label: string, axisValue: string, selectAll = false) => ({
  label,
  axisValue,
  reasonText: null,
  imageUrl: null,
  showIf: null,
  selectAll,
  displayMeta: null,
});
const question = (axisKey: string, prompt: string, options: Array<ReturnType<typeof opt>>, multiSelect = false) => ({
  axisKey,
  axisLabel: axisKey,
  prompt,
  helperText: null,
  multiSelect,
  maxSelections: null,
  screenGroup: null,
  showIf: null,
  optionStyle: null,
  options,
});

const FLOW = {
  configured: true,
  photoAxes: ["tone"],
  photoAxisDetails: [{ key: "tone", label: "Skin tone", values: [{ value: "light", label: "Light", swatch: null }] }],
  questions: [
    question("vibe", "What's the vibe?", [opt("Full Glam", "full_glam"), opt("Timeless", "timeless")]),
    question("skin", "Your skin today?", [opt("Dry, flaky", "dry"), opt("Oily", "oily"), opt("Combo", "combo")], true),
    question("finish", "Any finish you love?", [opt("Crème ✨", "creme"), opt("Surprise me", "any", true)]),
  ],
};

const CONFIG = {
  enabled: true,
  template: null,
  brandTokens: null,
  tryonEnabled: false,
  compactLayout: false,
  uiText: null,
  landing: {
    eyebrow: null,
    headline: "Find your vibe",
    subtext: null,
    trustItems: [],
    beforeImageUrl: null,
    afterImageUrl: null,
    visualCaption: null,
    altAudienceLabel: null,
    altAudienceUrl: null,
    photoNote: null,
  },
  gate: { enabled: false },
  results: { bundleEnabled: false, bundleLabel: null, bundleSize: 0, crossSell: null, bundleDiscount: null },
  upsell: { title: null, body: null, cta: null },
  shadeGate: {},
  lead: { enabled: true, headline: "Want us to send your matches?", collectPhone: false },
};

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

let leadBodies: any[] = [];
function routedFetch(url: string, init?: { body?: string }) {
  if (url.includes("/api/storefront/quiz-config")) return json(CONFIG);
  if (url.includes("/api/storefront/recommendation-config")) return json(FLOW);
  if (url.includes("/api/storefront/quiz-lead")) {
    leadBodies.push(JSON.parse(String(init?.body)));
    return json({ success: true });
  }
  if (url.includes("/api/storefront/quiz-recommend")) return json({ matrixApplied: true, partial: false, matches: [] });
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

async function boot() {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="shop.myshopify.com"></div>';
  (window as any).fetch = vi.fn(routedFetch);
  evalWidget();
  for (let i = 0; i < 6; i++) await tick();
  await wait(SWAP);
  return document.getElementById("gleame-quiz-root")!;
}

function button(root: HTMLElement, text: string): HTMLElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`no button "${text}" in: ${root.textContent}`);
  return found as HTMLElement;
}

beforeEach(() => {
  sessionStorage.clear();
  leadBodies = [];
  delete (window as any).GLEAME_QUIZ_PREVIEW;
  delete (window as any).GLEAME_QUIZ_FORCE;
  delete (window as any).GLEAME_QUIZ_STORE_PREVIEW;
  (window as any).Shopify = {};
});

describe("lead answers from the real widget", () => {
  it("every answer the shopper gave passes the server allowlist", async () => {
    const root = await boot();
    button(root, "Timeless").click();
    await wait(220 + SWAP);

    button(root, "Dry, flaky").click();
    button(root, "Oily").click();
    (root.querySelector(".gq-continue-btn") as HTMLElement).click();
    await wait(220 + SWAP);

    button(root, "Surprise me").click();
    await wait(220 + SWAP);

    const form = root.querySelector(".gq-lead-form") as HTMLFormElement;
    expect(form, root.textContent ?? "").not.toBeNull();
    (form.querySelector('input[name="email"]') as HTMLInputElement).value = "shopper@example.com";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    for (let i = 0; i < 4; i++) await tick();

    expect(leadBodies).toHaveLength(1);
    const sent = leadBodies[0].answers as Array<{ question: string; answer: string }>;
    expect(sent).toEqual([
      { question: "What's the vibe?", answer: "Timeless" },
      { question: "Your skin today?", answer: "Dry, flaky, Oily" },
      { question: "Any finish you love?", answer: "Surprise me" },
    ]);

    const allow = leadAnswerAllowlist(FLOW, CONFIG.uiText);
    expect(sent.filter((a) => isAllowedLeadAnswer(allow, a.question, a.answer))).toEqual(sent);
  });
});
