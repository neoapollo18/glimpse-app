import {
  supabase,
  findShopByDomain,
  getRecommendationFlow,
  getQuizLeadStats,
  getQuizAttribution,
} from "./supabase.server";
import {
  aggregateWindow,
  leadAnswerCounts,
  type DashboardProduct,
  type DashboardQuestion,
  type DashboardRange,
  type OrderStats,
  type QuizDashboardData,
  type QuizEventRow,
} from "./quiz-dashboard";

export { parseRange, DASHBOARD_RANGES, type DashboardRange, type QuizDashboardData } from "./quiz-dashboard";

// Loader for the quiz analytics dashboard (2026-10-15 revamp). One window
// (7/30/90 days) plus the window before it for change badges. Newer data
// sources degrade quietly: no migration 091 -> order totals fall back to
// get_quiz_attribution and product orders stay empty.

const MAX_EVENT_PAGES = 80; // 80k events across both windows

async function fetchEvents(shopId: string, since: string): Promise<{ rows: QuizEventRow[]; truncated: boolean }> {
  const rows: QuizEventRow[] = [];
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const { data, error } = await supabase
      .from("analytics_events")
      .select("event_type, cart_token, device_type, created_at, properties")
      .eq("shop_id", shopId)
      .like("event_type", "quiz_%")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) {
      console.error("[quiz-dashboard] events read failed:", error.message);
      return { rows, truncated: false };
    }
    rows.push(...((data ?? []) as QuizEventRow[]));
    if (!data || data.length < 1000) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function orderStats(shopId: string, from: Date, to: Date): Promise<OrderStats | null> {
  const { data, error } = await supabase.rpc("get_quiz_order_stats", {
    p_shop_id: shopId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    storeOrders: Number(r.store_orders || 0),
    storeRevenue: Number(r.store_revenue || 0),
    finisherCarts: Number(r.finisher_carts || 0),
    quizOrders: Number(r.quiz_orders || 0),
    quizBuyerCarts: Number(r.quiz_buyer_carts || 0),
    quizRevenue: Number(r.quiz_revenue || 0),
    leadsTotal: Number(r.leads_total || 0),
    leadsBought: Number(r.leads_bought || 0),
  };
}

async function productOrders(shopId: string, from: Date, to: Date): Promise<Map<string, { orders: number; units: number }> | null> {
  const { data, error } = await supabase.rpc("get_quiz_product_orders", {
    p_shop_id: shopId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) return null;
  const map = new Map<string, { orders: number; units: number }>();
  for (const r of (data ?? []) as Array<{ product_id: string; orders: number; units: number }>) {
    if (r.product_id) map.set(String(r.product_id), { orders: Number(r.orders || 0), units: Number(r.units || 0) });
  }
  return map;
}


export async function getQuizDashboard(shopDomain: string, range: DashboardRange): Promise<QuizDashboardData | null> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return null;
  const to = new Date();
  const from = new Date(to.getTime() - range * 86_400_000);
  const prevFrom = new Date(from.getTime() - range * 86_400_000);

  const [events, flow, leads, cur, prev, attribution, prodOrders, catalog] = await Promise.all([
    fetchEvents(shop.id, prevFrom.toISOString()),
    getRecommendationFlow(shop.id).catch(() => null),
    getQuizLeadStats(shopDomain, range, 500),
    orderStats(shop.id, from, to),
    orderStats(shop.id, prevFrom, from),
    getQuizAttribution(shopDomain, range).catch(() => null),
    productOrders(shop.id, from, to),
    supabase
      .from("products")
      .select("product_name, handle, image_url, shopify_id")
      .eq("shop_id", shop.id)
      .not("handle", "is", null)
      .limit(5000),
  ]);

  const questions: DashboardQuestion[] = (flow?.questions ?? []).map((q) => ({
    axisKey: q.axisKey,
    prompt: q.prompt,
    multiSelect: Boolean(q.multiSelect),
    options: (q.options ?? []).map((o) => ({ axisValue: o.axisValue, label: o.label, imageUrl: o.imageUrl ?? null })),
  }));

  const current = aggregateWindow(events.rows, from, to, questions.length);
  const previous = aggregateWindow(events.rows, prevFrom, from, questions.length);

  // Order totals: migration 091's windowed stats, else the existing
  // attribution RPC for the current window (no store totals, email-only
  // lead matching).
  let orders = cur;
  const orderStatsComplete = Boolean(cur);
  if (!orders && attribution) {
    orders = {
      storeOrders: 0,
      storeRevenue: 0,
      finisherCarts: attribution.quizFinisherSessions,
      quizOrders: attribution.quizAttributedOrders,
      quizBuyerCarts: attribution.quizFinisherConverted,
      quizRevenue: attribution.quizAttributedRevenue,
      leadsTotal: attribution.leadsTotal,
      leadsBought: attribution.leadsConverted60d,
    };
  }

  // Product leaderboard: every product the quiz recommended, opened or
  // added in the window, named from the catalog; orders from line items.
  const byHandle = new Map<string, { name: string; imageUrl: string | null; shopifyId: string | null }>();
  for (const p of (catalog.data ?? []) as Array<{ product_name: string | null; handle: string; image_url: string | null; shopify_id: string | null }>) {
    const m = /(\d{1,20})$/.exec(String(p.shopify_id ?? ""));
    byHandle.set(p.handle, { name: p.product_name || p.handle, imageUrl: p.image_url, shopifyId: m ? m[1] : null });
  }
  const products: DashboardProduct[] = Object.entries(current.products)
    .map(([handle, a]) => {
      const info = byHandle.get(handle);
      const po = info?.shopifyId && prodOrders ? prodOrders.get(info.shopifyId) : undefined;
      return {
        handle,
        name: info?.name ?? handle,
        imageUrl: info?.imageUrl ?? null,
        recommended: a.recommended,
        opened: a.opened,
        added: a.added,
        orders: prodOrders ? po?.orders ?? 0 : null,
        units: prodOrders ? po?.units ?? 0 : null,
      };
    })
    .sort((a, b) => b.recommended - a.recommended || b.added - a.added || b.opened - a.opened)
    .slice(0, 50);

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    current,
    previous,
    truncated: events.truncated,
    questions,
    orders,
    previousOrders: prev,
    orderStatsComplete,
    products,
    productOrdersAvailable: Boolean(prodOrders),
    leads,
    leadAnswers: leadAnswerCounts(leads.leads),
  };
}

// Home page numbers: the same shoppers the Analytics page counts for its
// default 30-day window (aggregateWindow, distinct carts), so the two
// pages agree. Only the events those three numbers need and only the
// columns that name a shopper, read in parallel pages, so the home page
// stays quick. Null when a read failed.
const FUNNEL_EVENTS = ["quiz_start", "quiz_results_shown", "quiz_add_to_cart", "quiz_add_bundle_to_bag", "quiz_cross_sell_add"];
const FUNNEL_PAGE = 1000;
const MAX_FUNNEL_PAGES = 30;
const FUNNEL_PARALLEL = 6;

export interface QuizFunnelSummary {
  started: number;
  finished: number;
  added: number;
  /** More events than the page cap: the numbers undercount. */
  truncated: boolean;
}

// The home page reads this on every load; a busy shop's 30 days is a few
// paged reads, so keep each shop's summary for 10 minutes.
const FUNNEL_TTL_MS = 10 * 60_000;
const funnelCache = new Map<string, { at: number; value: QuizFunnelSummary }>();

export async function getQuizFunnelSummary(shopId: string, range: DashboardRange = 30): Promise<QuizFunnelSummary | null> {
  const cacheKey = `${shopId}|${range}`;
  const hit = funnelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < FUNNEL_TTL_MS) return hit.value;
  const value = await readQuizFunnelSummary(shopId, range);
  if (value) funnelCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function readQuizFunnelSummary(shopId: string, range: DashboardRange): Promise<QuizFunnelSummary | null> {
  const to = new Date();
  const from = new Date(to.getTime() - range * 86_400_000);
  const since = from.toISOString();
  const { count, error } = await supabase
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .in("event_type", FUNNEL_EVENTS)
    .gte("created_at", since);
  if (error) {
    console.error("[quiz-dashboard] funnel count failed:", error.message);
    return null;
  }
  const total = count ?? 0;
  const pages = Math.min(Math.ceil(total / FUNNEL_PAGE), MAX_FUNNEL_PAGES);
  const rows: QuizEventRow[] = [];
  for (let first = 0; first < pages; first += FUNNEL_PARALLEL) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(FUNNEL_PARALLEL, pages - first) }, (_, i) =>
        supabase
          .from("analytics_events")
          .select("event_type, cart_token, created_at, sid:properties->>sid")
          .eq("shop_id", shopId)
          .in("event_type", FUNNEL_EVENTS)
          .gte("created_at", since)
          // A total order, so parallel pages never overlap or skip a row.
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range((first + i) * FUNNEL_PAGE, (first + i + 1) * FUNNEL_PAGE - 1),
      ),
    );
    for (const res of batch) {
      if (res.error) {
        console.error("[quiz-dashboard] funnel read failed:", res.error.message);
        return null;
      }
      for (const r of (res.data ?? []) as unknown as Array<{ event_type: string; cart_token: string | null; created_at: string; sid: string | null }>) {
        rows.push({
          event_type: r.event_type,
          cart_token: r.cart_token,
          device_type: null,
          created_at: r.created_at,
          properties: r.sid ? { sid: r.sid } : null,
        });
      }
    }
  }
  const w = aggregateWindow(rows, from, to);
  return { started: w.started, finished: w.finished, added: w.added, truncated: total > pages * FUNNEL_PAGE };
}
