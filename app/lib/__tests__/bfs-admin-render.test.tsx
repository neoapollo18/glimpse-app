// @vitest-environment jsdom
//
// Built for Shopify design fixes (2026-10-17): the home page is plain
// Polaris with one primary action and no popup on load, the setup offer is a
// dismissible card, the retired chat bubble is gone from the storefront
// control, the home numbers are the Analytics page's shopper counts, the
// Studio's publish flow is a Polaris modal with its actions in the modal
// slots, in-body buttons never compete with Publish, and the canvas shows
// one banner at a time. The dashboard's relay for opted-in shops' Studios
// (title bar actions and save bar on the app window) is covered at the end.
// Server modules are mocked; route data comes through a memory data router.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider, Banner } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";

vi.mock("../../shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("../supabase.server", () => ({
  supabase: {},
  getRecommendationCounts: vi.fn(),
  getChatAssistantConfig: vi.fn(),
  findShopByDomain: vi.fn(),
  shopHasTryOnConfig: vi.fn(),
  getConfiguredProducts: vi.fn(),
  getQuizEngagement: vi.fn(),
  getOnboardingState: vi.fn(),
}));
vi.mock("../setup-offer.server", () => ({ shouldOfferSetup: vi.fn() }));
vi.mock("../quiz-dashboard.server", () => ({ getQuizFunnelSummary: vi.fn() }));
vi.mock("../use-catalog-sync", () => ({
  useCatalogSync: () => ({ progress: null, busy: false, syncError: null, start: () => {} }),
}));
// No App Bridge host in jsdom: an empty, stable global (no app.extensions,
// no scopes, no toast), as window.shopify is one object in the admin.
// Everything else is the real library.
vi.mock("@shopify/app-bridge-react", async (orig) => {
  const shopify = {};
  return { ...(await orig<typeof import("@shopify/app-bridge-react")>()), useAppBridge: () => shopify };
});

import Dashboard from "../../routes/app._index";
import { SetupOfferCard } from "../../components/SetupOfferModal";
import { LiveTab, PublishSheet } from "../../components/studio/PublishStep";
import { MatchSettingsEditor, type MatchSettings } from "../../components/studio/MatchSettingsEditor";
import { NoticeSlot } from "../../components/studio/StudioNotices";
import { TemplateGallery } from "../../components/studio/TemplateGallery";
import { MatchesCenter, useMatchesState, type MatchingData } from "../../components/studio/MatchesTab";
import { STUDIO_NAV_CHANNEL, onStudioAction, postStudioState } from "../../components/studio/navigate-parent";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo = () => {};
  (window as any).scroll = () => {};
  // App Bridge defines <ui-modal> in the admin: a stand-in that can show,
  // hide and say so, like the real one.
  if (!customElements.get("ui-modal")) {
    customElements.define(
      "ui-modal",
      class extends HTMLElement {
        show() {
          this.setAttribute("data-open", "true");
          return Promise.resolve();
        }
        hide() {
          if (!this.hasAttribute("data-open")) return Promise.resolve();
          this.removeAttribute("data-open");
          this.dispatchEvent(new Event("hide"));
          return Promise.resolve();
        }
      },
    );
  }
  // App Bridge defines <ui-save-bar> in the admin; a stand-in that records
  // whether it is showing.
  if (!customElements.get("ui-save-bar")) {
    customElements.define(
      "ui-save-bar",
      class extends HTMLElement {
        show() {
          this.setAttribute("data-showing", "true");
          return Promise.resolve();
        }
        hide() {
          this.removeAttribute("data-showing");
          return Promise.resolve();
        }
      },
    );
  }
});

let root: Root | null = null;
let posts: Array<Record<string, string>> = [];
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  posts = [];
});

async function mount(element: React.ReactElement, loaderData?: unknown, url = "/") {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const action = async ({ request }: { request: Request }) => {
    const fd = await request.formData();
    const entry: Record<string, string> = {};
    fd.forEach((v, k) => (entry[k] = String(v)));
    posts.push(entry);
    return { ok: true };
  };
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppProvider i18n={en}>{element}</AppProvider>,
        loader: loaderData === undefined ? undefined : async () => loaderData,
        action,
      },
      { path: "/app/api/setup-offer", action },
      { path: "/studio", action },
    ],
    { initialEntries: [url] },
  );
  root = createRoot(host);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return () => document.body.textContent ?? "";
}

const buttons = () => Array.from(document.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);
const primaries = () => Array.from(document.querySelectorAll(".Polaris-Button--variantPrimary")).map((b) => b.textContent?.trim());
const click = async (el: Element | undefined) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 20));
  });
};

function studioData(overrides: Record<string, unknown> = {}) {
  return {
    shopDomain: "review-store.myshopify.com",
    apiKey: "key",
    quizSurfaceEnabled: false,
    previewToken: "tok",
    versions: [],
    catalog: { syncEnabled: true, cursor: null, productCount: 12 },
    draft: {
      settings: { recommendation_mode: "ai", ai_guidance: "Bestsellers first" },
      flow: { questions: [{ axisKey: "vibe", prompt: "Vibe?", options: [] }], rules: [] },
    },
    studio: { template: null, templatesLive: true, templateServed: true },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------

describe("home page", () => {
  const home = (quiz: Record<string, unknown> = {}, setupOffer = true) => ({
    shopDomain: "review-store.myshopify.com",
    ownerName: "Ada Lovelace",
    quiz: { questions: 4, rules: 0, mode: "ai", hasGuidance: true, assistantMode: "chat", quizLive: false, vtoEnabled: false, ...quiz },
    totalTransformations: 0,
    quizStats: { started: 60, finished: 45, added: 9, truncated: false } as Record<string, unknown> | null,
    setupOffer: { show: setupOffer, email: "owner@example.com" },
  });

  it("is plain Polaris: one primary action, no custom hero, no popup on load", async () => {
    const text = await mount(<Dashboard />, home());
    expect(text()).toContain("Welcome back, Ada");
    expect(document.querySelector(".gleame-hero")).toBeNull();
    expect(primaries()).toEqual(["Open Studio"]);
    // The setup offer is a card on the page; no modal is open.
    expect(text()).toContain("Want us to set up your quiz for you?");
    expect(document.querySelector(".Polaris-Modal-Dialog__Modal")).toBeNull();
  });

  it("with the chat bubble retired, going live is one Show quiz to shoppers button", async () => {
    const text = await mount(<Dashboard />, home());
    expect(text()).not.toContain("Chat bubble");
    expect(document.querySelector("select")).toBeNull();
    await click(button("Show quiz to shoppers"));
    expect(posts).toContainEqual({ intent: "set-mode", assistant_mode: "quiz" });
  });

  it("shows the Analytics page's 30-day shopper numbers and says when the theme couldn't be checked", async () => {
    const text = await mount(<Dashboard />, home());
    expect(text()).toContain("Last 30 days");
    // Distinct shoppers, as Analytics' "Shoppers who started" and
    // "Reached their matches" count them.
    expect(text()).toContain("60 shoppers started");
    expect(text()).toContain("75% reached their matches · 9 added to cart");
    expect(text()).toContain("Theme not checked");
  });

  it("never shows a rate over 100%, and says so when the numbers couldn't load", async () => {
    const over = await mount(<Dashboard />, { ...home(), quizStats: { started: 4, finished: 5, added: 1, truncated: false } });
    expect(over()).toContain("100% reached their matches");
    act(() => root?.unmount());
    // The stats card shows once the quiz is live (or has starts).
    const missing = await mount(<Dashboard />, { ...home({ quizLive: true, assistantMode: "quiz" }, false), quizStats: null });
    expect(missing()).toContain("Couldn’t load your numbers. They’re in Analytics.");
  });

  it("hides the stats until the quiz is live or has starts", async () => {
    const text = await mount(<Dashboard />, { ...home(), quizStats: { started: 0, finished: 0, added: 0, truncated: false } });
    expect(text()).not.toContain("shoppers started");
    expect(text()).not.toMatch(/\d+ questions?\b/);
  });

  it("a live quiz shows its storefront state, not a chooser", async () => {
    const text = await mount(<Dashboard />, home({ quizLive: true, assistantMode: "quiz" }, false));
    expect(text()).toContain("Quiz on");
    expect(text()).not.toContain("Make it live");
    expect(text()).not.toContain("Want us to set up");
  });
});

describe("setup offer card", () => {
  it("opens the form only on request; Not now keeps the card; dismiss records it", async () => {
    const text = await mount(<SetupOfferCard defaultEmail="owner@example.com" source="onboarding" />);
    expect(document.querySelector(".Polaris-Modal-Dialog__Modal")).toBeNull();
    await click(button("Get free setup help"));
    expect(document.querySelector(".Polaris-Modal-Dialog__Modal")).not.toBeNull();
    expect(button("Not now")).toBeTruthy();
    expect(text()).not.toContain("No thanks");
    await click(button("Not now"));
    expect(posts).toEqual([]);
    expect(text()).toContain("Get free setup help");
    await click(document.querySelector('button[aria-label="Dismiss"]') ?? undefined);
    expect(posts).toContainEqual({ intent: "dismiss", source: "onboarding" });
    expect(text()).not.toContain("Get free setup help");
  });
});

describe("Studio publish flow", () => {
  it("Publish is a Polaris modal with its actions in the footer slots", async () => {
    const text = await mount(<PublishSheet data={studioData()} problems={[]} open onClose={() => {}} onFix={() => {}} />);
    const dialog = document.querySelector(".Polaris-Modal-Dialog__Modal")!;
    expect(dialog).not.toBeNull();
    expect(text()).toContain("Publish your quiz");
    expect(text()).toContain("Before it goes live");
    // Icons, not glyphs, in the checklist.
    expect(text()).not.toMatch(/[✓✕]/);
    expect(primaries()).toEqual(["Publish"]);
    expect(button("Cancel")).toBeTruthy();
  });

  // bsdhaus (kpfu0s-11, 2026-10-18): matrix mode, no matrix rules, matched
  // by Check matches sentences. The sheet warned "No matching set up yet"
  // and Show to shoppers was disabled.
  const sentencesOnly = (ready: boolean) =>
    studioData({
      draft: {
        settings: { recommendation_mode: "matrix", ai_guidance: "" },
        flow: { questions: [{ axisKey: "vibe", prompt: "Vibe?", options: [] }], rules: [] },
      },
      matchingReady: { ready, sources: ready ? ["answers"] : [] },
    });

  it("counts Check matches sentences as matching", async () => {
    const text = await mount(<PublishSheet data={sentencesOnly(true)} problems={[]} open onClose={() => {}} onFix={() => {}} />);
    expect(text()).toContain("Matching is set up");
    expect(text()).not.toContain("No matching set up yet");
  });

  it("re-reads matching when it opens, so a sentence saved seconds ago counts", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ok: true, ready: true, sources: ["answers"] }), { headers: { "Content-Type": "application/json" } });
    });
    try {
      const text = await mount(<PublishSheet data={sentencesOnly(false)} problems={[]} open onClose={() => {}} onFix={() => {}} />);
      expect(calls).toContain("/app/api/matching-readiness");
      expect(text()).toContain("Matching is set up");
      expect(text()).not.toContain("No matching set up yet");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Shopify App Review (2026-10-22): Publish no longer writes a script into
  // the page. With the block not on the page yet, the sheet sends the
  // merchant to the theme editor with the block ready to add, then Finish.
  it("after Publish, walks the merchant to add the quiz block before calling it live", async () => {
    const publishes: Array<Record<string, string>> = [];
    let blockOnPage = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url) === "/app/api/publish-quiz") {
        const entry: Record<string, string> = {};
        (init!.body as FormData).forEach((v, k) => (entry[k] = String(v)));
        publishes.push(entry);
        return Response.json({
          ok: true,
          liveUrl: "https://review-store.myshopify.com/pages/find-my-match",
          quizOnPage: blockOnPage,
          pageTemplate: "page.find-my-match",
        });
      }
      return Response.json({ ok: true, ready: true });
    });
    try {
      const text = await mount(<PublishSheet data={studioData()} problems={[]} open onClose={() => {}} onFix={() => {}} />);
      await click(button("Publish"));
      expect(publishes[0]).toMatchObject({ intent: "publish", addToMenu: "true" });
      expect(text()).toContain("Add the quiz to your page");
      expect(text()).not.toContain("Your quiz is live");
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Add the quiz block");
      expect(link?.getAttribute("href")).toBe(
        "https://admin.shopify.com/store/review-store/themes/current/editor?template=page.find-my-match&addAppBlockId=key/gleame-quiz&target=newAppsSection",
      );
      expect(primaries()).toEqual(["Finish"]);

      // Finish before the block is added says so.
      await click(button("Finish"));
      expect(text()).toContain("isn’t on the page yet");

      blockOnPage = true;
      await click(button("Finish"));
      expect(publishes).toHaveLength(3);
      expect(text()).toContain("Your quiz is live");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still warns when nothing matches, and keeps the loader's answer if the re-read fails", async () => {
    const text = await mount(<PublishSheet data={sentencesOnly(false)} problems={[]} open onClose={() => {}} onFix={() => {}} />);
    expect(text()).toContain("No matching set up yet");
  });

  it("Show to shoppers is enabled for a quiz matched by sentences", async () => {
    await mount(
      <LiveTab data={sentencesOnly(true)} quizName="Find the tile" onOpenPublish={() => {}} onOpenHistory={() => {}} onViewStore={() => {}} viewStoreBusy={false} />,
    );
    expect(button("Show to shoppers")?.getAttribute("aria-disabled")).not.toBe("true");
    expect(document.body.textContent).not.toContain("Pin products to answer paths");
  });

  it("the Live tab re-reads matching too, so sentences written since load count", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ ok: true, ready: true, sources: ["answers"] }), { headers: { "Content-Type": "application/json" } }));
    try {
      await mount(
        <LiveTab data={sentencesOnly(false)} quizName="Find the tile" onOpenPublish={() => {}} onOpenHistory={() => {}} onViewStore={() => {}} viewStoreBusy={false} />,
      );
      expect(button("Show to shoppers")?.getAttribute("aria-disabled")).not.toBe("true");
      expect(document.body.textContent).not.toContain("Pin products to answer paths");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Show to shoppers stays off for a quiz with nothing to match on", async () => {
    await mount(
      <LiveTab data={sentencesOnly(false)} quizName="Find the tile" onOpenPublish={() => {}} onOpenHistory={() => {}} onViewStore={() => {}} viewStoreBusy={false} />,
    );
    expect(button("Show to shoppers")?.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("Pin products to answer paths");
  });

  it("the Live tab body has no primary buttons (the title bar's Publish is the page's one)", async () => {
    await mount(
      <LiveTab data={studioData()} quizName="Find Your Vibe" onOpenPublish={() => {}} onOpenHistory={() => {}} onViewStore={() => {}} viewStoreBusy={false} />,
    );
    expect(button("Show to shoppers")).toBeTruthy();
    expect(primaries()).toEqual([]);
  });

  it("template cards use secondary buttons and a Polaris close", async () => {
    await mount(
      <TemplateGallery
        previewToken="tok"
        currentTemplate="t1"
        eligible={["t1", "t2", "t3", "t4", "t5"] as any}
        flow={null}
        busy={false}
        onUse={() => {}}
        onKeep={() => {}}
        onFixImages={() => {}}
        onClose={() => {}}
      />,
    );
    expect(buttons().filter((b) => b.textContent === "Use this template").length).toBeGreaterThan(0);
    expect(primaries()).toEqual([]);
    expect(document.querySelector('button[aria-label="Close templates"]')).not.toBeNull();
  });
});

describe("Check matches overview", () => {
  // Stable references, as the Studio's loader data is: the hook re-seeds
  // its state whenever `matching` changes identity.
  const matching: MatchingData = {
    rules: [],
    global: { always: [], never: [] },
    needsDraft: false,
    stale: false,
    hasDisplayOnly: false,
    liveProductCount: 10,
    emptyCombination: null,
    error: "timeout",
  };
  const questions = [{ axisKey: "vibe", prompt: "Vibe?", options: [{ axisValueValue: "bold", label: "Bold" }] }];
  function Harness() {
    const state = useMatchesState(matching, questions);
    return <MatchesCenter state={state} matching={matching} selection="overview" onSelect={() => {}} theme={{} as any} onPublish={() => {}} />;
  }

  it("keeps Publish secondary and shows load errors as a red banner", async () => {
    const text = await mount(<Harness />);
    expect(button("Publish")).toBeTruthy();
    expect(primaries()).toEqual([]);
    const banner = document.querySelector(".Polaris-Banner");
    expect(banner?.textContent).toContain("Couldn't load matching: timeout");
    expect(text()).not.toMatch(/[✓]/);
  });
});

describe("Matching settings, admin bars off (every shop by default)", () => {
  const initial: MatchSettings = {
    numRecommendations: 6,
    productScope: "all_configured",
    selectedProductIds: [],
    recommendationMode: "hybrid",
    aiGuidance: "",
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

  it("an edit shows the in-body Save, which posts only the changed field; no save bar", async () => {
    await mount(<MatchSettingsEditor initial={initial} products={[]} chatBusy={false} onPreviewReload={() => {}} />);
    expect(button("Save matching settings")).toBeUndefined();
    const select = Array.from(document.querySelectorAll("select")).find((s) => s.value === "hybrid")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "ai");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.querySelector("ui-save-bar")).toBeNull();
    await click(button("Save matching settings"));
    expect(posts).toContainEqual({ intent: "save-match-settings", patch: JSON.stringify({ recommendation_mode: "ai" }) });
  });
});

describe("Studio banner slot", () => {
  it("shows one notice, most urgent first", async () => {
    const text = await mount(
      <NoticeSlot
        notices={[
          false,
          { key: "warning", node: <Banner tone="warning">Template not live</Banner> },
          { key: "info", node: <Banner tone="info">Built from your catalog.</Banner> },
        ]}
      />,
    );
    expect(document.querySelectorAll(".Polaris-Banner")).toHaveLength(1);
    expect(text()).toContain("Template not live");
    expect(text()).not.toContain("Built from your catalog.");
  });
});

// ---------------------------------------------------------------------
// Admin bars (per-shop opt-in): the dashboard hangs the Studio's title bar
// actions and save bar on the app window and relays the clicks.
// ---------------------------------------------------------------------

describe("dashboard relay for an opted-in Studio", () => {
  const home = {
    shopDomain: "review-store.myshopify.com",
    ownerName: "Ada Lovelace",
    quiz: { questions: 4, rules: 0, mode: "ai", hasGuidance: true, assistantMode: "quiz", quizLive: true, vtoEnabled: false },
    totalTransformations: 0,
    quizStats: null,
    setupOffer: { show: false, email: "" },
  };
  let channel: BroadcastChannel | null = null;
  let heard: Array<Record<string, unknown>> = [];
  afterEach(() => {
    channel?.close();
    channel = null;
    heard = [];
    vi.restoreAllMocks();
  });
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
  // The Studio's side of the channel, as a test double.
  const studio = () => {
    channel = new BroadcastChannel(STUDIO_NAV_CHANNEL);
    channel.onmessage = (e) => heard.push(e.data);
    const modal = document.querySelector("ui-modal")!;
    const token = new URL(modal.getAttribute("src")!, "https://x").searchParams.get("navtoken")!;
    return {
      token,
      report: async (state: Record<string, unknown>, as = token) => {
        channel!.postMessage({ type: "studio-state", token: as, ...state });
        await settle();
      },
    };
  };
  const titleButtons = () => Array.from(document.querySelectorAll("ui-modal ui-title-bar button")).map((b) => b.textContent);
  const state = { showPublish: true, showViewStore: true, viewStoreDisabled: false, storeUrl: null, dirty: false, saving: false };

  it("shows nothing until the Studio reports, and ignores another tab's Studio", async () => {
    await mount(<Dashboard />, home, "/?open=studio");
    expect(document.querySelector("ui-modal")).not.toBeNull();
    expect(titleButtons()).toEqual([]);
    const s = studio();
    await s.report(state, "someone-else");
    expect(titleButtons()).toEqual([]);
    await s.report(state);
    expect(titleButtons()).toEqual(["View on my store", "Publish"]);
    expect(document.querySelector("ui-modal ui-save-bar")).toBeNull();
  });

  it("relays Publish, and hangs the save bar on the modal while the Studio is dirty", async () => {
    await mount(<Dashboard />, home, "/?open=studio");
    const s = studio();
    await s.report(state);
    await click(document.querySelector('ui-modal ui-title-bar button[variant="primary"]') ?? undefined);
    await settle();
    expect(heard).toContainEqual({ type: "studio-action", token: s.token, action: "publish" });

    await s.report({ ...state, dirty: true });
    const bar = document.querySelector("ui-modal > ui-save-bar")!;
    expect(bar).not.toBeNull();
    expect(bar.hasAttribute("discardconfirmation")).toBe(true);
    await click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Save"));
    await click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Discard"));
    await settle();
    expect(heard.map((m) => m.action)).toEqual(["publish", "save", "discard"]);
    await s.report({ ...state, dirty: false });
    expect(document.querySelector("ui-modal ui-save-bar")).toBeNull();
  });

  it("opens the store tab in the admin's own click; blocked or no link, the Studio takes over", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    await mount(<Dashboard />, home, "/?open=studio");
    const s = studio();
    await s.report({ ...state, storeUrl: "https://review-store.myshopify.com/apps/gleame/preview/live?token=t" });
    await click(Array.from(document.querySelectorAll("ui-modal ui-title-bar button")).find((b) => b.textContent === "View on my store"));
    await settle();
    expect(open).toHaveBeenCalledWith("https://review-store.myshopify.com/apps/gleame/preview/live?token=t", "_blank");
    expect(heard).toContainEqual({ type: "studio-action", token: s.token, action: "store-opened" });

    open.mockReturnValue(null);
    await click(Array.from(document.querySelectorAll("ui-modal ui-title-bar button")).find((b) => b.textContent === "View on my store"));
    await settle();
    expect(heard.at(-1)).toEqual({ type: "studio-action", token: s.token, action: "view-store" });

    // Only an https link is ever opened.
    open.mockClear();
    await s.report({ ...state, storeUrl: "javascript:alert(1)" });
    await click(Array.from(document.querySelectorAll("ui-modal ui-title-bar button")).find((b) => b.textContent === "View on my store"));
    expect(open).not.toHaveBeenCalled();
  });

  it("closing the window drops what the Studio reported", async () => {
    await mount(<Dashboard />, home, "/?open=studio");
    const s = studio();
    await s.report({ ...state, dirty: true });
    expect(titleButtons()).toEqual(["View on my store", "Publish"]);
    await act(async () => {
      await (document.querySelector("ui-modal") as any).hide();
    });
    await settle();
    expect(document.querySelector("ui-modal")).toBeNull();
    expect(document.querySelector("ui-save-bar")).toBeNull();
    // Reopened, it waits for the new Studio to report again.
    await click(button("Open Studio"));
    expect(document.querySelector("ui-modal")).not.toBeNull();
    expect(titleButtons()).toEqual([]);
    expect(document.querySelector("ui-save-bar")).toBeNull();
  });
});

describe("Studio side of the relay", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("takes only its own tab's actions, and reports only when hosted", async () => {
    const listener = new BroadcastChannel(STUDIO_NAV_CHANNEL);
    const heard: unknown[] = [];
    listener.onmessage = (e) => heard.push(e.data);
    const state = { showPublish: true, showViewStore: false, viewStoreDisabled: false, storeUrl: null, dirty: true, saving: false };

    // Opened directly (no navtoken): nobody is listening, so nothing is sent.
    postStudioState(state);
    const got: string[] = [];
    const offDirect = onStudioAction((a) => got.push(a));

    window.history.replaceState(null, "", "/studio?navtoken=tab1");
    postStudioState(state);
    const off = onStudioAction((a) => got.push(a));
    const sender = new BroadcastChannel(STUDIO_NAV_CHANNEL);
    sender.postMessage({ type: "studio-action", token: "tab2", action: "publish" });
    sender.postMessage({ type: "studio-action", token: "tab1", action: "rm -rf" });
    sender.postMessage({ type: "studio-action", token: "tab1", action: "save" });
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(got).toEqual(["save"]);
    expect(heard.filter((m) => (m as { type?: string }).type === "studio-state")).toEqual([{ type: "studio-state", token: "tab1", ...state }]);
    off();
    offDirect();
    sender.close();
    listener.close();
  });
});

describe("Studio toasts", () => {
  it("keep the in-page toast with Undo unless the shop is on App Bridge toasts", async () => {
    const { setAppToastMode, showAppToast, STUDIO_TOAST_EVENT } = await import("../../components/studio/toast");
    const show = vi.fn();
    (window as unknown as { shopify: unknown }).shopify = { toast: { show } };
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(STUDIO_TOAST_EVENT, on);
    try {
      const undo = vi.fn();
      setAppToastMode(false);
      showAppToast("Template switched", undo);
      expect(show).not.toHaveBeenCalled();
      expect(seen).toEqual([{ message: "Template switched", undo }]);

      setAppToastMode(true);
      showAppToast("Saved");
      expect(show).toHaveBeenCalledWith("Saved", undefined);
      expect(seen).toHaveLength(1);
    } finally {
      setAppToastMode(false);
      window.removeEventListener(STUDIO_TOAST_EVENT, on);
      delete (window as unknown as { shopify?: unknown }).shopify;
    }
  });
});
