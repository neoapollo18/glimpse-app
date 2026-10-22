// @vitest-environment jsdom
//
// Render smoke test for the revamped analytics page (2026-10-15): every tab
// renders from realistic loader data without crashing, with the numbers a
// merchant should see. Server modules are mocked; the loader's data comes
// through a memory data router.

import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { aggregateWindow, leadAnswerCounts, type QuizEventRow } from "../quiz-dashboard";

vi.mock("../../shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("../supabase.server", () => ({ findShopByDomain: vi.fn() }));
vi.mock("../shop-currency.server", () => ({ rememberShopCurrency: vi.fn() }));
vi.mock("../quiz-dashboard.server", () => ({ getQuizDashboard: vi.fn() }));
vi.mock("@shopify/app-bridge-react", () => ({ TitleBar: () => null }));

import QuizAnalytics from "../../routes/app.analytics";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo ||= () => {};
});

function fixture() {
  const from = new Date("2026-09-15T00:00:00Z");
  const to = new Date("2026-10-15T00:00:00Z");
  const rows: QuizEventRow[] = [];
  for (let i = 0; i < 40; i++) {
    const cart = `c${i}`;
    const at = new Date(from.getTime() + i * 12 * 3600_000).toISOString();
    rows.push({ event_type: "quiz_view", cart_token: null, device_type: "mobile", created_at: at, properties: null });
    rows.push({ event_type: "quiz_start", cart_token: cart, device_type: i % 4 ? "mobile" : "desktop", created_at: at, properties: null });
    rows.push({ event_type: "quiz_question_answered", cart_token: cart, device_type: null, created_at: at, properties: { qi: 0, q: "vibe", vals: [i % 3 ? "timeless" : "soft_sweet"] } });
    if (i < 32) {
      rows.push({ event_type: "quiz_question_answered", cart_token: cart, device_type: null, created_at: at, properties: { qi: 1, q: "finish", vals: ["creme"] } });
      rows.push({ event_type: "quiz_recommendations_served", cart_token: cart, device_type: null, created_at: at, properties: { criteria: { vibe: i % 3 ? "timeless" : "soft_sweet", finish: "creme" }, partial: false, recs: [{ h: "red-flare" }, { h: "golden-hour" }] } });
      rows.push({ event_type: "quiz_results_shown", cart_token: cart, device_type: null, created_at: at, properties: null });
    }
    if (i < 8) rows.push({ event_type: "quiz_add_to_cart", cart_token: cart, device_type: null, created_at: at, properties: { h: "red-flare", v: "1", qty: 1 } });
  }
  const current = aggregateWindow(rows, from, to, 2);
  const previous = aggregateWindow([], new Date("2026-08-16T00:00:00Z"), from, 2);
  const leads = { count: 1, leads: [{ id: "l1", email: "shopper@example.com", phone: null, quizAnswers: [{ question: "Vibe?", answer: "Timeless" }], deviceType: "mobile", createdAt: "2026-10-10T00:00:00Z", matchesShown: ["Red Flare"] }] };
  return {
    data: {
      range: 30,
      from: from.toISOString(),
      to: to.toISOString(),
      current,
      previous,
      truncated: false,
      questions: [
        { axisKey: "vibe", prompt: "What's the vibe?", multiSelect: false, options: [{ axisValue: "timeless", label: "Timeless", imageUrl: null }, { axisValue: "soft_sweet", label: "Soft & Sweet", imageUrl: null }] },
        { axisKey: "finish", prompt: "Any finishes you love?", multiSelect: true, options: [{ axisValue: "creme", label: "Classic Creme", imageUrl: null }] },
      ],
      orders: { storeOrders: 400, storeRevenue: 18000, finisherCarts: 32, quizOrders: 6, quizBuyerCarts: 6, quizRevenue: 360, leadsTotal: 1, leadsBought: 1 },
      previousOrders: null,
      orderStatsComplete: true,
      products: [
        { handle: "red-flare", name: "Red Flare", imageUrl: null, recommended: 32, opened: 0, added: 8, orders: 3, units: 4 },
        { handle: "golden-hour", name: "Golden Hour", imageUrl: null, recommended: 32, opened: 0, added: 0, orders: 0, units: 0 },
      ],
      productOrdersAvailable: true,
      leads,
      leadAnswers: leadAnswerCounts(leads.leads),
    },
    currency: "USD",
    range: 30,
  };
}

async function mount(path = "/", extra: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const loaderData = { ...fixture(), ...extra };
  const router = createMemoryRouter(
    [{ path: "/", element: <AppProvider i18n={en}><QuizAnalytics /></AppProvider>, loader: async () => loaderData }],
    { initialEntries: [path] },
  );
  const root = createRoot(host);
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return () => document.body.textContent ?? "";
}

describe("revamped analytics page", () => {
  it("Overview: shopper KPIs, revenue, trend and insights", async () => {
    const text = await mount();
    expect(text()).toContain("Shoppers who started");
    expect(text()).toContain("40");
    expect(text()).toContain("80%"); // 32 of 40 reached matches
    expect(text()).toContain("25%"); // 8 of 32 added
    expect(text()).toContain("$360");
    expect(text()).toContain("+33% per order"); // $60 vs $45
    expect(text()).toContain("What to look at");
    expect(document.querySelector('svg[aria-label="Shoppers per day"]')).not.toBeNull();
  });

  // Polaris collapses tabs into "More views" in jsdom (no layout), so each
  // tab is opened the way a deep link would: ?tab=.
  it("Funnel tab", async () => {
    const text = await mount("/?tab=funnel");
    expect(text()).toContain("Where shoppers go");
    expect(text()).toContain("1. What's the vibe?");
    expect(text()).toContain("Biggest drop");
    expect(document.querySelector('svg[aria-label="Quiz starts by hour, your time"]')).not.toBeNull();
  });

  it("Answers & vibes tab", async () => {
    const text = await mount("/?tab=answers");
    expect(text()).toContain("Answers from 32 shoppers"); // the 32 who reached their matches
    expect(text()).toContain("Timeless");
    expect(text()).toContain("Classic Creme");
  });

  it("Products & revenue tab", async () => {
    const text = await mount("/?tab=products");
    expect(text()).toContain("Red Flare");
    expect(text()).toContain("Recommended");
    expect(text()).toContain("Quiz order value");
    expect(text()).toContain("$60.00");
    // Bundles are allowlisted (App Review, 2026-10-20): no bundle figure elsewhere.
    expect(text()).not.toContain("Bundle adds");
  });

  it("Products tab shows bundle adds for a store with bundles", async () => {
    const text = await mount("/?tab=products", { bundles: true });
    expect(text()).toContain("Bundle adds");
  });

  it("Leads tab", async () => {
    const text = await mount("/?tab=leads");
    expect(text()).toContain("shopper@example.com");
    expect(text()).toContain("Export CSV");
    expect(text()).toContain("Leads who bought");
  });
});
