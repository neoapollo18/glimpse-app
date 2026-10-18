import { describe, it, expect } from "vitest";
import { sanitizeQuizEventProperties } from "../quiz-event-properties";
import { quizOrderLineRows } from "../quiz-order-lines";
import { aggregateWindow, buildInsights, leadAnswerCounts, type QuizEventRow } from "../quiz-dashboard";

// Quiz analytics revamp (2026-10-15): payload allowlist, order lines, and
// the shopper-based aggregation behind the new dashboard.

describe("sanitizeQuizEventProperties", () => {
  it("keeps allowlisted, well-formed fields per event and the run id", () => {
    expect(
      sanitizeQuizEventProperties("quiz_question_answered", { sid: "abc123def456", qi: 2, q: "vibe", vals: ["soft_sweet", "Bad Value!", 7], edit: true }),
    ).toEqual({ sid: "abc123def456", qi: 2, q: "vibe", vals: ["soft_sweet"], edit: true });
    expect(sanitizeQuizEventProperties("quiz_add_to_cart", { h: "red-flare", v: "4412345678", qty: 2, price: 2200 })).toEqual({
      h: "red-flare",
      v: "4412345678",
      qty: 2,
      price: 2200,
    });
    expect(
      sanitizeQuizEventProperties("quiz_add_bundle_to_bag", { items: [{ h: "a", v: "1", qty: 1 }, { nope: true }, "x"], price: 3000 }),
    ).toEqual({ items: [{ h: "a", v: "1", qty: 1 }], price: 3000 });
  });

  it("keeps the pool engine's answer IDs, auto / loosen flags, shown handles, rung and result key", () => {
    expect(
      sanitizeQuizEventProperties("quiz_question_answered", { qi: 4, q: "question_6", vals: ["option_1"], ids: ["glossy", "Not An Id"], auto: true, loosen: "yes" }),
    ).toEqual({ qi: 4, q: "question_6", vals: ["option_1"], ids: ["glossy"], auto: true });
    const handles = ["a", "b", "c", "d", "e", "f"];
    expect(
      sanitizeQuizEventProperties("quiz_results_shown", { n: 6, recs: handles, handles, rung: 3, rk: "c1.8.2.1.2.4.4", permalink: true }),
    ).toEqual({ n: 6, recs: handles, handles, rung: 3, rk: "c1.8.2.1.2.4.4", permalink: true });
    expect(sanitizeQuizEventProperties("quiz_results_shown", { n: 1, rung: 9, rk: "C1_bad key" })).toEqual({ n: 1 });
  });

  it("drops free text, contact data, unknown keys and oversized payloads", () => {
    expect(sanitizeQuizEventProperties("quiz_lead_submitted", { email: "a@b.com", has_email: true })).toEqual({ has_email: true });
    expect(sanitizeQuizEventProperties("quiz_view", { note: "hello world" })).toBeNull();
    expect(sanitizeQuizEventProperties("quiz_view_product", { h: "<script>", v: "abc" })).toBeNull();
    expect(sanitizeQuizEventProperties("quiz_results_shown", null)).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => "x".repeat(240) + i);
    expect(sanitizeQuizEventProperties("quiz_results_shown", { recs: many })).toBeNull(); // > 2 KB
  });
});

describe("quizOrderLineRows", () => {
  it("maps webhook line items to rows and skips malformed ones", () => {
    const rows = quizOrderLineRows(
      "shop-1",
      {
        id: 5550001,
        created_at: "2026-10-15T10:00:00Z",
        line_items: [
          { id: 11, product_id: 801, variant_id: 901, title: "Red Flare", quantity: 2, price: "11.00" },
          { id: null, product_id: 802 },
          { id: 12, product_id: null, variant_id: null, title: "Custom tip", quantity: 0, price: "x" },
        ],
      },
      "cart123",
    );
    expect(rows).toEqual([
      { shop_id: "shop-1", shopify_order_id: "5550001", line_item_id: "11", cart_token: "cart123", product_id: "801", variant_id: "901", title: "Red Flare", quantity: 2, price: 11, ordered_at: "2026-10-15T10:00:00Z" },
      { shop_id: "shop-1", shopify_order_id: "5550001", line_item_id: "12", cart_token: "cart123", product_id: null, variant_id: null, title: "Custom tip", quantity: 1, price: null, ordered_at: "2026-10-15T10:00:00Z" },
    ]);
    expect(quizOrderLineRows("s", { id: "bad", line_items: [{ id: 1 }] }, null)).toEqual([]);
  });
});

const ev = (event_type: string, cart: string | null, at: string, properties: Record<string, unknown> | null = null, device: string | null = "mobile"): QuizEventRow => ({
  event_type,
  cart_token: cart,
  device_type: device,
  created_at: at,
  properties,
});

describe("aggregateWindow", () => {
  const from = new Date("2026-10-10T00:00:00Z");
  const to = new Date("2026-10-13T00:00:00Z");
  const rows: QuizEventRow[] = [
    ev("quiz_view", null, "2026-10-10T09:00:00Z"),
    ev("quiz_view", null, "2026-10-10T09:01:00Z"), // reload
    ev("quiz_start", "A", "2026-10-10T09:02:00Z"),
    ev("quiz_question_answered", "A", "2026-10-10T09:02:00Z", { qi: 0, q: "vibe", vals: ["timeless"] }),
    ev("quiz_question_answered", "A", "2026-10-10T09:03:00Z", { qi: 1, q: "finish", vals: ["creme", "shimmer"] }),
    ev("quiz_recommendations_served", "A", "2026-10-10T09:04:00Z", { criteria: { vibe: "timeless", finish: ["creme", "shimmer"] }, partial: false, recs: [{ h: "red-flare" }, { h: "golden-hour" }] }),
    ev("quiz_results_shown", "A", "2026-10-10T09:04:00Z", { recs: ["red-flare", "golden-hour"] }),
    ev("quiz_results_shown", "A", "2026-10-10T09:05:00Z"), // re-render: still one shopper
    ev("quiz_view_product", "A", "2026-10-10T09:06:00Z", { h: "red-flare" }),
    ev("quiz_add_to_cart", "A", "2026-10-10T09:07:00Z", { h: "red-flare", v: "1", qty: 1 }),
    ev("quiz_start", "B", "2026-10-11T20:00:00Z", null, "desktop"),
    ev("quiz_question_answered", "B", "2026-10-11T20:01:00Z", { qi: 0, q: "vibe", vals: ["soft_sweet"] }),
    ev("quiz_lead_view", "B", "2026-10-11T20:02:00Z"),
    ev("quiz_lead_submitted", "B", "2026-10-11T20:02:30Z"),
    // previous window and future rows are excluded
    ev("quiz_start", "Z", "2026-10-09T23:59:00Z"),
    ev("quiz_start", "Y", "2026-10-13T00:00:01Z"),
  ];

  it("counts shoppers, not events", () => {
    const w = aggregateWindow(rows, from, to, 2);
    expect(w.views).toBe(2);
    expect(w.started).toBe(2);
    expect(w.finished).toBe(1);
    expect(w.opened).toBe(1);
    expect(w.added).toBe(1);
    expect(w.engaged).toBe(1);
    expect(w.leadViewed).toBe(1);
    expect(w.leadJoined).toBe(1);
    expect(w.mobile).toBe(1);
    expect(w.desktop).toBe(1);
    expect(w.hoursUtc[9]).toBe(1);
    expect(w.hoursUtc[20]).toBe(1);
  });

  it("builds daily buckets across the window", () => {
    const w = aggregateWindow(rows, from, to, 2);
    expect(w.daily.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(w.daily[0]).toEqual({ date: "2026-10-10", views: 2, started: 1, finished: 1, added: 1 });
    expect(w.daily[1].started).toBe(1);
    expect(w.daily[2].started).toBe(0);
  });

  it("question reach is exact with question indexes", () => {
    const w = aggregateWindow(rows, from, to, 2);
    expect(w.questionReachExact).toBe(true);
    expect(w.questionReach).toEqual([
      { qi: 0, axisKey: "vibe", shoppers: 2 },
      { qi: 1, axisKey: "finish", shoppers: 1 },
    ]);
  });

  it("question reach is estimated from answer counts on older events", () => {
    const old = [
      ev("quiz_question_answered", "A", "2026-10-10T09:00:00Z"),
      ev("quiz_question_answered", "A", "2026-10-10T09:01:00Z"),
      ev("quiz_question_answered", "B", "2026-10-10T09:02:00Z"),
    ];
    const w = aggregateWindow(old, from, to, 3);
    expect(w.questionReachExact).toBe(false);
    expect(w.questionReach.map((r) => r.shoppers)).toEqual([2, 1, 0]);
  });

  it("answers come from served recommendations first, products from all signals", () => {
    const w = aggregateWindow(rows, from, to, 2);
    expect(w.answersSource).toBe("served");
    expect(w.answers).toEqual({ vibe: { timeless: 1 }, finish: { creme: 1, shimmer: 1 } });
    expect(w.answerRespondents).toEqual({ vibe: 1, finish: 1 });
    expect(w.products["red-flare"]).toEqual({ recommended: 1, opened: 1, added: 1 });
    expect(w.products["golden-hour"]).toEqual({ recommended: 1, opened: 0, added: 0 });
  });

  it("falls back to per-question answers when nothing was served", () => {
    const noServed = rows.filter((r) => r.event_type !== "quiz_recommendations_served");
    const w = aggregateWindow(noServed, from, to, 2);
    expect(w.answersSource).toBe("answered");
    expect(w.answers.vibe).toEqual({ timeless: 1, soft_sweet: 1 });
    expect(w.answerRespondents.vibe).toBe(2);
    // recommended from the results payload instead
    expect(w.products["red-flare"].recommended).toBe(1);
  });

  it("a run id stands in for a missing cart token", () => {
    const w = aggregateWindow(
      [ev("quiz_start", null, "2026-10-10T10:00:00Z", { sid: "run12345" }), ev("quiz_start", null, "2026-10-10T10:00:01Z", { sid: "run12345" })],
      from,
      to,
    );
    expect(w.started).toBe(1);
  });
});

describe("leadAnswerCounts", () => {
  it("counts answers per question with respondents", () => {
    const r = leadAnswerCounts([
      { quizAnswers: [{ question: "Vibe?", answer: "Timeless" }, { question: "Colors?", answer: "Reds, Pinks" }] },
      { quizAnswers: [{ question: "Vibe?", answer: "Timeless" }] },
    ]);
    expect(r.counts).toEqual({ "Vibe?": { Timeless: 2 }, "Colors?": { Reds: 1, Pinks: 1 } });
    expect(r.respondents).toEqual({ "Vibe?": 2, "Colors?": 1 });
  });
});

describe("buildInsights", () => {
  const base = aggregateWindow([], new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"));
  const money = (n: number) => `$${n.toFixed(2)}`;

  it("stays quiet on small samples", () => {
    expect(buildInsights({ ...base, started: 5, finished: 4 }, null, null, money)).toEqual([]);
  });

  it("speaks up with enough shoppers and orders, at most four", () => {
    const cur = { ...base, started: 274, finished: 218, engaged: 45, photoStep: 235, photoSkipped: 192, leadViewed: 52, leadJoined: 17 };
    const orders = { storeOrders: 4641, storeRevenue: 208660, finisherCarts: 218, quizOrders: 25, quizBuyerCarts: 25, quizRevenue: 1471.5, leadsTotal: 17, leadsBought: 1 };
    const out = buildInsights(cur, orders, { question: "What's the vibe?", label: "Timeless", share: 35, respondents: 120 }, money);
    expect(out).toHaveLength(4);
    expect(out[0].text).toBe("Quiz shoppers spend 31% more per order ($58.86 vs $44.96 store-wide).");
    expect(out[1].text).toBe("79% of shoppers who see their matches don't open or add a product.");
    expect(out[2].text).toBe("80% of shoppers who start the quiz reach their matches.");
    expect(out[3].text).toBe('Timeless is the top answer to "What\'s the vibe?" (35%).');
  });
});
