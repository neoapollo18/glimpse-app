// @vitest-environment jsdom
//
// Render smoke test for the Studio pieces that replaced the Live tab and
// the Quiz settings page (2026-10-15): the top bar with its Live/Off status
// menu and version history button, the history modal, and the Matching
// panel. Studio itself needs an embedded Shopify session, so these mount in
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
import { LiveStatusControl, VersionHistoryModal } from "../../components/studio/PublishStep";
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

describe("Studio header (Live tab folded into the top bar)", () => {
  it("has no Live tab; status menu, history button, View and Publish sit on the right", () => {
    const data = studioData();
    const { text } = mount(
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
        liveControl={
          <LiveStatusControl data={data} open={false} onToggle={() => {}} onClose={() => {}} onOpenPublish={() => {}} onOpenHistory={() => {}} />
        }
        hasVersions
        onOpenHistory={() => {}}
        onTemplatePendingClick={() => {}}
      />,
    );
    const tabs = Array.from(document.querySelectorAll(".studio-step-pill")).map((b) => b.textContent);
    expect(tabs).toEqual(["Build", "Check matches"]);
    expect(document.querySelector('[aria-label="Quiz status: Live"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Version history"]')).not.toBeNull();
    expect(text()).toContain("View on my store");
    expect(text()).toContain("Publish");
  });

  it("open status menu: store link, Turn off, history and placement links", () => {
    const { text } = mount(
      <LiveStatusControl data={studioData()} open onToggle={() => {}} onClose={() => {}} onOpenPublish={() => {}} onOpenHistory={() => {}} />,
    );
    expect(text()).toContain("review-store.myshopify.com/pages/find-my-match");
    expect(text()).toContain("Turn off");
    expect(text()).toContain("3 questions");
    expect(text()).toContain("Rules + AI matching");
    expect(text()).toContain("Version history");
    expect(text()).toContain("Placement settings");
  });

  it("an off quiz offers Turn on and first publish; a pending template offers Put template live", () => {
    const off = mount(
      <LiveStatusControl data={studioData({ quizSurfaceEnabled: false })} open onToggle={() => {}} onClose={() => {}} onOpenPublish={() => {}} onOpenHistory={() => {}} />,
    );
    expect(off.text()).toContain("Turn on");
    expect(off.text()).toContain("Publish for the first time");
    const pending = mount(
      <LiveStatusControl
        data={studioData({ studio: { template: "t1", templatesLive: true, templateServed: false } })}
        open
        onToggle={() => {}}
        onClose={() => {}}
        onOpenPublish={() => {}}
        onOpenHistory={() => {}}
      />,
    );
    expect(pending.text()).toContain("Put template live");
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
