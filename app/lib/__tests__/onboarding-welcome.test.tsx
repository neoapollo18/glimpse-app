// @vitest-environment jsdom
//
// Welcome intro (2026-10-18): three slides before the scope screen. Renders
// each slide, the goal toggles, the expert-setup request, and the hand-off
// to the scope screen (the finish is recorded BEFORE leaving, and the
// background store read is paused at a page boundary).
//
// GLEAME_DUMP_DIR=<dir> also writes each slide's HTML there, for the
// screenshot harness.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import fs from "node:fs";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";

vi.mock("../../shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("../supabase.server", () => ({ supabase: {}, ensureShopExists: vi.fn() }));
vi.mock("../quiz-draft.server", () => ({ shopHasRealQuiz: vi.fn() }));
vi.mock("../setup-offer.server", () => ({ getSetupOfferContact: vi.fn() }));
vi.mock("../overhaul-events.server", () => ({ trackOverhaulEvent: vi.fn() }));
vi.mock("../onboarding-intro.server", () => ({ introDone: vi.fn() }));
const syncCalls: string[] = [];
let syncInFlight = false;
vi.mock("../use-catalog-sync", () => ({
  useCatalogSync: () => ({
    progress: { done: 120, total: null },
    busy: true,
    get pageInFlight() {
      return syncInFlight;
    },
    syncError: null,
    start: (c?: string) => syncCalls.push(`start:${c ?? ""}`),
    pause: () => syncCalls.push("pause"),
  }),
}));

import { WelcomeIntro, INTRO_STEPS, type WelcomeData } from "../../routes/app.onboarding.welcome";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo = () => {};
});

const DATA: WelcomeData = {
  shopDomain: "luna-test.myshopify.com",
  shopName: "Luna by Khush",
  firstName: "Khush",
  email: "hello@luna.test",
  syncNeeded: true,
  syncCursor: null,
  productCount: 0,
};

let root: Root | null = null;
let apiPosts: Array<Record<string, string>> = [];
let offerPosts: Array<Record<string, string>> = [];
let landed: string[] = [];
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  apiPosts = [];
  offerPosts = [];
  landed = [];
  syncCalls.length = 0;
  syncInFlight = false;
  vi.unstubAllGlobals();
});

async function mount(initialStep = 0, data: WelcomeData = DATA) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const entry: Record<string, string> = { url: String(url) };
    (init?.body as FormData | undefined)?.forEach((v, k) => (entry[k] = String(v)));
    apiPosts.push(entry);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  });
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const offerAction = async ({ request }: { request: Request }) => {
    const fd = await request.formData();
    const entry: Record<string, string> = {};
    fd.forEach((v, k) => (entry[k] = String(v)));
    offerPosts.push(entry);
    return { ok: true, requested: true };
  };
  const router = createMemoryRouter(
    [
      { path: "/", element: <AppProvider i18n={en}><WelcomeIntro data={data} initialStep={initialStep} /></AppProvider> },
      { path: "/app/api/setup-offer", action: offerAction },
      { path: "/app/onboarding/scope", element: <Landed name="scope" /> },
    ],
    { initialEntries: ["/"] },
  );
  root = createRoot(host);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
  await settle();
  return () => document.body.textContent ?? "";
}

function Landed({ name }: { name: string }) {
  landed.push(name);
  return <p>landed:{name}</p>;
}

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const buttons = () => Array.from(document.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => (b.textContent ?? "").trim() === label);
async function click(el: Element | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await settle();
}

function dump(name: string) {
  const dir = process.env.GLEAME_DUMP_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.html`), document.body.innerHTML);
}

describe("Welcome intro", () => {
  it("renders every slide, with the store read running in the background", async () => {
    for (let i = 0; i < INTRO_STEPS.length; i++) {
      const text = await mount(i);
      expect(text()).toContain(`Step ${i + 1} of ${INTRO_STEPS.length}`);
      expect(text()).toContain("Reading your store in the background · 120 products so far");
      dump(`slide-${i + 1}-${INTRO_STEPS[i]}`);
      act(() => root?.unmount());
    }
    expect(syncCalls.filter((c) => c.startsWith("start"))).toHaveLength(INTRO_STEPS.length);
  });

  it("welcome explains the quiz and moves through the slides", async () => {
    const text = await mount(0);
    expect(text()).toContain("Help every shopper find their match");
    expect(text()).toContain("AI writes your quiz");
    await click(button("Get started"));
    expect(text()).toContain("What should your quiz do for you?");
    await click(button("Continue"));
    expect(text()).toContain("How do you want to get started?");
    await click(button("Back"));
    expect(text()).toContain("What should your quiz do for you?");
    expect(apiPosts.filter((p) => p.intent === "step").map((p) => p.step)).toEqual(["1", "2", "1"]);
  });

  it("goals toggle, save when moving on, and travel with the finish", async () => {
    const text = await mount(1);
    // The main action always moves on; picks are optional.
    expect(button("Continue")).toBeTruthy();
    expect(button("Skip this")).toBeUndefined();
    const goal = (t: string) => buttons().find((b) => b.textContent?.includes(t));
    await click(goal("Grow my email list"));
    await click(goal("Cut returns"));
    expect(goal("Grow my email list")!.getAttribute("aria-pressed")).toBe("true");
    await click(goal("Cut returns"));
    expect(goal("Cut returns")!.getAttribute("aria-pressed")).toBe("false");
    await click(button("Continue"));
    expect(text()).toContain("How do you want to get started?");
    const saved = apiPosts.find((p) => p.intent === "goals");
    expect(JSON.parse(saved!.goals)).toEqual(["emails"]);
  });

  it("Build my quiz records the finish, pauses the store read, then opens the scope screen", async () => {
    syncInFlight = true;
    await mount(2);
    await click(button("Build my quiz"));
    expect(syncCalls).toContain("pause");
    const done = apiPosts.find((p) => p.intent === "complete");
    expect(done).toMatchObject({ url: "/app/api/onboarding-intro", path: "ai", step: "2" });
    // A page still on the wire is waited for before leaving.
    await settle(400);
    expect(landed).toEqual([]);
    syncInFlight = false;
    await settle(400);
    expect(landed).toEqual(["scope"]);
  });

  it("the expert path sends the request, confirms, then offers a draft", async () => {
    const text = await mount(2);
    expect(text()).toContain("Free · done for you");
    // One primary action on the slide: the featured card's.
    expect(document.querySelectorAll(".Polaris-Button--variantPrimary")).toHaveLength(1);
    await click(button("Get free expert setup"));
    dump("slide-4-path-form");
    const email = document.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(email.value).toBe("hello@luna.test");
    await click(button("Request free setup"));
    await settle(60);
    expect(offerPosts[0]).toMatchObject({ intent: "request", source: "onboarding_intro", email: "hello@luna.test" });
    expect(text()).toContain("You're on the list");
    dump("slide-4-path-requested");
    await click(button("Build a draft while I wait"));
    await settle(300);
    expect(apiPosts.find((p) => p.intent === "complete")).toMatchObject({ path: "expert" });
    expect(landed).toContain("scope");
  });

  it("draws the store's own products when it has them, and drawn ones otherwise", async () => {
    const preview = ["Cherry Glaze", "Ballet Pink", "Boba", "Dirty Martini"].map((name, i) => ({
      name,
      imageUrl: `https://cdn.shopify.com/s/files/p${i}.webp?v=1`,
    }));
    const text = await mount(0, { ...DATA, preview });
    for (const p of preview) expect(text()).toContain(p.name);
    // Sized for the drawing, not the full-resolution original.
    const img = document.querySelector<HTMLImageElement>(".gw-res-img img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.shopify.com/s/files/p0.webp?v=1&width=220");
    expect(text()).not.toContain("Glow Serum");
    act(() => root?.unmount());
    const empty = await mount(0);
    expect(empty()).toContain("Glow Serum");
    expect(document.querySelector(".gw-res-img img")).toBeNull();
    // The brand mark is the black logo, not a tinted tile.
    expect(document.querySelector(".oa-logo")?.getAttribute("src")).toBe("/brand/gleame-logo.svg");
  });

  it("goal cards show what each goal adds, with no icon tiles", async () => {
    const text = await mount(1);
    expect(text()).toContain("Email me my matches");
    expect(text()).toContain("Light warm");
    expect(document.querySelectorAll(".gw-goal .Polaris-Icon")).toHaveLength(0);
    expect(document.querySelectorAll(".gw-goal-art")).toHaveLength(4);
  });

  it("Skip intro finishes as a skip from any slide but the last", async () => {
    await mount(1);
    await click(button("Skip intro"));
    await settle(300);
    expect(apiPosts.find((p) => p.intent === "complete")).toMatchObject({ path: "skip", step: "1" });
    expect(landed).toContain("scope");
    act(() => root?.unmount());
    await mount(2);
    expect(button("Skip intro")).toBeUndefined();
  });
});
