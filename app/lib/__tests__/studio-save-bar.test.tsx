// @vitest-environment jsdom
//
// Studio save bar, per-shop opt-in (Built for Shopify 4.1.5, 2026-10-17).
// Off (every shop unless STUDIO_ADMIN_BARS_SHOPS names it), editors save
// exactly as before, Matching keeps its in-body Save button and no save bar
// is drawn. On, edits are held: no write until Save, the preview dry-runs
// them (preview-tools, never a write), Save sends them in one apply-tools
// request, Discard drops them, and leaving a slide with unsaved edits asks
// first.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";

vi.mock("../use-catalog-sync", () => ({
  useCatalogSync: () => ({ progress: null, busy: false, syncError: null, start: () => {} }),
}));
vi.mock("@shopify/app-bridge-react", async (orig) => {
  const shopify = {};
  return { ...(await orig<typeof import("@shopify/app-bridge-react")>()), useAppBridge: () => shopify };
});

import { studioAdminBarsEnabled } from "../studio-admin-bars.server";
import { StudioSaveBarProvider, useStudioSaveBarHost } from "../../components/studio/save-bar";
import { IntroEditor } from "../../components/studio/SettingsEditors";
import { EditPanel } from "../../components/studio/EditPanel";
import { MatchSettingsEditor, type MatchSettings } from "../../components/studio/MatchSettingsEditor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo = () => {};
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

// Fetcher submits (autosave) land in the router's /studio action; raw
// postStudioAction fetches (held saves, dry runs) land in `fetched`.
let root: Root | null = null;
let routed: Array<Record<string, string>> = [];
let fetched: Array<Record<string, string>> = [];
let fetchReply: (entry: Record<string, string>) => unknown = () => ({ ok: true });
const realFetch = globalThis.fetch;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  routed = [];
  fetched = [];
  fetchReply = () => ({ ok: true });
  globalThis.fetch = realFetch;
  delete (window as any).shopify;
});

const entryOf = async (body: FormData) => {
  const entry: Record<string, string> = {};
  body.forEach((v, k) => (entry[k] = String(v)));
  return entry;
};

async function mount(element: React.ReactElement) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("_data=routes%2Fstudio") || url.includes("_data=routes/studio")) {
      const entry = await entryOf(init!.body as FormData);
      fetched.push(entry);
      return new Response(JSON.stringify(await fetchReply(entry)), { headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input as any, init);
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const action = async ({ request }: { request: Request }) => {
    routed.push(await entryOf(await request.formData()));
    return { ok: true };
  };
  const router = createMemoryRouter([
    { path: "/", element: <AppProvider i18n={en}>{element}</AppProvider>, action },
    { path: "/studio", action },
  ]);
  root = createRoot(host);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
  await wait(20);
}

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const button = (label: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const field = (label: string) => {
  const l = Array.from(document.querySelectorAll("label")).find((x) => x.textContent?.trim() === label);
  return document.getElementById(l!.getAttribute("for")!) as HTMLInputElement | HTMLTextAreaElement;
};
async function type(label: string, value: string) {
  const el = field(label);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(el: Element | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await wait(20);
}

type Host = ReturnType<typeof useStudioSaveBarHost>;
function SaveBarHost({
  enabled,
  hosted = false,
  hostRef,
  onDiscarded = () => {},
  onPreview = () => {},
  children,
}: {
  enabled: boolean;
  hosted?: boolean;
  hostRef?: { current: Host | null };
  onDiscarded?: () => void;
  onPreview?: (p: unknown) => void;
  children: React.ReactNode;
}) {
  const host = useStudioSaveBarHost(enabled, { hosted, onPreview, onDiscarded });
  if (hostRef) hostRef.current = host;
  return (
    <StudioSaveBarProvider value={host.api}>
      {host.bar}
      {host.leaveDialog}
      {children}
    </StudioSaveBarProvider>
  );
}

const SETTINGS = { quiz_headline: "Find your match" };
const MATCH_INITIAL: MatchSettings = {
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

// ---------------------------------------------------------------------

describe("STUDIO_ADMIN_BARS_SHOPS", () => {
  it("is off unless the shop is named (or *)", () => {
    expect(studioAdminBarsEnabled("a.myshopify.com", undefined)).toBe(false);
    expect(studioAdminBarsEnabled("a.myshopify.com", "")).toBe(false);
    expect(studioAdminBarsEnabled("a.myshopify.com", "b.myshopify.com")).toBe(false);
    expect(studioAdminBarsEnabled("a.myshopify.com", " b.myshopify.com , A.myshopify.com ")).toBe(true);
    expect(studioAdminBarsEnabled("a.myshopify.com", "*")).toBe(true);
  });
});

describe("save bar off (default)", () => {
  it("an edit autosaves as before, with no save bar and no dry run", async () => {
    await mount(
      <SaveBarHost enabled={false}>
        <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />
      </SaveBarHost>,
    );
    await type("Headline", "Find your nail match");
    expect(document.querySelector("ui-save-bar")).toBeNull();
    await wait(650);
    expect(routed).toEqual([
      { intent: "apply-tool", tool: "update_copy", input: JSON.stringify({ fields: { quiz_headline: "Find your nail match" } }) },
    ]);
    expect(fetched).toEqual([]);
  });
});

describe("Matching and the bundle discount with the save bar off", () => {
  it("Matching keeps its in-body Save button and never draws a save bar", async () => {
    await mount(
      <SaveBarHost enabled={false}>
        <MatchSettingsEditor initial={MATCH_INITIAL} products={[]} chatBusy={false} onPreviewReload={() => {}} />
      </SaveBarHost>,
    );
    expect(button("Save matching settings")).toBeUndefined();
    const select = Array.from(document.querySelectorAll("select")).find((s) => s.value === "hybrid")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "ai");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.querySelector("ui-save-bar")).toBeNull();
    await click(button("Save matching settings"));
    expect(routed).toContainEqual({ intent: "save-match-settings", patch: JSON.stringify({ recommendation_mode: "ai" }) });
  });
});

describe("save bar on", () => {
  it("holds an edit: dry-run preview, no write until Save, then one apply-tools", async () => {
    const previews: unknown[] = [];
    fetchReply = (e) =>
      e.intent === "preview-tools"
        ? { ok: true, intent: e.intent, previewConfig: { headline: "dry" } }
        : { ok: true, intent: e.intent, previewConfig: { headline: "saved" } };
    await mount(
      <SaveBarHost enabled onPreview={(p) => previews.push(p)}>
        <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={(p) => previews.push(p)} />
      </SaveBarHost>,
    );
    await type("Headline", "Find your nail match");
    const bar = document.querySelector("ui-save-bar")!;
    expect(bar.getAttribute("data-showing")).toBe("true");
    expect(bar.hasAttribute("discardconfirmation")).toBe(true);
    await wait(650);
    // Only a dry run so far: nothing written.
    expect(routed).toEqual([]);
    expect(fetched).toEqual([
      { intent: "preview-tools", calls: JSON.stringify([{ tool: "update_copy", input: { fields: { quiz_headline: "Find your nail match" } } }]) },
    ]);
    expect(previews).toContainEqual({ flow: undefined, config: { headline: "dry" } });

    await click(button("Save", bar));
    await wait(20);
    expect(fetched[1]).toEqual({
      intent: "apply-tools",
      calls: JSON.stringify([{ tool: "update_copy", input: { fields: { quiz_headline: "Find your nail match" } } }]),
    });
    expect(document.querySelector("ui-save-bar")).toBeNull();
    expect(previews).toContainEqual({ flow: undefined, config: { headline: "saved" } });
    expect(routed).toEqual([]);
  });

  it("a failed save keeps the edits and the bar, and says why", async () => {
    fetchReply = (e) => (e.intent === "apply-tools" ? { ok: false, error: "Headline is too long" } : { ok: true });
    await mount(
      <SaveBarHost enabled>
        <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />
      </SaveBarHost>,
    );
    await type("Headline", "x".repeat(10));
    await click(button("Save", document.querySelector("ui-save-bar")!));
    await wait(20);
    expect(document.querySelector("ui-save-bar")).not.toBeNull();
    expect(document.querySelector(".Polaris-Banner")?.textContent).toContain("Headline is too long");
    // Retrying sends the same edit again.
    fetchReply = () => ({ ok: true });
    await click(button("Save", document.querySelector("ui-save-bar")!));
    await wait(20);
    expect(fetched.filter((f) => f.intent === "apply-tools")).toHaveLength(2);
    expect(fetched.at(-1)!.calls).toContain("x".repeat(10));
    expect(document.querySelector("ui-save-bar")).toBeNull();
  });

  it("Discard drops the edits without writing and asks the Studio to remount", async () => {
    let discarded = 0;
    await mount(
      <SaveBarHost enabled onDiscarded={() => discarded++}>
        <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />
      </SaveBarHost>,
    );
    await type("Headline", "Something else");
    await click(button("Discard", document.querySelector("ui-save-bar")!));
    await wait(650);
    expect(document.querySelector("ui-save-bar")).toBeNull();
    expect(discarded).toBe(1);
    expect(fetched.filter((f) => f.intent !== "preview-tools")).toEqual([]);
    expect(routed).toEqual([]);
  });

  it("leaving with unsaved edits asks first; Keep editing stays, Discard changes leaves", async () => {
    const hostRef: { current: Host | null } = { current: null };
    await mount(
      <SaveBarHost enabled hostRef={hostRef}>
        <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />
      </SaveBarHost>,
    );
    // Nothing held: a switch goes straight through.
    let went = 0;
    act(() => hostRef.current!.confirmLeave(() => went++));
    expect(went).toBe(1);
    expect(document.body.textContent).not.toContain("Discard unsaved changes?");

    await type("Headline", "Unsaved");
    act(() => hostRef.current!.confirmLeave(() => went++));
    await wait(20);
    expect(went).toBe(1);
    expect(document.body.textContent).toContain("Discard unsaved changes?");
    await click(button("Keep editing"));
    expect(went).toBe(1);
    expect(document.querySelector("ui-save-bar")).not.toBeNull();

    act(() => hostRef.current!.confirmLeave(() => went++));
    await wait(20);
    // The merchant chose to leave: the edits are discarded, then the switch runs.
    await click(button("Discard changes"));
    expect(went).toBe(2);
    expect(document.querySelector("ui-save-bar")).toBeNull();
    expect(fetched.filter((f) => f.intent === "apply-tools")).toEqual([]);
  });

  it("hosted in the dashboard's app window, the Studio draws no bar of its own", async () => {
    const hostRef: { current: Host | null } = { current: null };
    await mount(
      <SaveBarHost enabled hosted hostRef={hostRef}>
        <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />
      </SaveBarHost>,
    );
    await type("Headline", "Held for the host's bar");
    expect(document.querySelector("ui-save-bar")).toBeNull();
    // The dashboard reads this (studio-state) and hangs the bar on its modal.
    expect(hostRef.current!.dirty).toBe(true);
    let ok: boolean | null = null;
    await act(async () => {
      ok = await hostRef.current!.saveAll();
    });
    expect(ok).toBe(true);
    expect(fetched.filter((f) => f.intent === "apply-tools")).toHaveLength(1);
    expect(hostRef.current!.dirty).toBe(false);
  });

  it("a save asked for mid-save waits for it, even after its editor unmounted", async () => {
    const hostRef: { current: Host | null } = { current: null };
    let answer: (v: unknown) => void = () => {};
    fetchReply = (e) => (e.intent === "apply-tools" ? new Promise((r) => (answer = r)) : { ok: true });
    function Toggle() {
      const [shown, setShown] = React.useState(true);
      return (
        <>
          <button onClick={() => setShown(false)}>Hide</button>
          {shown && <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />}
        </>
      );
    }
    await mount(
      <SaveBarHost enabled hostRef={hostRef}>
        <Toggle />
      </SaveBarHost>,
    );
    await type("Headline", "Saved on the way to Build with AI");
    let first: Promise<boolean> | null = null;
    act(() => {
      first = hostRef.current!.saveAll();
    });
    await click(button("Hide"));
    // Nothing is registered any more, but the first save hasn't answered:
    // the second call must not report success before it does.
    let second: boolean | null = null;
    const pending = hostRef.current!.saveAll().then((v) => (second = v));
    await wait(20);
    expect(second).toBeNull();
    await act(async () => {
      answer({ ok: false, error: "Headline is too long" });
      await first;
      await pending;
    });
    expect(second).toBe(false);
  });

  it("an editor unmounted with held edits never saves them on its own", async () => {
    function Toggle() {
      const [shown, setShown] = React.useState(true);
      return (
        <>
          <button onClick={() => setShown(false)}>Hide</button>
          {shown && <IntroEditor settings={SETTINGS} chatBusy={false} onPreviewUpdate={() => {}} />}
        </>
      );
    }
    await mount(
      <SaveBarHost enabled>
        <Toggle />
      </SaveBarHost>,
    );
    await type("Headline", "Held");
    await click(button("Hide"));
    await wait(650);
    expect(fetched.filter((f) => f.intent === "apply-tools" || f.intent === "apply-tool")).toEqual([]);
    expect(routed).toEqual([]);
    expect(document.querySelector("ui-save-bar")).toBeNull();
  });

  it("question edits are held too and save as one apply-tools", async () => {
    const data = {
      shopDomain: "review-store.myshopify.com",
      adminBars: true,
      settings: {},
      studio: { template: null },
      draft: {
        settings: {},
        flow: {
          axes: [{ key: "vibe", label: "Vibe", source: "user_question", values: [{ value: "bold", label: "Bold" }] }],
          questions: [{ axisKey: "vibe", prompt: "What's the vibe?", options: [{ label: "Bold", axisValueValue: "bold" }] }],
          rules: [],
        },
      },
    } as any;
    await mount(
      <SaveBarHost enabled>
        <EditPanel
          data={data}
          step="build"
          selectedSlide="q:vibe"
          chatEpoch={0}
          chatBusy={false}
          onSelectSlide={() => {}}
          onPreviewUpdate={() => {}}
          onPreviewReload={() => {}}
          chat={<div />}
        />
      </SaveBarHost>,
    );
    await type("Question", "Pick your vibe");
    expect(document.querySelector("ui-save-bar")).not.toBeNull();
    await wait(650);
    expect(routed).toEqual([]);
    expect(fetched.map((f) => f.intent)).toEqual(["preview-tools"]);
    await click(button("Save", document.querySelector("ui-save-bar")!));
    await wait(20);
    const save = fetched.find((f) => f.intent === "apply-tools")!;
    const calls = JSON.parse(save.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("update_question");
    expect(calls[0].input.patch.prompt).toBe("Pick your vibe");
    expect(document.querySelector("ui-save-bar")).toBeNull();
  });

  it("Matching joins the one Studio bar instead of drawing its own", async () => {
    await mount(
      <SaveBarHost enabled>
        <MatchSettingsEditor initial={MATCH_INITIAL} products={[]} chatBusy={false} onPreviewReload={() => {}} />
      </SaveBarHost>,
    );
    expect(button("Save matching settings")).toBeUndefined();
    const select = Array.from(document.querySelectorAll("select")).find((s) => s.value === "hybrid")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "ai");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const bars = document.querySelectorAll("ui-save-bar");
    expect(bars).toHaveLength(1);
    expect(bars[0].id).toBe("gleame-studio-save-bar");
    await click(button("Save", bars[0]));
    await wait(20);
    expect(routed).toContainEqual({ intent: "save-match-settings", patch: JSON.stringify({ recommendation_mode: "ai" }) });
  });
});
