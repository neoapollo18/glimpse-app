// @vitest-environment jsdom
//
// The founders page's "Export skin uploads CSV" link: it carries the
// export-only csv token (never the 12h action token, which would land in
// access logs and browser history), and keeps that 10-minute token fresh
// while the page stays open so the link works as long as it always has.

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import React, { act } from "react";
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

import FoundersAdmin from "../../routes/admin";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).scrollTo ||= () => {};
});

let root: Root | null = null;
const realFetch = globalThis.fetch;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

async function mount() {
  const loaderData = {
    shops: [],
    stats: { totalShops: 0, totalProducts: 0, totalTransformations: 0 },
    error: null,
    adminToken: "ACTION-TOKEN",
    csvToken: "CSV-TOKEN-1",
  };
  const router = createMemoryRouter([{ path: "/", element: <FoundersAdmin />, loader: async () => loaderData }]);
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
  await act(async () => {});
}

const exportHrefs = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href*="skin-uploads.csv"]')].map((a) => a.getAttribute("href"));

function expectExportToken(token: string) {
  const hrefs = exportHrefs();
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href).toBe(`/admin/skin-uploads.csv?token=${token}`);
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

describe("founders CSV export link", () => {
  it("uses the export-only token, never the action token", async () => {
    await mount();
    expectExportToken("CSV-TOKEN-1");
    expect(exportHrefs().join(" ")).not.toContain("ACTION-TOKEN");
  });

  it("re-mints the csv token in the background before it expires", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ success: true, csvToken: "CSV-TOKEN-2" }) }));
    globalThis.fetch = fetchMock as any;
    await mount();

    await advance(3 * 60 * 1000);
    expect(fetchMock).not.toHaveBeenCalled(); // still fresh

    await advance(90 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/admin?_data=routes/admin");
    const body = init.body as FormData;
    expect(body.get("action")).toBe("mint-csv-token");
    expect(body.get("adminToken")).toBe("ACTION-TOKEN");
    expectExportToken("CSV-TOKEN-2");
  });

  it("catches up on return after sleep, when timers didn't run", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ success: true, csvToken: "CSV-TOKEN-3" }) }));
    globalThis.fetch = fetchMock as any;
    await mount();

    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectExportToken("CSV-TOKEN-3");
  });

  it("stops asking once the 12h action token has expired", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const fetchMock = vi.fn(async () => ({ status: 403, json: async () => ({ success: false, error: "Forbidden" }) }));
    globalThis.fetch = fetchMock as any;
    await mount();

    await advance(5 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(30 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectExportToken("CSV-TOKEN-1");
  });
});
