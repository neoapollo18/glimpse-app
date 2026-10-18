// @vitest-environment jsdom
//
// Render smoke test for the Studio top bar, the restored Live tab with its
// setup guide (2026-10-16), the history modal, and the Matching panel that
// replaced the Quiz settings page. Studio itself needs an embedded Shopify session, so these mount in
// a memory data router (useFetcher needs one) inside Polaris' AppProvider.

import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";

vi.mock("../use-catalog-sync", () => ({
  useCatalogSync: () => ({ progress: null, busy: false, syncError: null, start: () => {} }),
}));

import { StudioTopBar } from "../../components/studio/StudioTopBar";
import { LiveTab, SETUP_VIDEO_ID, VersionHistoryModal } from "../../components/studio/PublishStep";
import { MatchSettingsEditor, type MatchSettings } from "../../components/studio/MatchSettingsEditor";
import { TextLabelsEditor } from "../../components/studio/TextLabelsEditor";
import { ResultsEditor } from "../../components/studio/SettingsEditors";
import { ProductWhyEditor } from "../../components/studio/ProductWhyEditor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // Polaris measures layout; jsdom lacks these.
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo ||= () => {};
});

function studioData(overrides: Record<string, unknown> = {}) {
  return {
    shopDomain: "review-store.myshopify.com",
    quizSurfaceEnabled: true,
    previewToken: "tok",
    versions: [
      { id: "v2", label: "before restore", createdBy: "system", createdAt: "2026-10-15T10:00:00Z" },
      { id: "v1", label: "auto-snapshot", createdBy: "system", createdAt: "2026-10-14T09:00:00Z" },
    ],
    draft: {
      settings: { recommendation_mode: "hybrid" },
      flow: { questions: [{}, {}, {}], rules: [] },
    },
    studio: { template: null, templatesLive: true, templateServed: true },
    ...overrides,
  } as any;
}

function mount(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const router = createMemoryRouter([{ path: "/", element: <AppProvider i18n={en}>{ui}</AppProvider>, action: async () => ({ ok: true }) }]);
  const root = createRoot(host);
  act(() => root.render(<RouterProvider router={router} />));
  return { text: () => document.body.textContent ?? "", root };
}

describe("Studio top bar and Live tab", () => {
  const topBar = (live: boolean, hostActions = false) => (
    <StudioTopBar
      tab="build"
      onTabChange={() => {}}
      quizName="Find Your Vibe"
      onQuizNameChange={() => {}}
      hasDraft
      problemCount={0}
      catalog={{ syncEnabled: true, cursor: null, productCount: 10 }}
      onViewStore={() => {}}
      viewStoreBusy={false}
      onPublishClick={() => {}}
      live={live}
      hostActions={hostActions}
    />
  );
  const liveTab = (data: any) => (
    <LiveTab data={data} quizName="Find Your Vibe" onOpenPublish={() => {}} onOpenHistory={() => {}} onViewStore={() => {}} viewStoreBusy={false} />
  );

  it("top bar: Build / Check matches / Live tabs, a Live or Ready badge, View and Publish", () => {
    const on = mount(topBar(true));
    // Polaris segmented buttons: fixed order, only the pressed one changes.
    const tabs = Array.from(document.querySelectorAll(".studio-step-tabs button"));
    expect(tabs.map((b) => b.textContent)).toEqual(["Build", "Check matches", "Live"]);
    expect(tabs.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(on.text()).toContain("View on my store");
    expect(on.text()).toContain("Publish");
    expect(on.text()).not.toContain("Ready");
    const off = mount(topBar(false));
    expect(off.text()).toContain("Ready");
  });

  it("inside the dashboard's app window, Publish and View on my store move to the admin title bar", () => {
    const hosted = mount(topBar(true, true));
    expect(hosted.text()).not.toContain("View on my store");
    expect(hosted.text()).not.toContain("Publish");
    // The quiz name and status stay in the Studio header.
    expect((document.querySelector('input[aria-label="Quiz name"]') as HTMLInputElement).value).toBe("Find Your Vibe");
    expect(hosted.text()).toContain("Live");
  });

  it("ready quiz: Turn on, one-click Publish, the video and the four setup steps", () => {
    const { text } = mount(liveTab(studioData({ quizSurfaceEnabled: false })));
    expect(text()).toContain("Your quiz is ready. Add it to your store.");
    expect(text()).toContain("Turn on");
    expect(text()).toContain("Prefer one click?");
    for (const step of ["Create the quiz template", "Create the quiz page", "Add it to your menu", "Check it on your store"]) {
      expect(text(), step).toContain(step);
    }
    expect(text()).toContain("Title it Find Your Vibe");
    const links = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("https://admin.shopify.com/store/review-store/themes/current/editor?template=page");
    expect(links).toContain("https://admin.shopify.com/store/review-store/pages/new");
    expect(links).toContain("https://admin.shopify.com/store/review-store/menus");
    expect(links).toContain(`https://youtu.be/${SETUP_VIDEO_ID}`);
    // The YouTube player loads only on click.
    expect(document.querySelector("iframe")).toBeNull();
    act(() => (document.querySelector('[aria-label="Play the setup video"]') as HTMLButtonElement).click());
    expect(document.querySelector("iframe")!.getAttribute("src")).toContain(`youtube-nocookie.com/embed/${SETUP_VIDEO_ID}`);
  });

  it("live quiz: Turn off, setup collapsed to 'Setup complete' until asked, history and placements", () => {
    const { text } = mount(liveTab(studioData()));
    expect(text()).toContain("Your quiz is live on your store");
    expect(text()).toContain("Turn off");
    expect(text()).toContain("3 questions");
    expect(text()).toContain("Rules + AI matching");
    expect(text()).toContain("Setup complete");
    expect(text()).not.toContain("Create the quiz template");
    const show = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Show setup steps")!;
    act(() => show.click());
    expect(text()).toContain("Create the quiz template");
    expect(text()).toContain("Hide steps");
    expect(text()).toContain("View 2 versions");
    expect(text()).toContain("Placement settings in the theme editor");
  });

  it("a pending template offers Put template live", () => {
    const { text } = mount(liveTab(studioData({ studio: { template: "t1", templatesLive: true, templateServed: false } })));
    expect(text()).toContain("Put template live");
  });

  it("version history lists restore points with Preview and Restore", () => {
    const { text } = mount(<VersionHistoryModal data={studioData()} open onClose={() => {}} />);
    expect(text()).toContain("Version history");
    expect(text()).toContain("Before restore");
    expect(text()).toContain("Auto-saved");
    expect(Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Restore")).toHaveLength(2);
    expect(Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Preview")).toHaveLength(2);
  });
});

describe("Matching panel (moved from the Quiz settings page)", () => {
  const initial: MatchSettings = {
    numRecommendations: 6,
    productScope: "selected",
    selectedProductIds: ["p1"],
    recommendationMode: "hybrid",
    aiGuidance: "Bestsellers first",
    priorityProductIds: [],
    tuning: {
      colorFilter: "off",
      mismatchGuard: true,
      priorityStyle: "boost",
      priorityBoostSlots: 3,
      rankerModel: "flash",
      productDiversity: true,
      llmReasons: false,
      maxLlmCandidates: 200,
    },
    photoFrameHint: "",
  };

  it("renders every setting the old page had", () => {
    const { text } = mount(
      <MatchSettingsEditor
        initial={initial}
        products={[{ id: "p1", product_name: "Red Flare" }, { id: "p2", product_name: "Golden Hour" }]}
        chatBusy={false}
        onPreviewReload={() => {}}
      />,
    );
    for (const label of [
      "Number of matches: 6",
      "Which products can be recommended?",
      "Ranking mode",
      "Recommendation logic (advanced text)",
      "Color matching filter",
      "Mismatch guard",
      "Priority style",
      "Boost strength: 3 positions",
      "AI model",
      "Priority products",
    ]) {
      expect(text(), label).toContain(label);
    }
    // Scope "selected": both products listed for scope; only the selected
    // one is eligible for priority.
    expect(text().match(/Red Flare/g)).toHaveLength(2);
    expect(text().match(/Golden Hour/g)).toHaveLength(1);
  });
});

describe("Text & labels, results buttons, why this fits (2026-10-16)", () => {
  it("Text & labels lists strings pre-filled with defaults, overrides marked with Reset", () => {
    const { text } = mount(
      <TextLabelsEditor
        settings={{ quiz_ui_text: { back: "Retour" }, quiz_view_product_label: "Découvrir la ressource" }}
        template={null}
        chatBusy={false}
        onPreviewUpdate={() => {}}
      />,
    );
    expect(text()).toContain("Text & labels");
    expect(text()).toContain("Buttons & navigation");
    const inputs = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
    const byLabel = (label: string) => {
      const lab = Array.from(document.querySelectorAll("label")).find((l) => l.textContent === label);
      return inputs.find((i) => i.id === lab?.getAttribute("for"));
    };
    expect(byLabel("Start button")?.value).toBe("Start the quiz");
    expect(byLabel("Back button")?.value).toBe("Retour");
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Reset")).toBe(true);
    // Template-only strings stay out of a classic quiz.
    expect(text()).not.toContain("Template text");
  });

  it("template quizzes get their own defaults and template text", () => {
    const { text } = mount(<TextLabelsEditor settings={{}} template="t4" chatBusy={false} onPreviewUpdate={() => {}} />);
    const lab = Array.from(document.querySelectorAll("label")).find((l) => l.textContent === "Next button");
    const input = document.getElementById(lab!.getAttribute("for")!) as HTMLInputElement;
    expect(input.value).toBe("Next");
    expect(text()).toContain("Template text");
  });

  it("Results: main button choice and the secondary link", () => {
    const add = mount(<ResultsEditor settings={{}} chatBusy={false} onPreviewUpdate={() => {}} />);
    expect(add.text()).toContain("Main button");
    expect(add.text()).toContain("Also show a “View product” link");
    const view = mount(<ResultsEditor settings={{ quiz_results_primary_cta: "view" }} chatBusy={false} onPreviewUpdate={() => {}} />);
    expect(view.text()).toContain("Also show an “Add to cart” link");
    expect(view.text()).toContain("The button opens the product page");
  });

  it("Why this fits: one optional line per product, existing lines first", () => {
    const P1 = "11111111-1111-4111-8111-111111111111";
    const P2 = "22222222-2222-4222-8222-222222222222";
    const { text } = mount(
      <ProductWhyEditor
        products={[
          { id: P1, name: "Aurora Bible", imageUrl: null },
          { id: P2, name: "Coeur à coeur", imageUrl: null },
        ]}
        initial={{ [P2]: "Un journal pour prier" }}
        chatBusy={false}
        onPreviewUpdate={() => {}}
      />,
    );
    expect(text()).toContain("Why this fits");
    expect(text()).toContain("1 of 2 products have a line.");
    const inputs = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
    expect(inputs[0].value).toBe("Un journal pour prier");
    expect(inputs[1].value).toBe("");
  });
});

describe("Translate this quiz", () => {
  it("offers a language, tone and the content checkbox above the labels", () => {
    const { text } = mount(<TextLabelsEditor settings={{}} template={null} chatBusy={false} onPreviewUpdate={() => {}} />);
    expect(text()).toContain("Translate this quiz");
    expect(text()).toContain("Translate into French");
    expect(text()).toContain("Also translate headlines, questions, answers and why-this-fits lines");
    const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual(["French", "informal"]);
  });
});
