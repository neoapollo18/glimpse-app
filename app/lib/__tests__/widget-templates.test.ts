// @vitest-environment jsdom
//
// Gleame v3 widget template tests (V3-SPEC Part 8.2 / V3-CONTRACTS §6).
// The storefront widget is plain browser JS with no build step, so the
// source is loaded verbatim into jsdom with a window.GLEAME_QUIZ_PREVIEW
// fixture. jsdom has no layout: every assertion is about DOM structure.

import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIDGET_PATH = path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.js");
const TEMPLATES = ["t1", "t2", "t3", "t4", "t5"] as const;
type Tpl = (typeof TEMPLATES)[number];

let source = "";
beforeAll(() => {
  source = fs.readFileSync(WIDGET_PATH, "utf8");
});

const IMG = "https://cdn.example.com/img/";

// 5 questions, 2 visual (q2, q4) with imageUrls on SOME options only.
function makeFlow() {
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
  return {
    configured: true,
    photoAxes: [],
    photoAxisDetails: [],
    questions: [
      {
        axisKey: "skin_type",
        axisLabel: "Skin type",
        prompt: "What's your skin type?",
        helperText: "Choose the one that sounds most like you.",
        multiSelect: false,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: null,
        options: [
          opt("Dry", "dry", { displayMeta: { sublabel: "Needs a little more nourishment" } }),
          opt("Oily", "oily", { displayMeta: { sublabel: "Shiny as the day goes on" } }),
          opt("Combo", "combo", { reasonText: "A mix of both" }),
          opt("Normal", "normal"),
        ],
      },
      {
        axisKey: "undertone",
        axisLabel: "Undertone",
        prompt: "Which of these tones do you see on your skin?",
        helperText: "Hold a photo of yourself near these swatches.",
        multiSelect: false,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: null,
        options: [
          opt("Neutral", "neutral"),
          opt("Pink", "pink", { imageUrl: IMG + "pink.jpg" }),
          opt("Yellow", "yellow", { imageUrl: IMG + "yellow.jpg" }),
        ],
      },
      {
        axisKey: "concern",
        axisLabel: "Concerns",
        prompt: "What are you dealing with?",
        helperText: null,
        multiSelect: true,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: null,
        options: [
          opt("Breakouts", "breakouts", { displayMeta: { emoji: "🌋" } }),
          opt("Dullness", "dull"),
          opt("Redness", "red"),
          opt("Fine lines", "lines"),
        ],
      },
      {
        axisKey: "finish",
        axisLabel: "Finish",
        prompt: "Pick your finish",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: null,
        options: [
          opt("Glass skin", "glass", { imageUrl: IMG + "glass.jpg" }),
          opt("Soft matte", "matte"),
          opt("Glitter era", "glitter"),
          opt("No-makeup makeup", "nomakeup"),
        ],
      },
      {
        axisKey: "budget",
        axisLabel: "Budget",
        prompt: "What's your budget?",
        helperText: null,
        multiSelect: false,
        maxSelections: null,
        screenGroup: null,
        showIf: null,
        optionStyle: null,
        options: [opt("Under $30", "low"), opt("$30–$60", "mid"), opt("Sky's the limit", "high")],
      },
    ],
  };
}

function makeProductJson() {
  const pj = (handle: string, title: string, price: number, variants: Array<{ id: number; title: string; price: number }>) => ({
    id: 1,
    handle,
    title,
    price,
    featured_image: IMG + handle + "-1.jpg",
    images: [IMG + handle + "-1.jpg", IMG + handle + "-2.jpg", IMG + handle + "-3.jpg"],
    options: [{ name: "Size" }],
    variants: variants.map((v) => ({ ...v, available: true, featured_image: null })),
  });
  return {
    "cloud-cream": pj("cloud-cream", "Cloud Cream", 2900, [
      { id: 101, title: "Standard", price: 2900 },
      { id: 102, title: "Mini", price: 1400 },
    ]),
    "glow-drops": pj("glow-drops", "Glow Drops", 2400, [{ id: 201, title: "Default", price: 2400 }]),
    "night-serum": pj("night-serum", "Night Serum", 3200, [{ id: 301, title: "Default", price: 3200 }]),
  };
}

function makeSampleRecommend() {
  return {
    matrixApplied: true,
    partial: false,
    matches: [
      {
        productId: "p1",
        productHandle: "cloud-cream",
        productName: "Cloud Cream",
        variantId: "v101",
        variantNumericId: 101,
        variantTitle: "Standard",
        quantity: 1,
        reasons: ["Dry skin → a richer barrier cream", "Neutral undertone → sits in the skin"],
        tagline: "The moisture main character",
      },
      {
        productId: "p2",
        productHandle: "glow-drops",
        productName: "Glow Drops",
        variantId: "v201",
        variantNumericId: 201,
        variantTitle: null,
        quantity: 1,
        reasons: ["Dullness → light-reflecting drops"],
        tagline: null,
      },
      {
        productId: "p3",
        productHandle: "night-serum",
        productName: "Night Serum",
        variantId: "v301",
        variantNumericId: 301,
        variantTitle: null,
        quantity: 1,
        reasons: [],
        tagline: "Overnight repair",
      },
    ],
  };
}

function makeConfig(template: Tpl | null, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    enabled: true,
    template,
    brandTokens: null,
    tryonEnabled: false,
    landing: {
      eyebrow: "Find my fit",
      headline: "Find your perfect match",
      subtext: "A few quick questions and we'll match you to what suits you.",
      trustItems: ["60 seconds", "Free shipping over $50", "30-day returns"],
      beforeImageUrl: null,
      afterImageUrl: null,
      visualCaption: null,
      altAudienceLabel: null,
      altAudienceUrl: null,
    },
    // On: the walk-throughs below cross the photo step (the preview used to
    // show it regardless; it now follows the shopper rule, see the
    // "photo step off" test).
    gate: { enabled: true, headline: null, helper: null, photoLabel: null, skipLabel: null, privacyNote: null },
    results: {
      headlinePhoto: null,
      headlineNoPhoto: null,
      bestMatchPill: null,
      alsoMatchedLabel: null,
      addButtonTemplate: null,
      viewProductLabel: null,
      restartLabel: null,
      subtext: null,
      showMatchesLabel: null,
      bundleEnabled: true,
      bundleLabel: null,
      bundleSize: null,
      matchFootnote: null,
    },
    upsell: { title: null, body: null, cta: null },
    shadeGate: {},
    lead: {
      enabled: true,
      collectPhone: false,
      headline: null,
      body: null,
      buttonLabel: null,
      skipLabel: null,
      consentText: null,
      hasDiscount: true,
      discountCode: "QUIZ10",
      discountMessage: "You unlocked 10% off",
    },
  };
  if (template) {
    Object.assign(base, {
      emailPlacement: null,
      phases: [
        { label: "Skin profile", axisKeys: ["skin_type", "undertone"] },
        { label: "Preferences", axisKeys: ["concern", "finish", "budget"] },
      ],
      theme: { heroImage: null },
      imageSlots: {},
    });
    Object.assign(base.landing as object, {
      founder: template === "t3" ? { name: "Nadia", credentials: "Licensed esthetician, founder", portraitUrl: null } : null,
      rating: null,
      benefitChips: ["60 seconds", "No commitment", "Offer at the end"],
    });
    Object.assign(base.results as object, {
      trustLines: ["Made for every skin tone.", "Loved by 40,000 customers."],
      proseTemplate: null,
      archetypeTitle: "You're a Dewy Dreamer",
      archetypeLine: "Dry, tired skin that wants a nap and a glass of water.",
    });
  }
  return { ...base, ...overrides };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Every boot evaluates the widget IIFE again; it registers window
// listeners (popstate, message) it can never remove. Track what a boot
// adds and drop it before the next one so instances don't pile up.
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

function mount(preview: Record<string, unknown>) {
  document.body.innerHTML = '<div id="gleame-quiz-root" data-shop-domain="test-shop.myshopify.com"></div>';
  (window as any).GLEAME_QUIZ_PREVIEW = preview;
  (window as any).fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  evalWidget();
}

async function boot(preview: Record<string, unknown>) {
  mount(preview);
  await tick();
  await tick();
  await tick();
  return document.getElementById("gleame-quiz-root")!;
}

const SWAP = 200; // swapScreen replaces the node after 160ms
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stageChild(root: Element) {
  return root.querySelector(".gq-stage")!.firstElementChild!;
}

function previewFor(template: Tpl | null, step: string, studio: boolean, configOverrides: Record<string, unknown> = {}) {
  return {
    config: makeConfig(template, configOverrides),
    flow: makeFlow(),
    sampleRecommend: makeSampleRecommend(),
    productJson: makeProductJson(),
    studio,
    overrides: { step },
  };
}

/** Structural signature: tags + classes, no text or attributes. */
function structure(node: Element): string {
  // Transition classes (gq-enter*/gq-leave*/gq-screen) are timing-dependent; drop them.
  const cls = node.className && typeof node.className === "string"
    ? "." + node.className.split(/\s+/).filter((c) => c && !/^gq-(enter|leave|screen)/.test(c)).sort().join(".")
    : "";
  const kids = Array.from(node.children).map(structure).join("");
  return `<${node.tagName.toLowerCase()}${cls}>${kids}</${node.tagName.toLowerCase()}>`;
}

const ALL_STEPS = ["intro", "q1", "q2", "q3", "q4", "q5", "lead", "results"];

// Pinned tag/class skeleton of the legacy intro (+ inline Q1) and the legacy
// Q2 screen for the fixture flow. Any change to legacy rendering fails here.
const LEGACY_SNAPSHOT =
  "<div.gq-intro.gq-intro--centered.gq-intro--solo><div.gq-intro-main><div.gq-intro-copy><p.gq-eyebrow></p><h2.gq-headline></h2><p.gq-subtext></p><div.gq-intro-question><h3.gq-intro-question-title></h3><p.gq-intro-question-helper></p><div.gq-chip-row><button.gq-chip><span.gq-chip-text><span></span><span.gq-chip-sub></span></span></button><button.gq-chip><span.gq-chip-text><span></span><span.gq-chip-sub></span></span></button><button.gq-chip><span></span></button><button.gq-chip><span></span></button></div></div></div></div><div.gq-trust-row><span.gq-trust-item><svg><polyline></polyline></svg><span></span></span><span.gq-trust-item><svg><polyline></polyline></svg><span></span></span><span.gq-trust-item><svg><polyline></polyline></svg><span></span></span></div></div>||<div.gq-step><div.gq-step-header><button.gq-back><svg><polyline></polyline></svg><span></span></button><div.gq-progress-wrap><span.gq-step-count></span><div.gq-pips><span.gq-pip.gq-pip--done></span><span.gq-pip.gq-pip--current></span><span.gq-pip></span><span.gq-pip></span><span.gq-pip></span></div></div></div><div.gq-step-body><h2.gq-question-title></h2><p.gq-question-helper></p><div.gq-option-block><div.gq-option-grid><button.gq-option.gq-option--visual><span.gq-option-img.gq-option-img--empty></span><span.gq-option-visual-label></span><svg><polyline></polyline></svg></button><button.gq-option.gq-option--visual><img.gq-option-img></img><span.gq-option-visual-label></span><svg><polyline></polyline></svg></button><button.gq-option.gq-option--visual><img.gq-option-img></img><span.gq-option-visual-label></span><svg><polyline></polyline></svg></button></div></div></div></div>";

describe("v3 widget templates", () => {
  it("(1) five root components produce pairwise different DOM for the same payload", async () => {
    const sigs: Record<string, string> = {};
    for (const step of ["intro", "q2", "results"]) {
      for (const t of TEMPLATES) {
        const root = await boot(previewFor(t, step, false));
        expect(root.classList.contains("gq-" + t)).toBe(true);
        // Templates own their design: no separate Look class (2026-10-01).
        expect(Array.from(root.classList).some((c) => c.startsWith("gq-look-"))).toBe(false);
        sigs[`${t}:${step}`] = structure(root.querySelector(".gq-stage")!);
      }
      for (let i = 0; i < TEMPLATES.length; i++) {
        for (let j = i + 1; j < TEMPLATES.length; j++) {
          expect(sigs[`${TEMPLATES[i]}:${step}`], `${TEMPLATES[i]} vs ${TEMPLATES[j]} on ${step}`).not.toBe(
            sigs[`${TEMPLATES[j]}:${step}`]
          );
        }
      }
    }
  });

  it("(2) results markers per template", async () => {
    const t1 = await boot(previewFor("t1", "results", false));
    expect(t1.querySelector(".gq-t1r")).not.toBeNull();
    expect(t1.querySelector(".gq-t1r-echo")).not.toBeNull();
    expect(t1.querySelectorAll(".gq-t1r-echo-item").length).toBe(0); // no answers on a deep link
    expect(t1.querySelector(".gq-t1r-main")).not.toBeNull();
    expect(t1.querySelectorAll(".gq-t1r-thumb").length).toBeGreaterThanOrEqual(3);
    expect(t1.querySelectorAll(".gq-t1r-variant").length).toBe(2);
    expect(t1.querySelectorAll(".gq-t1-alt").length).toBe(2);

    const t2 = await boot(previewFor("t2", "results", false));
    expect(t2.querySelector(".gq-t2r")).not.toBeNull();
    expect(t2.querySelector("table.gq-t2r-table")).not.toBeNull();
    expect(t2.querySelectorAll(".gq-t2r-bullet").length).toBe(2);

    const t3 = await boot(previewFor("t3", "results", false));
    expect(t3.querySelector(".gq-t3r")).not.toBeNull();
    expect(t3.querySelectorAll(".gq-t3r-step").length).toBeGreaterThanOrEqual(2);
    expect(t3.querySelector(".gq-t3r-total")).not.toBeNull();
    expect(t3.querySelector(".gq-t3r-group--night")).not.toBeNull(); // "Night Serum" classifies to Night
    expect(t3.querySelector(".gq-t3r-total-value")!.textContent).toMatch(/85/);
    expect(t3.querySelector(".gq-t3r-addall .gq-add-btn")!.textContent).toMatch(/Add routine to cart/);

    const t4 = await boot(previewFor("t4", "results", false));
    expect(t4.querySelector(".gq-t4r")).not.toBeNull();
    expect(t4.querySelector(".gq-t4r-archetype")).not.toBeNull();
    expect(t4.querySelector(".gq-t4r-archetype")!.textContent).toBe("You're a Dewy Dreamer");
    expect(t4.querySelector(".gq-t4r-kit")).not.toBeNull();
    expect(t4.querySelector(".gq-t4r-kit-title")!.textContent).toBe("Your Dewy Dreamer kit");
    expect(t4.querySelectorAll(".gq-t4r-mini").length).toBe(3);
    expect(t4.querySelector(".gq-t4r-addall .gq-add-btn")!.textContent).toMatch(/Add all 3/);

    const t5 = await boot(previewFor("t5", "results", false));
    expect(t5.querySelector(".gq-t5r")).not.toBeNull();
    expect(t5.querySelector(".gq-t5r-grid")).not.toBeNull();
    expect(t5.querySelector("table")).toBeNull();
    expect(t5.querySelectorAll(".gq-t5r-card").length).toBe(3);
  });

  it("(3) intros: every template intro root carries gq-intro-{type}; no two share a class set", async () => {
    const expected: Record<Tpl, string> = { t1: "hero", t2: "landing", t3: "founder", t4: "hero", t5: "minimal" };
    const sets: string[] = [];
    for (const t of TEMPLATES) {
      const root = await boot(previewFor(t, "intro", false));
      const intro = root.querySelector(".gq-tpl-intro")!;
      expect(intro, t).not.toBeNull();
      expect(intro.classList.contains("gq-intro-" + expected[t]), `${t} intro type`).toBe(true);
      expect(root.querySelector(".gq-intro")).toBeNull(); // legacy intro class never used
      sets.push(Array.from(intro.classList).sort().join(" "));
    }
    expect(new Set(sets).size).toBe(TEMPLATES.length);

    // A stale pre-2026-10 `look` in the payload changes nothing: Consult
    // keeps its landing intro and no gq-look-* class is applied.
    const ed = await boot(previewFor("t2", "intro", false, { look: "editorial" }));
    expect(Array.from(ed.classList).some((c) => c.startsWith("gq-look-"))).toBe(false);
    expect(ed.querySelector(".gq-tpl-intro.gq-intro-landing")).not.toBeNull();
    // Routine without founder data falls to Minimal.
    const t3min = await boot(previewFor("t3", "intro", false, { landing: { ...(makeConfig("t3").landing as object), founder: null } }));
    expect(t3min.querySelector(".gq-tpl-intro.gq-intro-minimal")).not.toBeNull();
    // Landing intro: hook CTA + 3 benefit chips + a live miniature, no rating chip.
    const t2 = await boot(previewFor("t2", "intro", false));
    expect(t2.querySelector(".gq-tpl-begin")!.textContent).toBe("Unlock my discount");
    expect(t2.querySelectorAll(".gq-intro-benefit").length).toBe(3);
    expect(t2.querySelector(".gq-intro-rating")).toBeNull();
    expect(t2.querySelectorAll(".gq-intro-preview-block .gq-t2-card").length).toBe(3);
    expect(t2.querySelector(".gq-intro-badge")).not.toBeNull();
    // Match intro shows the phase header.
    const t1 = await boot(previewFor("t1", "intro", false));
    expect(t1.querySelectorAll(".gq-t1-phase-name").length).toBe(2);
  });

  it("(4a) Studio renders the placeholder for unresolved declared slots", async () => {
    for (const t of TEMPLATES) {
      let count = 0;
      for (const step of ["intro", "q2", "q4"]) {
        const root = await boot(previewFor(t, step, true));
        count += root.querySelectorAll(".gq-slot--placeholder").length;
      }
      expect(count, `${t} studio placeholders`).toBeGreaterThanOrEqual(1);
    }
    // Resolved answer images are real <img>s, never placeholders.
    const t1 = await boot(previewFor("t1", "q2", true));
    expect(t1.querySelectorAll(".gq-t1-tile .gq-slot--resolved img").length).toBe(2);
    expect(t1.querySelectorAll(".gq-t1-tile .gq-slot--placeholder").length).toBe(1);
    // The Images rail map wins over the answer's own image.
    const railed = await boot(previewFor("t1", "q2", true, { imageSlots: { "answer:undertone:neutral": IMG + "rail.jpg" } }));
    expect(railed.querySelectorAll(".gq-t1-tile .gq-slot--placeholder").length).toBe(0);
    // Placeholder click posts gleame:pick-slot to the parent.
    const msgs: any[] = [];
    const orig = window.parent.postMessage;
    (window.parent as any).postMessage = (m: any) => msgs.push(m);
    (t1.querySelector(".gq-slot--placeholder") as HTMLElement).click();
    (window.parent as any).postMessage = orig;
    expect(msgs.some((m) => m.type === "gleame:pick-slot" && m.slotKey === "answer:undertone:neutral" && m.kind === "variant")).toBe(true);
  });

  it("(4b) the storefront never renders the placeholder on any screen of any template", async () => {
    for (const t of TEMPLATES) {
      for (const step of ALL_STEPS) {
        const root = await boot(previewFor(t, step, false));
        expect(root.querySelectorAll(".gq-slot--placeholder").length, `${t} ${step}`).toBe(0);
        expect(root.querySelector(".gq-stage")!.children.length, `${t} ${step} rendered`).toBe(1);
      }
    }
    // Storefront collapse per kind: variant → initial block; lifestyle → text-only card.
    const t1 = await boot(previewFor("t1", "q2", false));
    expect(t1.querySelectorAll(".gq-t1-tile .gq-slot--initial").length).toBe(1);
    const t2 = await boot(previewFor("t2", "q2", false));
    expect(t2.querySelectorAll(".gq-t2-card--noimg").length).toBe(1);
    const t3 = await boot(previewFor("t3", "q2", false));
    expect(t3.querySelectorAll(".gq-t3-icon--noicon").length).toBe(1);
    // Hero unresolved → intro falls to its no-image variant.
    const heroless = await boot(previewFor("t4", "intro", false));
    expect(heroless.querySelector(".gq-tpl-intro.gq-intro--noimg")).not.toBeNull();
    const heroful = await boot(previewFor("t4", "intro", false, { theme: { heroImage: IMG + "hero.jpg" } }));
    expect(heroful.querySelector(".gq-intro-hero-slot.gq-slot--resolved img")).not.toBeNull();
  });

  it("(5) Consult results carry no urgency strings", async () => {
    const t2 = await boot(previewFor("t2", "results", false));
    // Assembled so the CI banned-string grep (fixed strings) never sees the
    // literal urgency phrases in source.
    const urgency = new RegExp(["only \\d+ l" + "eft", "offer e" + "nds", "count" + "down"].join("|"), "i");
    expect(t2.textContent || "").not.toMatch(urgency);
    expect(urgency.test("count" + "down timer")).toBe(true); // the regex itself works
  });

  it("(6) legacy: template null renders the legacy intro and no template root class", async () => {
    const root = await boot({ config: makeConfig(null), flow: makeFlow(), sampleRecommend: makeSampleRecommend(), productJson: makeProductJson(), studio: true, overrides: { step: null } });
    expect(root.querySelector(".gq-intro")).not.toBeNull();
    expect(root.querySelector(".gq-tpl-intro")).toBeNull();
    expect(Array.from(root.classList).some((c) => /^gq-(t[1-5]|look-)/.test(c))).toBe(false);
    expect(root.querySelectorAll(".gq-slot").length).toBe(0);
  });

  it("email placement: hook/gate render their own lead screen, after_results renders a card, off renders nothing", async () => {
    const hook = await boot(previewFor("t2", "lead", false));
    expect(hook.querySelector(".gq-t2-lead .gq-tpl-lead-form")).not.toBeNull();
    expect(hook.querySelector(".gq-tpl-skip")!.textContent).toBe("Skip");
    expect(hook.querySelector(".gq-tpl-lead-submit")!.textContent).toBe("Reveal my discount →");

    const after = await boot(previewFor("t1", "results", false, { emailPlacement: "after_results" }));
    expect(after.querySelector(".gq-t1r .gq-tpl-lead-inline .gq-tpl-lead-form")).not.toBeNull();
    // Default (2026-10-13): Match asks before results, so no card here.
    const matchDefault = await boot(previewFor("t1", "results", false));
    expect(matchDefault.querySelector(".gq-tpl-lead-inline")).toBeNull();
    const off = await boot(previewFor("t1", "results", false, { emailPlacement: "off" }));
    expect(off.querySelector(".gq-tpl-lead-inline")).toBeNull();
    const gate = await boot(previewFor("t3", "results", false));
    expect(gate.querySelector(".gq-tpl-lead-inline")).toBeNull(); // Routine defaults to gate_results
  });

  it('email placement "both": its own lead screen and the results card, saved once given', async () => {
    const step = await boot(previewFor("t1", "lead", false, { emailPlacement: "both" }));
    expect(step.querySelector(".gq-tpl-lead .gq-tpl-lead-form")).not.toBeNull();
    // No discount code: a code would be revealed in the card instead.
    const lead = { ...(makeConfig("t1").lead as object), hasDiscount: false, discountCode: null, discountMessage: null };
    const results = await boot(previewFor("t1", "results", false, { emailPlacement: "both", lead }));
    const card = results.querySelector(".gq-t1r .gq-tpl-lead-inline")!;
    expect(card.querySelector(".gq-tpl-lead-form")).not.toBeNull();
    (card.querySelector(".gq-lead-input") as HTMLInputElement).value = "shopper@example.com";
    card.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(20);
    const saved = results.querySelector(".gq-t1r .gq-tpl-lead-saved")!;
    expect(saved.textContent).toBe("Saved ✓ You’re on the list.");
    expect(results.querySelector(".gq-t1r .gq-tpl-lead-form")).toBeNull();
  });

  it("Match: S1 rows carry tag + description, S3 shows 'Select all that apply' + Continue, numeral is zero-padded", async () => {
    const q1 = await boot(previewFor("t1", "q1", false));
    expect(q1.querySelectorAll(".gq-t1-row").length).toBe(4);
    expect(q1.querySelector(".gq-t1-row .gq-t1-row-tag")!.textContent).toBe("Dry");
    expect(q1.querySelector(".gq-t1-row .gq-t1-row-desc")!.textContent).toBe("Needs a little more nourishment");
    expect(q1.querySelector(".gq-t1-numeral")!.textContent).toBe("02 / 06");
    const q3 = await boot(previewFor("t1", "q3", false));
    expect(q3.querySelector(".gq-tpl-multi")!.textContent).toBe("Select all that apply");
    expect(q3.querySelector(".gq-tpl-continue")).not.toBeNull();
    const q2 = await boot(previewFor("t1", "q2", false));
    expect(q2.querySelector(".gq-t1-tip")).not.toBeNull();
    expect(q2.querySelector(".gq-t1-tiles--3")).not.toBeNull();
  });

  it("Consult/Discover/Clean question chrome", async () => {
    const t2 = await boot(previewFor("t2", "q3", false));
    expect(t2.querySelector(".gq-t2-count")!.textContent).toBe("Question 3 of 5");
    expect(t2.querySelectorAll(".gq-t2-letter").length).toBe(4);
    expect(t2.querySelector(".gq-t2-letter")!.textContent).toBe("A");
    const t4 = await boot(previewFor("t4", "q3", false));
    expect(t4.querySelectorAll(".gq-t4-seg").length).toBe(5);
    expect(t4.querySelectorAll(".gq-t4-seg.is-filled").length).toBe(3);
    expect(t4.querySelector(".gq-t4-emoji")!.textContent).toBe("🌋"); // emoji allowed in Discover
    const t5 = await boot(previewFor("t5", "q3", false));
    expect(t5.querySelector(".gq-t5-count")!.textContent).toBe("3/5");
    expect(t5.querySelectorAll(".gq-t5-bar").length).toBe(4);
    expect(t5.querySelectorAll(".gq-slot").length).toBe(0);
    expect(t5.querySelector(".gq-t4-emoji")).toBeNull(); // not under Minimal outside Discover
    const t3 = await boot(previewFor("t3", "q2", false));
    expect(t3.querySelectorAll(".gq-t3-icon").length).toBe(3);
  });

  it("Routine: intro CTA opens the name capture, a name greets the first question", async () => {
    const root = await boot(previewFor("t3", "intro", false));
    (root.querySelector(".gq-tpl-begin") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 220));
    expect(root.querySelector(".gq-t3-name")).not.toBeNull();
    const input = root.querySelector(".gq-t3-name-input") as HTMLInputElement;
    input.value = "Maya";
    input.dispatchEvent(new Event("input"));
    // Click the real button: a synthetic submit on the form skipped it and
    // hid a Continue that could not submit (2026-10-19 App Review).
    (root.querySelector(".gq-t3-name-continue") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 220));
    expect(root.querySelector(".gq-t3-q")!.textContent).toBe("Nice to meet you, Maya.");
    expect(root.querySelector(".gq-t3-sub")!.textContent).toBe("What's your skin type?");
  });

  it("(1-fix) protocol-relative product-JSON images resolve on the storefront", async () => {
    const pj = makeProductJson() as Record<string, any>;
    for (const h of Object.keys(pj)) {
      pj[h].featured_image = "//cdn.shopify.com/s/files/" + h + "-1.jpg";
      pj[h].images = pj[h].images.map((u: string) => u.replace("https://cdn.example.com/img/", "//cdn.shopify.com/s/files/"));
    }
    const t1 = await boot({ ...previewFor("t1", "results", false), productJson: pj });
    expect(t1.querySelector(".gq-t1r-main.gq-slot--resolved img")!.getAttribute("src")).toMatch(/^https:\/\/cdn\.shopify\.com/);
    expect(t1.querySelectorAll(".gq-t1r-thumb.gq-slot--resolved").length).toBe(3);
    expect(t1.querySelectorAll(".gq-t1-alt-slot.gq-slot--resolved").length).toBe(2);
    const t5 = await boot({ ...previewFor("t5", "results", false), productJson: pj });
    expect(t5.querySelectorAll(".gq-t5r-slot.gq-slot--resolved img").length).toBe(3);
    expect(t5.querySelectorAll(".gq-slot--initial").length).toBe(0);
    // Merchant-typed slot urls stay strict https.
    const railed = await boot(previewFor("t1", "intro", false, { theme: { heroImage: "//cdn.shopify.com/hero.jpg" } }));
    expect(railed.querySelector(".gq-intro-hero-slot")).toBeNull();
  });

  it("(2-fix) hook copy and the discount badge only when capture is live", async () => {
    const off = await boot(previewFor("t2", "intro", false, { emailPlacement: "off" }));
    expect(off.querySelector(".gq-tpl-begin")!.textContent).not.toBe("Unlock my discount");
    expect(off.querySelector(".gq-intro-badge")).toBeNull();
    const disabled = await boot(previewFor("t2", "intro", false, { lead: { ...(makeConfig("t2").lead as object), enabled: false } }));
    expect(disabled.querySelector(".gq-tpl-begin")!.textContent).not.toBe("Unlock my discount");
    expect(disabled.querySelector(".gq-intro-badge")).toBeNull();
    const after = await boot(previewFor("t2", "intro", false, { emailPlacement: "after_results" }));
    expect(after.querySelector(".gq-tpl-begin")!.textContent).not.toBe("Unlock my discount");
  });

  it("the discount hook keeps its own label when start is overridden (translated quiz)", async () => {
    // A translation pins both keys: the hook shows unlockDiscount, not start.
    const translated = await boot(previewFor("t2", "intro", false, { uiText: { start: "Trouver mon match", unlockDiscount: "Débloquer ma remise" } }));
    expect(translated.querySelector(".gq-tpl-begin")!.textContent).toBe("Débloquer ma remise");
    const startOnly = await boot(previewFor("t2", "intro", false, { uiText: { start: "Trouver mon match" } }));
    expect(startOnly.querySelector(".gq-tpl-begin")!.textContent).toBe("Unlock my discount");
    // Without the hook, start still applies; landing.ctaLabel still wins.
    const off = await boot(previewFor("t2", "intro", false, { emailPlacement: "off", uiText: { start: "Trouver mon match" } }));
    expect(off.querySelector(".gq-tpl-begin")!.textContent).toBe("Trouver mon match");
    const noDiscount = await boot(previewFor("t1", "intro", false, { emailPlacement: "hook_start", lead: { ...(makeConfig("t1").lead as object), hasDiscount: false }, uiText: { start: "Trouver mon match" } }));
    expect(noDiscount.querySelector(".gq-tpl-begin")!.textContent).toBe("Trouver mon match");
    const merchant = await boot(previewFor("t2", "intro", false, { landing: { ...(makeConfig("t2").landing as object), ctaLabel: "Take the quiz" }, uiText: { unlockDiscount: "Débloquer ma remise" } }));
    expect(merchant.querySelector(".gq-tpl-begin")!.textContent).toBe("Take the quiz");
  });

  it("(5-fix) stale phase axis keys fall back to the plain per-screen bar", async () => {
    const root = await boot(previewFor("t1", "q2", false, { phases: [{ label: "Old", axisKeys: ["renamed_axis"] }] }));
    expect(root.querySelector(".gq-t1-phases--plain")).not.toBeNull();
    expect(root.querySelectorAll(".gq-t1-phase").length).toBe(5);
    expect(root.querySelectorAll(".gq-t1-phase-name").length).toBe(0);
  });

  it("(11-fix) T4 add-all omits the total tail while a price is unknown", async () => {
    const pj = makeProductJson() as Record<string, any>;
    delete pj["night-serum"];
    const t4 = await boot({ ...previewFor("t4", "results", false), productJson: pj });
    expect(t4.querySelector(".gq-t4r-addall .gq-add-btn")!.textContent).toBe("Add all 3");
    const full = await boot(previewFor("t4", "results", false));
    expect(full.querySelector(".gq-t4r-addall .gq-add-btn")!.textContent).toMatch(/^Add all 3 — .*85/);
  });

  it("(6-fix) a stale 'name' entry resolves to the first question when capture is off", async () => {
    const root = await boot(previewFor("t3", "intro", false, { nameCapture: false }));
    (root.querySelector(".gq-tpl-begin") as HTMLElement).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-t3-name")).toBeNull();
    expect(stageChild(root).classList.contains("gq-t3-screen")).toBe(true);
  });

  it("(8a) legacy walk-through: template null never touches template DOM; structure pinned", async () => {
    // Try-on on so the walk-through still passes the photo step (with
    // try-on off and no shade question it is skipped, see (8b)).
    const root = await boot({ config: { ...makeConfig(null), tryonEnabled: true }, flow: makeFlow(), sampleRecommend: makeSampleRecommend(), productJson: makeProductJson(), studio: false, overrides: { step: null } });
    const assertLegacy = (label: string) => {
      expect(root.querySelector(".gq-slot"), label).toBeNull();
      expect(root.querySelector('[class*="gq-tpl-"]'), label).toBeNull();
      expect(Array.from(root.classList).some((c) => /^gq-(t[1-5]|look-)/.test(c)), label).toBe(false);
      expect(Array.from(root.querySelectorAll("*")).some((n) => /(^|\s)gq-t[1-5]/.test(n.className || "")), label).toBe(false);
    };
    assertLegacy("intro");
    expect(root.querySelector(".gq-intro")).not.toBeNull();
    const introSig = structure(stageChild(root));
    // Inline question 1 on the intro (legacy behaviour).
    (root.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
    await wait(220 + SWAP);
    expect(stageChild(root).classList.contains("gq-step")).toBe(true);
    assertLegacy("q2");
    const q2Sig = structure(stageChild(root));
    expect(introSig + "||" + q2Sig).toBe(LEGACY_SNAPSHOT);
    // q2 (visual) → q3 (multi) → q4 → q5 → lead → gate → results.
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    (root.querySelector(".gq-continue-btn") as HTMLElement).click();
    await wait(SWAP);
    assertLegacy("q4");
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    expect(stageChild(root).classList.contains("gq-step--lead")).toBe(true);
    expect(root.querySelector(".gq-skip-link")!.textContent).toBe("Skip →");
    assertLegacy("lead");
    (root.querySelector(".gq-skip-link") as HTMLElement).click();
    await wait(SWAP);
    expect(stageChild(root).classList.contains("gq-step--gate")).toBe(true);
    (root.querySelector(".gq-skip-link") as HTMLElement).click();
    await wait(SWAP);
    expect(stageChild(root).classList.contains("gq-results")).toBe(true);
    expect(root.querySelectorAll(".gq-match-card").length).toBe(3);
    assertLegacy("results");
  });

  it("(8c) classic quiz with a shade question keeps the photo step even with try-on off (shade detection)", async () => {
    const flow = {
      ...makeFlow(),
      photoAxes: ["shade"],
      photoAxisDetails: [{ key: "shade", label: "Shade", values: [{ value: "fair", label: "Fair", swatch: "#F1D3C2" }] }],
    };
    const root = await boot({ config: { ...makeConfig(null), tryonEnabled: false }, flow, sampleRecommend: makeSampleRecommend(), productJson: makeProductJson(), studio: false, overrides: { step: null } });
    (root.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    (root.querySelector(".gq-continue-btn") as HTMLElement).click();
    await wait(SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-skip-link") as HTMLElement).click();
    await wait(SWAP);
    expect(stageChild(root).classList.contains("gq-step--gate")).toBe(true);
  });

  it("(8b) classic quiz with try-on off and no shade question: no photo step, lead goes straight to results", async () => {
    const root = await boot({ config: { ...makeConfig(null), tryonEnabled: false }, flow: makeFlow(), sampleRecommend: makeSampleRecommend(), productJson: makeProductJson(), studio: false, overrides: { step: null } });
    (root.querySelector(".gq-intro-question .gq-chip, .gq-intro-question .gq-option") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    (root.querySelector(".gq-continue-btn") as HTMLElement).click();
    await wait(SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    (root.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    expect(stageChild(root).classList.contains("gq-step--lead")).toBe(true);
    (root.querySelector(".gq-skip-link") as HTMLElement).click();
    await wait(SWAP);
    expect(root.querySelector(".gq-step--gate")).toBeNull();
    expect(stageChild(root).classList.contains("gq-results")).toBe(true);
  });

  it("(8b/8c) storefront mode renders every template's intro, first visual question, lead and results; 'off' never renders a lead", async () => {
    const leadStep: Record<Tpl, boolean> = { t1: false, t2: true, t3: true, t4: false, t5: false };
    for (const t of TEMPLATES) {
      const intro = await boot(previewFor(t, "intro", false));
      expect(intro.querySelector(".gq-tpl-intro"), t).not.toBeNull();
      const q2 = await boot(previewFor(t, "q2", false));
      expect(q2.querySelectorAll(".gq-option-block button").length, t).toBe(3);
      const results = await boot(previewFor(t, "results", false));
      expect(results.querySelector(".gq-tpl-results"), t).not.toBeNull();
      if (leadStep[t]) {
        const lead = await boot(previewFor(t, "lead", false));
        expect(lead.querySelector(".gq-tpl-lead .gq-tpl-lead-form"), t).not.toBeNull();
        expect(lead.querySelector(".gq-tpl-skip"), t).not.toBeNull();
      }
      // 'off': answering the last question goes straight to the photo step
      // (try-on on here, so the step is shown), never a lead screen.
      const off = await boot(previewFor(t, "q5", false, { emailPlacement: "off", tryonEnabled: true }));
      (off.querySelector(".gq-option-block button") as HTMLElement).click();
      await wait(220 + SWAP);
      expect(off.querySelector(".gq-tpl-lead"), t).toBeNull();
      expect(stageChild(off).classList.contains("gq-step--gate"), t).toBe(true);
      const offResults = await boot(previewFor(t, "results", false, { emailPlacement: "off" }));
      expect(offResults.querySelector(".gq-tpl-lead-inline"), t).toBeNull();
    }
  });

  it("photo step off: the preview skips it on play-through, shows it marked Off only when opened", async () => {
    const gateOff = { gate: { ...(makeConfig("t5").gate as object), enabled: false } };
    // Play-through from the last question goes past the step.
    const played = await boot(previewFor("t5", "q5", false, { ...gateOff, emailPlacement: "off" }));
    (played.querySelector(".gq-option-block button") as HTMLElement).click();
    await wait(220 + SWAP);
    expect(stageChild(played).classList.contains("gq-step--gate"), "no gate on play-through").toBe(false);
    expect(played.querySelector(".gq-preview-off")).toBeNull();
    // The Studio opening the Photo & try-on slide still shows it, flagged.
    const opened = await boot(previewFor("t5", "gate", false, gateOff));
    expect(stageChild(opened).classList.contains("gq-step--gate")).toBe(true);
    expect(opened.querySelector(".gq-preview-off")).not.toBeNull();
    // Step on (and try-on on, so the template rule keeps it): no Off notice.
    const on = await boot(previewFor("t5", "gate", false, { tryonEnabled: true }));
    expect(on.querySelector(".gq-preview-off")).toBeNull();
  });

  it("(8d) the Match loading screen reaches results within 4s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      // Email below the match, so the last answer goes straight to loading.
      mount(previewFor("t1", "q5", false, { emailPlacement: "after_results" }));
      await vi.advanceTimersByTimeAsync(5);
      const root = document.getElementById("gleame-quiz-root")!;
      // No photo question + try-on off: the photo step is skipped, so the
      // last answer lands on the loading screen directly.
      (root.querySelector(".gq-t1-row") as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(220 + SWAP);
      expect(stageChild(root).classList.contains("gq-tpl-loading")).toBe(true);
      await vi.advanceTimersByTimeAsync(4000 + SWAP);
      expect(stageChild(root).classList.contains("gq-t1r")).toBe(true);
      expect(root.querySelectorAll(".gq-t1r").length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // 2026-10-18 Trello (Luna by Khush): with the photo step off, the last
  // answer showed the step's own spinner ("Bonus" header) and THEN the
  // Match loading screen. One loading screen, from the first frame.
  const loadersSeen = async (root: Element, ms: number) => {
    const seen = new Set<string>();
    for (let t = 0; t < ms; t += 20) {
      const child = stageChild(root);
      // The photo-step-off shell (a real photo step also carries gate-solo
      // when it has no shade rail, alongside gq-step--gate).
      if (child.classList.contains("gq-step--gate-solo") && !child.classList.contains("gq-step--gate")) seen.add("gate-shell");
      if (child.querySelector(".gq-working")) seen.add("step-spinner");
      if (child.classList.contains("gq-tpl-loading")) seen.add("tpl-loading");
      if (child.classList.contains("gq-t1r")) seen.add("results");
      await vi.advanceTimersByTimeAsync(20);
    }
    return seen;
  };

  it("photo step off: the last answer goes straight to the Match loading screen", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      mount({
        ...previewFor("t1", "q5", false, { emailPlacement: "after_results", gate: { ...(makeConfig("t1").gate as object), enabled: false } }),
        recommendUrl: "/preview-recommend",
      });
      await vi.advanceTimersByTimeAsync(5);
      // A real round trip takes time; instant answers hid the old shell.
      (window as any).fetch = () => new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve(makeSampleRecommend()),
      }), 1200));
      const root = document.getElementById("gleame-quiz-root")!;
      (root.querySelector(".gq-t1-row") as HTMLElement).click();
      const seen = await loadersSeen(root, 4600);
      expect([...seen]).toEqual(["tpl-loading", "results"]);
      expect(root.querySelectorAll(".gq-t1r").length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skipping the photo step goes straight to the Match loading screen", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      mount(previewFor("t1", "gate", false, { tryonEnabled: true, emailPlacement: "after_results" }));
      await vi.advanceTimersByTimeAsync(5);
      const root = document.getElementById("gleame-quiz-root")!;
      expect(stageChild(root).classList.contains("gq-step--gate")).toBe(true);
      (root.querySelector(".gq-skip-link") as HTMLElement).click();
      const seen = await loadersSeen(root, 4600);
      expect([...seen]).toEqual(["tpl-loading", "results"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(8e) merchant / catalog / shopper strings are always escaped", async () => {
    const XSS = '<img src=x onerror=1>';
    const flow = makeFlow();
    flow.questions[0].options[0].label = XSS + " Dry";
    (flow.questions[0].options[0] as any).displayMeta = { sublabel: XSS };
    const sample = makeSampleRecommend();
    sample.matches[0].productName = XSS + " Cream";
    sample.matches[0].reasons = [XSS + " reason"];
    const config = makeConfig("t3");
    (config.landing as any).headline = XSS;
    // An unescaped string would be PARSED into a real <img>: assert at the
    // DOM level (attribute values legitimately carry the raw text in alt="").
    const check = (root: Element, label: string) => {
      expect(root.querySelector("[onerror], img[src='x']"), label).toBeNull();
      const bad = Array.from(root.querySelectorAll("img")).filter((i) => !/^(https:|data:)/.test(i.getAttribute("src") || "https:"));
      expect(bad.length, label).toBe(0);
    };
    for (const t of TEMPLATES) {
      const q1 = await boot({ config: makeConfig(t), flow, sampleRecommend: sample, productJson: makeProductJson(), studio: false, overrides: { step: "q1" } });
      check(q1, t + " q1");
      const res = await boot({ config: makeConfig(t), flow, sampleRecommend: sample, productJson: makeProductJson(), studio: false, overrides: { step: "results" } });
      check(res, t + " results");
      expect(res.textContent, t).toContain(XSS);
    }
    const intro = await boot({ config, flow, sampleRecommend: sample, productJson: makeProductJson(), studio: false, overrides: { step: "intro" } });
    check(intro, "t3 intro");
    (intro.querySelector(".gq-tpl-begin") as HTMLElement).click();
    await wait(SWAP);
    const input = intro.querySelector(".gq-t3-name-input") as HTMLInputElement;
    input.value = XSS;
    input.dispatchEvent(new Event("input"));
    (intro.querySelector(".gq-t3-name-form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(SWAP);
    check(intro, "t3 greeting");
    expect(intro.querySelector(".gq-t3-q")!.textContent).toBe("Nice to meet you, " + XSS + ".");
  });

  it("Match loading screen: required, uses trust lines verbatim, then reaches results", async () => {
    const root = await boot({
      ...previewFor("t1", "q5", false, { emailPlacement: "after_results" }),
    });
    // Answer the last question (the photo step is skipped: no photo question,
    // try-on off) and the recommend round trip lands on the loading screen.
    (root.querySelector(".gq-t1-row") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 450));
    const loading = root.querySelector(".gq-tpl-loading");
    expect(loading).not.toBeNull();
    expect(loading!.querySelector(".gq-tpl-loading-rot")!.textContent).toBe("Made for every skin tone.");
  });
});

// Clean (t5) image cards (2026-10-16 Trello: "I uploaded images and put
// style as 'image cards'. Won't show up."). A visual question renders as a
// card grid unless the merchant picked a non-image answer style.
describe("Clean image cards", () => {
  type Flow = ReturnType<typeof makeFlow>;
  const cleanPreview = (step: string, studio: boolean, mutate?: (flow: Flow) => void, configOverrides: Record<string, unknown> = {}) => {
    const p = previewFor("t5", step, studio, configOverrides);
    if (mutate) mutate(p.flow);
    return p;
  };
  // EditPanel OPTION_STYLE_CHOICES minus "visual" (Image cards).
  const NON_IMAGE_STYLES = ["chips", "boxed", "list", "rich", "vibe", "nails"];
  const setStyle = (flow: Flow, qi: number, style: string) => {
    (flow.questions[qi] as Record<string, unknown>).optionStyle = style;
  };

  it("renders a visual question as image cards with the answer images", async () => {
    const root = await boot(cleanPreview("q2", false));
    expect(root.querySelector(".gq-t5-cards.gq-t5-cards--3")).not.toBeNull();
    expect(root.querySelectorAll(".gq-t5-bar").length).toBe(0);
    const cards = Array.from(root.querySelectorAll(".gq-t5-cards > .gq-t5-card"));
    expect(cards.map((c) => c.querySelector(".gq-t5-card-label")!.textContent)).toEqual(["Neutral", "Pink", "Yellow"]);
    expect(cards[1].querySelector(".gq-t5-card-slot.gq-slot--resolved img")!.getAttribute("src")).toBe(IMG + "pink.jpg");
    expect(cards[2].querySelector(".gq-t5-card-slot.gq-slot--resolved img")!.getAttribute("src")).toBe(IMG + "yellow.jpg");
    expect(cards[1].querySelector(".gq-t5-card-slot")!.getAttribute("data-slot-key")).toBe("answer:undertone:pink");
    // The answer without an image keeps the grid even: an initial block on
    // the storefront, never the Studio placeholder.
    expect(cards[0].querySelector(".gq-slot--initial")).not.toBeNull();
    expect(root.querySelectorAll(".gq-slot--placeholder").length).toBe(0);
    // Every card carries the bar's check for the selected state.
    expect(cards.every((c) => c.querySelector(".gq-t5-card-cap .gq-tpl-check"))).toBe(true);
    // One-word labels with no sublabel: three across on phones too.
    expect(root.querySelector(".gq-t5-cards--short")).not.toBeNull();
    // Text-only questions keep the bars.
    const q1 = await boot(cleanPreview("q1", false));
    expect(q1.querySelectorAll(".gq-t5-bar").length).toBe(4);
    expect(q1.querySelector(".gq-t5-cards")).toBeNull();
  });

  it("shows sublabels under the label, and swatch-only answers paint their swatch", async () => {
    const swatches = ["#e8c4a0", "#f2b8c6", "#f4d58d"];
    const root = await boot(
      cleanPreview("q2", false, (flow) => {
        flow.questions[1].options.forEach((o, i) => {
          Object.assign(o, { imageUrl: null, displayMeta: { swatch: swatches[i], sublabel: "Tone " + (i + 1) } });
        });
      }),
    );
    const cards = root.querySelectorAll(".gq-t5-card");
    expect(cards.length).toBe(3);
    const slot = cards[1].querySelector(".gq-t5-card-slot") as HTMLElement;
    expect(slot.classList.contains("gq-slot--color")).toBe(true);
    expect(slot.getAttribute("data-slot-kind")).toBe("swatch");
    expect(slot.style.background).toMatch(/242,\s*184,\s*198|#f2b8c6/i);
    expect(cards[1].querySelector(".gq-t5-card-desc")!.textContent).toBe("Tone 2");
    // Sublabels opt out of the phone's three-across short-label layout.
    expect(root.querySelector(".gq-t5-cards--short")).toBeNull();
  });

  it("an explicit non-image answer style keeps the bars; 'Image cards' or unset shows cards", async () => {
    for (const style of NON_IMAGE_STYLES) {
      const root = await boot(cleanPreview("q2", false, (flow) => setStyle(flow, 1, style)));
      expect(root.querySelectorAll(".gq-t5-bar").length, style).toBe(3);
      expect(root.querySelector(".gq-t5-cards"), style).toBeNull();
      expect(root.querySelectorAll(".gq-slot").length, style).toBe(0);
    }
    const visual = await boot(cleanPreview("q2", false, (flow) => setStyle(flow, 1, "visual")));
    expect(visual.querySelectorAll(".gq-t5-card").length).toBe(3);
    // 'Image cards' with no artwork at all has nothing to show: bars.
    const noArt = await boot(cleanPreview("q1", false, (flow) => setStyle(flow, 0, "visual")));
    expect(noArt.querySelectorAll(".gq-t5-bar").length).toBe(4);
  });

  it("Studio: unresolved cards are pickable slots, and the Images rail map wins", async () => {
    const studio = await boot(cleanPreview("q2", true));
    expect(studio.querySelectorAll(".gq-t5-card .gq-slot--resolved img").length).toBe(2);
    const ph = studio.querySelector(".gq-t5-card .gq-slot--placeholder") as HTMLElement;
    expect(ph).not.toBeNull();
    const msgs: any[] = [];
    const orig = window.parent.postMessage;
    (window.parent as any).postMessage = (m: any) => msgs.push(m);
    ph.click();
    (window.parent as any).postMessage = orig;
    expect(msgs.some((m) => m.type === "gleame:pick-slot" && m.slotKey === "answer:undertone:neutral")).toBe(true);
    // Picking an image from the placeholder must not answer the question.
    expect(studio.querySelector(".gq-t5-card.is-selected")).toBeNull();

    const railed = await boot(cleanPreview("q2", true, undefined, { imageSlots: { "answer:undertone:neutral": IMG + "rail.jpg" } }));
    expect(railed.querySelectorAll(".gq-t5-card .gq-slot--placeholder").length).toBe(0);
    expect(railed.querySelector(".gq-t5-card .gq-slot-img")!.getAttribute("src")).toBe(IMG + "rail.jpg");
  });

  it("clicking a card answers a single-select question and moves on", async () => {
    // Play through from Q1 so Back has a step to return to.
    const root = await boot(cleanPreview("q1", false));
    (root.querySelector(".gq-t5-bar") as HTMLElement).click();
    await wait(220 + SWAP);
    const card = root.querySelectorAll(".gq-t5-card")[2] as HTMLElement;
    card.click();
    expect(card.classList.contains("is-selected")).toBe(true);
    await wait(220 + SWAP);
    expect(root.querySelector(".gq-t5-count")!.textContent).toBe("3/5");
    // Back restores the pick on the card.
    (root.querySelector(".gq-tpl-back") as HTMLElement).click();
    await wait(220 + SWAP);
    const again = root.querySelectorAll(".gq-t5-card");
    expect(again.length).toBe(3);
    expect(again[2].classList.contains("is-selected")).toBe(true);
    expect(again[0].classList.contains("is-selected")).toBe(false);
  });

  it("multi-select cards honor max picks, the open-to-anything button, and Continue", async () => {
    const root = await boot(
      cleanPreview("q3", false, (flow) => {
        const q = flow.questions[2] as Record<string, any>;
        q.maxSelections = 2;
        q.options.forEach((o: Record<string, unknown>) => {
          o.imageUrl = IMG + o.axisValue + ".jpg";
        });
        q.options.push({ ...q.options[0], label: "Open to anything", imageUrl: null, selectAll: true, displayMeta: null });
      }),
    );
    const cards = Array.from(root.querySelectorAll(".gq-t5-cards > .gq-t5-card")) as HTMLElement[];
    expect(cards.length).toBe(4); // the select-all answer is never a card
    expect(root.querySelector(".gq-t5-cards--4")).not.toBeNull();
    expect(root.querySelector(".gq-tpl-multi")!.textContent).toBe("Select up to 2");
    const any = root.querySelector(".gq-option-block > .gq-tpl-any") as HTMLElement;
    expect(any).not.toBeNull();
    const cont = root.querySelector(".gq-tpl-continue") as HTMLButtonElement;
    expect(cont.disabled).toBe(true);

    cards[0].click();
    cards[1].click();
    cards[2].click(); // past the cap: ignored
    expect(cards.map((c) => c.classList.contains("is-selected"))).toEqual([true, true, false, false]);
    expect(cont.disabled).toBe(false);
    cards[1].click(); // deselecting is always allowed
    expect(cards.map((c) => c.classList.contains("is-selected"))).toEqual([true, false, false, false]);

    // Open to anything clears the cards; a card pick clears it again.
    any.click();
    expect(any.classList.contains("is-selected")).toBe(true);
    expect(cards.some((c) => c.classList.contains("is-selected"))).toBe(false);
    cards[3].click();
    expect(any.classList.contains("is-selected")).toBe(false);
    expect(cards[3].classList.contains("is-selected")).toBe(true);

    cont.click();
    await wait(220 + SWAP);
    expect(root.querySelector(".gq-t5-count")!.textContent).toBe("4/5");
  });
});
