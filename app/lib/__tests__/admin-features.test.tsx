// @vitest-environment jsdom
//
// /admin store cards: the Features panel holds the Gleame-only switches.
// Quiz try-on (chat_assistant_config.quiz_tryon_enabled) is set here and
// nowhere else since 2026-10-20 (migration 094), and the card says what the
// switch means for that store's shoppers (on and set up, on with nothing
// set up, off).

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
import fs from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

vi.mock("../../shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("../../db.server", () => ({ default: {} }));
vi.mock("../supabase.server", () => ({
  supabase: {},
  updateShopMonthlySessions: vi.fn(),
  uploadReferenceImage: vi.fn(),
  appendProductReferenceImage: vi.fn(),
  removeProductReferenceImageByUrl: vi.fn(),
  appendVariantReferenceImage: vi.fn(),
  removeVariantReferenceImageByUrl: vi.fn(),
  updateProductAiModel: vi.fn(),
}));
vi.mock("../tryon-availability.server", () => ({ shopHasTryonProducts: vi.fn() }));
vi.mock("../storefront-cache.server", () => ({ invalidateStorefrontCache: vi.fn() }));

import FoundersAdmin from "../../routes/admin";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo ||= () => {};
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const shop = (domain: string, quiz: unknown, extra: Record<string, unknown> = {}) => ({
  id: domain,
  shop_domain: domain,
  shopify_id: domain,
  shop_name: null,
  products: [],
  conversionStats: null,
  monthlySessions: 1200,
  sessions_updated_at: null,
  missingSessionScopes: [],
  is_skin_analysis_enabled: false,
  vto_enabled: null,
  quiz,
  ...extra,
});

const SHOPS = [
  shop("live-tryon.myshopify.com", { live: true, template: null, tryonEnabled: true, tryonReady: true }),
  shop("on-nothing-set-up.myshopify.com", { live: true, template: "t3", tryonEnabled: true, tryonReady: false }),
  shop("off-ready.myshopify.com", { live: false, template: null, tryonEnabled: false, tryonReady: true }),
  shop("no-quiz.myshopify.com", null),
];

let posted: Array<Record<string, string>> = [];

async function mount() {
  posted = [];
  const loaderData = {
    shops: SHOPS,
    stats: { totalShops: SHOPS.length, totalProducts: 0, totalTransformations: 0 },
    error: null,
    adminToken: "ACTION-TOKEN",
    csvToken: "CSV-TOKEN-1",
  };
  const router = createMemoryRouter([
    {
      path: "/",
      element: <FoundersAdmin />,
      loader: async () => loaderData,
      action: async ({ request }) => {
        const fd = await request.formData();
        const entry = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
        posted.push(entry);
        return { success: true, tryonEnabled: entry.enabled === "true" };
      },
      shouldRevalidate: () => false,
    },
  ]);
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
  await act(async () => {});
  if (process.env.ADMIN_DUMP) fs.writeFileSync(process.env.ADMIN_DUMP, document.body.innerHTML);
}

const card = (domain: string) =>
  [...document.querySelectorAll(".Polaris-ShadowBevel")].find((c) => c.querySelector("h3")?.textContent === domain) as HTMLElement;
const tryonBox = (domain: string) =>
  [...card(domain).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) =>
    i.closest("label")?.textContent?.includes("Quiz try-on") || i.closest(".Polaris-Choice")?.textContent?.includes("Quiz try-on"),
  ) as HTMLInputElement;

describe("/admin Features panel", () => {
  it("says what try-on means for each store's shoppers", async () => {
    await mount();
    expect(card("live-tryon.myshopify.com").textContent).toContain("Shoppers see try-on in the quiz.");
    expect(card("live-tryon.myshopify.com").textContent).toContain("Try-on on");
    expect(card("on-nothing-set-up.myshopify.com").textContent).toContain("Try-on on · nothing set up");
    expect(card("on-nothing-set-up.myshopify.com").textContent).toContain("Quiz live · t3");
    expect(card("off-ready.myshopify.com").textContent).toContain("Off. Products are set up");
    expect(card("no-quiz.myshopify.com").textContent).toContain("This store has no quiz yet.");
    expect(tryonBox("no-quiz.myshopify.com").disabled).toBe(true);
  });

  it("the switch posts update-quiz-tryon for that store with the admin token", async () => {
    await mount();
    const box = tryonBox("off-ready.myshopify.com");
    expect(box.checked).toBe(false);
    await act(async () => {
      box.click();
    });
    await act(async () => {});
    expect(posted).toEqual([
      { action: "update-quiz-tryon", targetShopDomain: "off-ready.myshopify.com", enabled: "true", adminToken: "ACTION-TOKEN" },
    ]);
    expect(tryonBox("off-ready.myshopify.com").checked).toBe(true);
  });
});
