// Home page quiz numbers (2026-10-17): distinct shoppers, counted exactly as
// the Analytics page counts them (aggregateWindow), so a results re-render
// or a retake never inflates "reached their matches" past the starts. A fake
// PostgREST builder stands in for Supabase.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { event_type: string; cart_token: string | null; created_at: string; properties: Record<string, unknown> | null };
let table: Row[] = [];
let failPage = -1;
const selects: string[] = [];

function builder() {
  const q = { head: false, types: [] as string[], since: "", from: 0, to: Infinity, select: "" };
  const run = () => {
    const rows = table
      .filter((r) => q.types.includes(r.event_type) && r.created_at >= q.since)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (q.head) return { count: rows.length, error: null };
    if (q.from / 1000 === failPage) return { data: null, error: { message: "boom" } };
    return {
      data: rows.slice(q.from, q.to + 1).map((r) => ({
        event_type: r.event_type,
        cart_token: r.cart_token,
        created_at: r.created_at,
        sid: typeof r.properties?.sid === "string" ? r.properties.sid : null,
      })),
      error: null,
    };
  };
  const b: any = {
    select(cols: string, opts?: { head?: boolean }) {
      q.select = cols;
      q.head = Boolean(opts?.head);
      selects.push(cols);
      return b;
    },
    eq: () => b,
    in(_c: string, v: string[]) {
      q.types = v;
      return b;
    },
    gte(_c: string, v: string) {
      q.since = v;
      return b;
    },
    order: () => b,
    range(f: number, t: number) {
      q.from = f;
      q.to = t;
      return b;
    },
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return b;
}

vi.mock("../supabase.server", () => ({
  supabase: { from: () => builder() },
  findShopByDomain: vi.fn(),
  getRecommendationFlow: vi.fn(),
  getQuizLeadStats: vi.fn(),
  getQuizAttribution: vi.fn(),
}));

import { getQuizFunnelSummary } from "../quiz-dashboard.server";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ev = (event_type: string, cart: string | null, min: number, sid?: string): Row => ({
  event_type,
  cart_token: cart,
  created_at: ago(min),
  properties: sid ? { sid, recs: ["a", "b"] } : null,
});

beforeEach(() => {
  table = [];
  failPage = -1;
  selects.length = 0;
});

describe("getQuizFunnelSummary", () => {
  it("counts shoppers, not events: re-renders and retakes count once", async () => {
    table = [
      ev("quiz_start", "c1", 50),
      ev("quiz_results_shown", "c1", 49),
      ev("quiz_results_shown", "c1", 48), // edited an answer, results again
      ev("quiz_results_shown", "c1", 47),
      ev("quiz_add_to_cart", "c1", 46),
      ev("quiz_add_bundle_to_bag", "c1", 45),
      ev("quiz_start", "c2", 40),
      ev("quiz_results_shown", "c2", 39),
      ev("quiz_start", null, 30, "run-3"), // no cart yet: the quiz run id names the shopper
      ev("quiz_start", "c4", 20),
      ev("quiz_start", "old", 60 * 24 * 31), // outside the 30-day window
    ];
    expect(await getQuizFunnelSummary("shop-1", 30)).toEqual({ started: 4, finished: 2, added: 1, truncated: false });
    // Only the columns that name a shopper: never the properties blob.
    expect(selects.filter((c) => c !== "id")).toEqual(["event_type, cart_token, created_at, sid:properties->>sid"]);
  });

  it("reads every page, in parallel batches", async () => {
    for (let i = 0; i < 2500; i++) table.push(ev("quiz_start", `c${i}`, 100 + (i % 500)));
    const r = await getQuizFunnelSummary("shop-2", 30);
    expect(r?.started).toBe(2500);
    expect(r?.truncated).toBe(false);
  });

  it("returns null when a read fails, so the home page says so instead of showing zeros", async () => {
    for (let i = 0; i < 1500; i++) table.push(ev("quiz_start", `c${i}`, 100));
    failPage = 1;
    expect(await getQuizFunnelSummary("shop-3", 30)).toBeNull();
  });
});
