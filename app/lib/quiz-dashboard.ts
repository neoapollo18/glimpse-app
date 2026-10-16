// Quiz analytics dashboard (2026-10-15 revamp): pure aggregation over
// analytics_events rows, shared by the loader and the tests.
//
// Everything is counted per SHOPPER (one cart, or the quiz run id `sid`
// for events that carry one), never per event: page reloads, back-taps and
// results re-renders used to inflate every rate. Page views are the one
// event count kept (quiz_view fires before a shopper is known).

import type { QuizLeadStats } from "./supabase.server";

export interface QuizEventRow {
  event_type: string;
  cart_token: string | null;
  device_type: string | null;
  created_at: string;
  properties: Record<string, unknown> | null;
}

export interface ProductActivity {
  recommended: number;
  opened: number;
  added: number;
}

export interface WindowStats {
  views: number;
  started: number;
  finished: number;
  opened: number;
  added: number;
  /** Shoppers who opened OR added a product after their matches. */
  engaged: number;
  restarted: number;
  leadViewed: number;
  leadJoined: number;
  photoStep: number;
  photoUploaded: number;
  photoSkipped: number;
  shadeDetected: number;
  shadeFailed: number;
  bundleAdds: number;
  crossSellViews: number;
  crossSellAdds: number;
  discountApplied: number;
  mobile: number;
  desktop: number;
  daily: Array<{ date: string; views: number; started: number; finished: number; added: number }>;
  /** quiz_start events by UTC hour (the page shifts to the viewer's time). */
  hoursUtc: number[];
  /** Shoppers who answered each question; exact when events carry `qi`. */
  questionReach: Array<{ qi: number; axisKey: string | null; shoppers: number }>;
  questionReachExact: boolean;
  /** axisKey -> axisValue -> shoppers who picked it. */
  answers: Record<string, Record<string, number>>;
  /** axisKey -> shoppers who answered it (the denominator for shares). */
  answerRespondents: Record<string, number>;
  answersSource: "served" | "answered" | null;
  /** product handle -> distinct shoppers. */
  products: Record<string, ProductActivity>;
  /** Quiz runs that reached results and carried the server's matches. */
  servedRuns: number;
}

const DAY = 86_400_000;

function shopperKey(r: QuizEventRow): string | null {
  if (r.cart_token) return `c:${r.cart_token}`;
  const sid = r.properties && typeof r.properties.sid === "string" ? r.properties.sid : null;
  return sid ? `s:${sid}` : null;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];

/**
 * Aggregate one window [from, to). `questionCount` sizes the estimated
 * question reach when events don't carry a question index yet.
 */
export function aggregateWindow(rows: QuizEventRow[], from: Date, to: Date, questionCount = 0): WindowStats {
  const f = from.getTime();
  const t = to.getTime();
  const sets: Record<string, Set<string>> = {};
  const add = (name: string, key: string | null) => {
    if (!key) return;
    (sets[name] ||= new Set()).add(key);
  };
  const n = (name: string) => (sets[name] ? sets[name].size : 0);
  let views = 0;
  let bundleAdds = 0;
  let crossSellAdds = 0;
  const hoursUtc = Array(24).fill(0) as number[];

  // Daily buckets (UTC dates) across the whole window.
  const days: Record<string, { views: number; started: Set<string>; finished: Set<string>; added: Set<string> }> = {};
  const dayKeys: string[] = [];
  for (let d = Math.floor(f / DAY) * DAY; d < t; d += DAY) {
    const k = new Date(d).toISOString().slice(0, 10);
    dayKeys.push(k);
    days[k] = { views: 0, started: new Set(), finished: new Set(), added: new Set() };
  }

  const answerCountsPerShopper = new Map<string, number>();
  const reachByQi = new Map<number, { axisKey: string | null; shoppers: Set<string> }>();
  // Latest answers per shopper, from served recommendations (preferred)
  // or per-question answer events.
  const served = new Map<string, { at: number; criteria: Record<string, unknown>; recs: string[] }>();
  const answered = new Map<string, Map<string, { at: number; vals: string[] }>>();
  const resultsRecs = new Map<string, { at: number; recs: string[] }>();
  const opened: Record<string, Set<string>> = {};
  const addedBy: Record<string, Set<string>> = {};

  for (const r of rows) {
    const at = Date.parse(r.created_at);
    if (!(at >= f && at < t)) continue;
    const key = shopperKey(r);
    const p = (r.properties || {}) as Record<string, unknown>;
    const day = days[new Date(at).toISOString().slice(0, 10)];
    switch (r.event_type) {
      case "quiz_view":
        views++;
        if (day) day.views++;
        break;
      case "quiz_start":
        add("started", key);
        if (key && day) day.started.add(key);
        hoursUtc[new Date(at).getUTCHours()]++;
        if (key && r.device_type === "mobile") add("mobile", key);
        else if (key && r.device_type === "desktop") add("desktop", key);
        break;
      case "quiz_question_answered": {
        if (!key) break;
        answerCountsPerShopper.set(key, (answerCountsPerShopper.get(key) || 0) + 1);
        const qi = typeof p.qi === "number" ? p.qi : null;
        const q = typeof p.q === "string" ? p.q : null;
        if (qi != null) {
          const e = reachByQi.get(qi) || { axisKey: q, shoppers: new Set<string>() };
          e.shoppers.add(key);
          if (!e.axisKey && q) e.axisKey = q;
          reachByQi.set(qi, e);
        }
        if (q) {
          const m = answered.get(key) || new Map();
          const prev = m.get(q);
          if (!prev || prev.at <= at) m.set(q, { at, vals: asStrings(p.vals) });
          answered.set(key, m);
        }
        break;
      }
      case "quiz_recommendations_served": {
        if (!key || p.partial === true) break;
        const prev = served.get(key);
        if (!prev || prev.at <= at) {
          const recs = Array.isArray(p.recs)
            ? (p.recs as Array<Record<string, unknown>>).map((x) => (x && typeof x.h === "string" ? x.h : null)).filter((h): h is string => Boolean(h))
            : [];
          served.set(key, { at, criteria: (p.criteria && typeof p.criteria === "object" ? p.criteria : {}) as Record<string, unknown>, recs });
        }
        break;
      }
      case "quiz_results_shown": {
        add("finished", key);
        if (key && day) day.finished.add(key);
        if (key && Array.isArray(p.recs)) {
          const prev = resultsRecs.get(key);
          if (!prev || prev.at <= at) resultsRecs.set(key, { at, recs: asStrings(p.recs) });
        }
        break;
      }
      case "quiz_view_product":
        add("opened", key);
        add("engaged", key);
        if (key && typeof p.h === "string") (opened[p.h] ||= new Set()).add(key);
        break;
      case "quiz_add_to_cart":
      case "quiz_add_bundle_to_bag":
      case "quiz_cross_sell_add": {
        add("added", key);
        add("engaged", key);
        if (key && day) day.added.add(key);
        if (r.event_type === "quiz_add_bundle_to_bag") bundleAdds++;
        if (r.event_type === "quiz_cross_sell_add") crossSellAdds++;
        if (!key) break;
        const handles =
          r.event_type === "quiz_add_bundle_to_bag" && Array.isArray(p.items)
            ? (p.items as Array<Record<string, unknown>>).map((x) => (x && typeof x.h === "string" ? x.h : null))
            : [typeof p.h === "string" ? p.h : null];
        for (const h of handles) if (h) (addedBy[h] ||= new Set()).add(key);
        break;
      }
      case "quiz_restart":
        add("restarted", key);
        break;
      case "quiz_lead_view":
        add("leadViewed", key);
        break;
      case "quiz_lead_submitted":
        add("leadJoined", key);
        break;
      case "quiz_gate_view":
        add("photoStep", key);
        break;
      case "quiz_photo_upload":
        add("photoUploaded", key);
        break;
      case "quiz_photo_skip":
        add("photoSkipped", key);
        break;
      case "quiz_shade_detected":
        add("shadeDetected", key);
        break;
      case "quiz_shade_detect_failed":
        add("shadeFailed", key);
        break;
      case "quiz_cross_sell_view":
        add("crossSellViews", key);
        break;
      case "quiz_bundle_discount_applied":
        add("discountApplied", key);
        break;
    }
  }

  // Question reach: exact from question indexes, else estimated from how
  // many answers each shopper gave (a shopper with k answers reached Q k).
  let questionReach: WindowStats["questionReach"] = [];
  const questionReachExact = reachByQi.size > 0;
  if (questionReachExact) {
    questionReach = [...reachByQi.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([qi, e]) => ({ qi, axisKey: e.axisKey, shoppers: e.shoppers.size }));
  } else if (questionCount > 0 && answerCountsPerShopper.size > 0) {
    const counts = [...answerCountsPerShopper.values()];
    for (let k = 1; k <= questionCount; k++) {
      questionReach.push({ qi: k - 1, axisKey: null, shoppers: counts.filter((c) => c >= k).length });
    }
  }

  // Answers: served recommendations carry every finisher's full answers.
  const answers: Record<string, Record<string, number>> = {};
  const answerRespondents: Record<string, number> = {};
  const count = (axis: string, vals: string[]) => {
    if (vals.length === 0) return;
    answerRespondents[axis] = (answerRespondents[axis] || 0) + 1;
    const bucket = (answers[axis] ||= {});
    for (const v of new Set(vals)) bucket[v] = (bucket[v] || 0) + 1;
  };
  let answersSource: WindowStats["answersSource"] = null;
  if (served.size > 0) {
    answersSource = "served";
    for (const { criteria } of served.values()) {
      for (const [axis, v] of Object.entries(criteria)) count(axis, asStrings(v));
    }
  } else if (answered.size > 0) {
    answersSource = "answered";
    for (const m of answered.values()) for (const [axis, { vals }] of m) count(axis, vals);
  }

  // Products: recommended (served, else results payload), opened, added.
  const products: Record<string, ProductActivity> = {};
  const touch = (h: string) => (products[h] ||= { recommended: 0, opened: 0, added: 0 });
  const recSource = served.size > 0 ? [...served.values()].map((x) => x.recs) : [...resultsRecs.values()].map((x) => x.recs);
  for (const recs of recSource) for (const h of new Set(recs)) touch(h).recommended++;
  for (const [h, s] of Object.entries(opened)) touch(h).opened = s.size;
  for (const [h, s] of Object.entries(addedBy)) touch(h).added = s.size;

  return {
    views,
    started: n("started"),
    finished: n("finished"),
    opened: n("opened"),
    added: n("added"),
    engaged: n("engaged"),
    restarted: n("restarted"),
    leadViewed: n("leadViewed"),
    leadJoined: n("leadJoined"),
    photoStep: n("photoStep"),
    photoUploaded: n("photoUploaded"),
    photoSkipped: n("photoSkipped"),
    shadeDetected: n("shadeDetected"),
    shadeFailed: n("shadeFailed"),
    bundleAdds,
    crossSellViews: n("crossSellViews"),
    crossSellAdds,
    discountApplied: n("discountApplied"),
    mobile: n("mobile"),
    desktop: n("desktop"),
    daily: dayKeys.map((k) => ({
      date: k,
      views: days[k].views,
      started: days[k].started.size,
      finished: days[k].finished.size,
      added: days[k].added.size,
    })),
    hoursUtc,
    questionReach,
    questionReachExact,
    answers,
    answerRespondents,
    answersSource,
    products,
    servedRuns: served.size,
  };
}

/** Answer shares from email leads (labels as stored), the fallback sample. */
export function leadAnswerCounts(
  leads: Array<{ quizAnswers: Array<{ question: string; answer: string }> }>,
): { counts: Record<string, Record<string, number>>; respondents: Record<string, number> } {
  const counts: Record<string, Record<string, number>> = {};
  const respondents: Record<string, number> = {};
  for (const lead of leads) {
    const seen = new Set<string>();
    for (const a of lead.quizAnswers) {
      const q = a.question.trim();
      if (!q) continue;
      if (!seen.has(q)) {
        respondents[q] = (respondents[q] || 0) + 1;
        seen.add(q);
      }
      const bucket = (counts[q] ||= {});
      for (const v of a.answer.split(", ").map((x) => x.trim()).filter(Boolean)) bucket[v] = (bucket[v] || 0) + 1;
    }
  }
  return { counts, respondents };
}

export interface OrderStats {
  storeOrders: number;
  storeRevenue: number;
  finisherCarts: number;
  quizOrders: number;
  quizBuyerCarts: number;
  quizRevenue: number;
  leadsTotal: number;
  leadsBought: number;
}

export interface Insight {
  text: string;
  tone: "good" | "warn" | "info";
  tab?: "funnel" | "answers" | "products" | "leads";
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/**
 * Up to four plain-language insights, each gated on a minimum sample so a
 * low-traffic store never sees a confident claim built on three shoppers.
 */
export function buildInsights(
  cur: WindowStats,
  orders: OrderStats | null,
  topAnswer: { question: string; label: string; share: number; respondents: number } | null,
  money: (n: number) => string,
): Insight[] {
  const out: Insight[] = [];
  if (orders && orders.quizOrders >= 5 && orders.storeOrders > orders.quizOrders) {
    const quizAov = orders.quizRevenue / orders.quizOrders;
    const storeAov = orders.storeRevenue / orders.storeOrders;
    const lift = storeAov > 0 ? Math.round((quizAov / storeAov - 1) * 100) : 0;
    if (lift >= 5) {
      out.push({ tone: "good", tab: "products", text: `Quiz shoppers spend ${lift}% more per order (${money(quizAov)} vs ${money(storeAov)} store-wide).` });
    }
  }
  if (cur.finished >= 20) {
    const share = pct(Math.max(0, cur.finished - cur.engaged), cur.finished);
    if (share >= 50) {
      out.push({ tone: "warn", tab: "funnel", text: `${share}% of shoppers who see their matches don't open or add a product.` });
    }
  }
  if (cur.started >= 20) {
    const finishRate = pct(cur.finished, cur.started);
    out.push({
      tone: finishRate >= 70 ? "good" : "warn",
      tab: "funnel",
      text: `${finishRate}% of shoppers who start the quiz reach their matches.`,
    });
  }
  if (topAnswer && topAnswer.respondents >= 15) {
    out.push({ tone: "info", tab: "answers", text: `${topAnswer.label} is the top answer to "${topAnswer.question}" (${topAnswer.share}%).` });
  }
  if (cur.photoStep >= 20) {
    const skip = pct(cur.photoSkipped, cur.photoStep);
    if (skip >= 70) out.push({ tone: "info", tab: "funnel", text: `${skip}% of shoppers skip the photo step.` });
  }
  if (cur.leadViewed >= 20) {
    out.push({ tone: "info", tab: "leads", text: `${pct(cur.leadJoined, cur.leadViewed)}% of shoppers who see the email step join.` });
  }
  return out.slice(0, 4);
}

// ---- Shared by the loader and the page (no server code here) ----

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export function parseRange(raw: string | null): DashboardRange {
  const n = Number(raw);
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? (n as DashboardRange) : 30;
}

export interface DashboardQuestion {
  axisKey: string;
  prompt: string;
  multiSelect: boolean;
  options: Array<{ axisValue: string; label: string; imageUrl: string | null }>;
}

export interface DashboardProduct {
  handle: string;
  name: string;
  imageUrl: string | null;
  recommended: number;
  opened: number;
  added: number;
  orders: number | null;
  units: number | null;
}

export interface QuizDashboardData {
  range: DashboardRange;
  from: string;
  to: string;
  current: WindowStats;
  previous: WindowStats;
  /** True when the event read hit its page cap (numbers are a floor). */
  truncated: boolean;
  questions: DashboardQuestion[];
  orders: OrderStats | null;
  previousOrders: OrderStats | null;
  /** False until migration 091 runs (store totals, lead-by-cart matching). */
  orderStatsComplete: boolean;
  products: DashboardProduct[];
  productOrdersAvailable: boolean;
  leads: QuizLeadStats;
  leadAnswers: ReturnType<typeof leadAnswerCounts>;
}
