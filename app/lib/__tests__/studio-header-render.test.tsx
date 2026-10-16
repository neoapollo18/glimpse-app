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
  const topBar = (live: boolean) => (
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
    />
  );
  const liveTab = (data: any) => (
    <LiveTab data={data} quizName="Find Your Vibe" onOpenPublish={() => {}} onOpenHistory={() => {}} onViewStore={() => {}} viewStoreBusy={false} />
  );

  it("top bar: Build / Check matches / Live tabs, a Live or Ready badge, View and Publish", () => {
    const on = mount(topBar(true));
    const tabs = Array.from(document.querySelectorAll(".studio-step-pill")).map((b) => b.textContent);
    expect(tabs).toEqual(["Build", "Check matches", "Live"]);
    expect(on.text()).toContain("View on my store");
    expect(on.text()).toContain("Publish");
    expect(on.text()).not.toContain("Ready");
    const off = mount(topBar(false));
    expect(off.text()).toContain("Ready");
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
