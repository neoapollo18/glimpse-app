import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  Page,
  Tabs,
  Text,
  Tooltip,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { authenticate } from "../shopify.server";
import { findShopByDomain } from "../lib/supabase.server";
import { rememberShopCurrency } from "../lib/shop-currency.server";
import { getQuizDashboard } from "../lib/quiz-dashboard.server";
import { buildInsights, parseRange, DASHBOARD_RANGES, type Insight, type QuizDashboardData, type WindowStats } from "../lib/quiz-dashboard";

// Quiz analytics (2026-10-15 revamp). One dashboard, five tabs, every rate
// per shopper (one cart or quiz run), with the previous period for change.
// The pre-revamp page lives in app/archive/app.analytics.classic.tsx.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = parseRange(url.searchParams.get("range"));
  const [data, shop] = await Promise.all([
    getQuizDashboard(session.shop, range),
    findShopByDomain(session.shop).catch(() => null),
  ]);
  const currency = shop ? await rememberShopCurrency(shop.id, (q) => admin.graphql(q)).catch(() => null) : null;
  return json({ data, currency, range });
};

type TabId = "overview" | "funnel" | "answers" | "products" | "leads";
// Short labels so all five fit side by side on a phone.
const TABS: Array<{ id: TabId; content: string }> = [
  { id: "overview", content: "Overview" },
  { id: "funnel", content: "Funnel" },
  { id: "answers", content: "Answers" },
  { id: "products", content: "Products" },
  { id: "leads", content: "Leads" },
];

const BLUE = "#2C6ECB";
const BLUE_SOFT = "#A9C6F0";
const GRID = "#E3E3E3";
const MUTED = "#616161";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function useMoney(currency: string | null) {
  return useMemo(() => {
    const make = (digits: number) => {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
      } catch {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
      }
    };
    const whole = make(0);
    const cents = make(2);
    return { whole: (n: number) => whole.format(n), cents: (n: number) => cents.format(n) };
  }, [currency]);
}

/** Change vs the previous period: % for counts, points for rates. */
function Delta({ cur, prev, kind = "count" }: { cur: number; prev: number | null; kind?: "count" | "rate" }) {
  if (prev == null) return null;
  if (kind === "rate") {
    const d = Math.round(cur - prev);
    if (d === 0) return <Badge>No change</Badge>;
    return <Badge tone={d > 0 ? "success" : "critical"}>{`${d > 0 ? "+" : ""}${d} pts`}</Badge>;
  }
  if (prev === 0) return cur > 0 ? <Badge tone="success">New</Badge> : null;
  const d = Math.round((cur / prev - 1) * 100);
  if (d === 0) return <Badge>No change</Badge>;
  return <Badge tone={d > 0 ? "success" : "critical"}>{`${d > 0 ? "+" : ""}${d}%`}</Badge>;
}

function Kpi({ label, value, sub, delta, help }: { label: string; value: string; sub?: ReactNode; delta?: ReactNode; help?: string }) {
  const title = (
    <Text as="span" variant="bodySm" tone="subdued">
      {label}
    </Text>
  );
  return (
    <Card padding="400">
      <BlockStack gap="100">
        {help ? <Tooltip content={help}>{title}</Tooltip> : title}
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="headingXl">
            {value}
          </Text>
          {delta}
        </InlineStack>
        {sub ? (
          <Text as="span" variant="bodySm" tone="subdued">
            {sub}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function Bars({ rows, soft }: { rows: Array<{ label: string; value: number; display: string; flag?: string }>; soft?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <BlockStack gap="200">
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 200px) 1fr minmax(70px, auto)", gap: 10, alignItems: "center" }}>
          <Text as="span" variant="bodySm">
            {r.label} {r.flag ? <Badge tone="warning">{r.flag}</Badge> : null}
          </Text>
          <div style={{ height: 10, borderRadius: 999, background: "#F1F1F1", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, height: "100%", borderRadius: 999, background: soft ? BLUE_SOFT : BLUE }} />
          </div>
          <Text as="span" variant="bodySm" tone="subdued" alignment="end">
            {r.display}
          </Text>
        </div>
      ))}
    </BlockStack>
  );
}

function TrendChart({ daily }: { daily: WindowStats["daily"] }) {
  const W = 640;
  const H = 210;
  const L = 34;
  const R = 12;
  const T = 10;
  const B = 26;
  const top = Math.max(4, ...daily.map((d) => d.started));
  const step = top <= 10 ? 2 : top <= 40 ? 10 : top <= 100 ? 20 : Math.ceil(top / 5 / 50) * 50;
  const max = Math.ceil(top / step) * step;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (i: number) => L + (daily.length <= 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = (v: number) => T + ih - (v / max) * ih;
  const line = (k: "started" | "finished") => daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d[k]).toFixed(1)}`).join(" ");
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const labelAt = daily.length > 1 ? [0, Math.round((daily.length - 1) / 2), daily.length - 1] : [0];
  const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Shoppers per day" style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
            {v}
          </text>
        </g>
      ))}
      {daily.length > 1 && (
        <path d={`${line("started")} L${x(daily.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={BLUE} opacity={0.1} />
      )}
      <path d={line("finished")} fill="none" stroke={BLUE_SOFT} strokeWidth={2} />
      <path d={line("started")} fill="none" stroke={BLUE} strokeWidth={2.2} />
      {labelAt.map((i, n) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={n === 0 ? "start" : n === labelAt.length - 1 ? "end" : "middle"} fontSize={11} fill={MUTED}>
          {fmt(daily[i].date)}
        </text>
      ))}
    </svg>
  );
}

function HoursChart({ hoursUtc }: { hoursUtc: number[] }) {
  // Shift to the viewer's own clock after mount (SSR renders UTC).
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(Math.round(-new Date().getTimezoneOffset() / 60)), []);
  const hours = Array.from({ length: 24 }, (_, h) => hoursUtc[(((h - offset) % 24) + 24) % 24] || 0);
  const W = 480;
  const H = 160;
  const L = 6;
  const R = 6;
  const T = 8;
  const B = 22;
  const max = Math.max(1, ...hours);
  const bw = (W - L - R) / 24;
  const ih = H - T - B;
  const peak = hours.indexOf(max);
  const lab = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Quiz starts by hour, your time" style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={L} x2={W - R} y1={T + ih} y2={T + ih} stroke={GRID} />
      {hours.map((v, h) => (
        <rect key={h} x={L + h * bw + 2} y={T + ih - (v / max) * ih} width={bw - 4} height={(v / max) * ih} rx={2} fill={h === peak && v > 0 ? BLUE : BLUE_SOFT} />
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={L + h * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>
          {lab(h)}
        </text>
      ))}
    </svg>
  );
}

function Section({ title, badge, children, hint }: { title: string; badge?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          {badge}
        </InlineStack>
        {children}
        {hint ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {hint}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function QuizAnalytics() {
  const { data, currency, range } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const initialTab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "overview") as TabId;
  const [tab, setTab] = useState<TabId>(initialTab);
  const money = useMoney(currency);

  const setRange = (r: number) =>
    setParams(
      (p) => {
        p.set("range", String(r));
        p.set("tab", tab);
        return p;
      },
      { preventScrollReset: true },
    );

  if (!data) {
    return (
      <Page>
        <TitleBar title="Analytics" />
        <Banner tone="critical">We couldn&rsquo;t load your quiz analytics. Reload the page to try again.</Banner>
      </Page>
    );
  }
  const d = data as unknown as QuizDashboardData;
  const cur = d.current;
  const prev = d.previous;

  return (
    // The admin title bar names the page; no second title under it.
    <Page fullWidth>
      <TitleBar title="Analytics" />
      <BlockStack gap="400">
        {/* Cards run edge to edge on a phone; this line keeps a gutter. */}
        <Box paddingInline={{ xs: "400", sm: "0" }} paddingBlockStart={{ xs: "400", sm: "0" }}>
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              How shoppers use your quiz: last {range} days, compared with the {range} days before. A shopper is one cart.
            </Text>
            <ButtonGroup variant="segmented">
              {DASHBOARD_RANGES.map((r) => (
                <Button key={r} pressed={range === r} onClick={() => setRange(r)}>
                  {`${r} days`}
                </Button>
              ))}
            </ButtonGroup>
          </InlineStack>
        </Box>
        <Card padding="0">
          <Tabs tabs={TABS} selected={TABS.findIndex((t) => t.id === tab)} onSelect={(i) => setTab(TABS[i].id)} fitted />
        </Card>
        {d.truncated && (
          <Banner tone="info">This range has more quiz activity than we read in one go, so the numbers are a minimum. Try a shorter range.</Banner>
        )}
        {tab === "overview" && <Overview d={d} cur={cur} prev={prev} money={money} onTab={setTab} />}
        {tab === "funnel" && <Funnel d={d} cur={cur} />}
        {tab === "answers" && <Answers d={d} cur={cur} />}
        {tab === "products" && <Products d={d} money={money} />}
        {tab === "leads" && <Leads d={d} range={range} />}
      </BlockStack>
    </Page>
  );
}

type Money = ReturnType<typeof useMoney>;

function topAnswer(d: QuizDashboardData) {
  const cur = d.current;
  for (const q of d.questions) {
    const counts = cur.answers[q.axisKey];
    const n = cur.answerRespondents[q.axisKey] || 0;
    if (!counts || n === 0) continue;
    const [value, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const label = q.options.find((o) => o.axisValue === value)?.label ?? value;
    return { question: q.prompt, label, share: pct(c, n), respondents: n };
  }
  return null;
}

function NoActivity({ range }: { range: number }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          No quiz activity in the last {range} days
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Once shoppers start your quiz, this page shows how far they get, what they answer and what they buy. Check the quiz is turned on and linked from your store, or try a longer range.
        </Text>
      </BlockStack>
    </Card>
  );
}

function Overview({ d, cur, prev, money, onTab }: { d: QuizDashboardData; cur: WindowStats; prev: WindowStats; money: Money; onTab: (t: TabId) => void }) {
  if (cur.views === 0 && cur.started === 0) return <NoActivity range={d.range} />;
  const o = d.orders;
  const po = d.previousOrders;
  const finishRate = pct(cur.finished, cur.started);
  const addRate = pct(cur.added, cur.finished);
  const aovLift =
    o && o.quizOrders > 0 && o.storeOrders > o.quizOrders
      ? Math.round((o.quizRevenue / o.quizOrders / (o.storeRevenue / o.storeOrders) - 1) * 100)
      : null;
  const insights: Insight[] = buildInsights(cur, d.orderStatsComplete ? o : null, topAnswer(d), money.cents);
  const peakUtc = cur.hoursUtc.indexOf(Math.max(...cur.hoursUtc));
  const mobileShare = pct(cur.mobile, cur.mobile + cur.desktop);
  const tops = d.questions
    .slice(0, 3)
    .map((q) => {
      const counts = cur.answers[q.axisKey];
      if (!counts || (cur.answerRespondents[q.axisKey] || 0) < 15) return null;
      const [value] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return q.options.find((x) => x.axisValue === value)?.label ?? value;
    })
    .filter(Boolean);
  return (
    <BlockStack gap="400">
      <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
        <Kpi label="Shoppers who started" value={cur.started.toLocaleString()} sub={`from ${cur.views.toLocaleString()} page views`} delta={<Delta cur={cur.started} prev={prev.started} />} help="Distinct carts that answered the first question." />
        <Kpi label="Reached their matches" value={`${finishRate}%`} sub={`${cur.finished.toLocaleString()} shoppers`} delta={<Delta cur={finishRate} prev={prev.started ? pct(prev.finished, prev.started) : null} kind="rate" />} />
        <Kpi label="Added to cart" value={`${addRate}%`} sub={`${cur.added.toLocaleString()} of ${cur.finished.toLocaleString()} who saw matches`} delta={<Delta cur={addRate} prev={prev.finished ? pct(prev.added, prev.finished) : null} kind="rate" />} />
        <Kpi
          label="Quiz revenue"
          value={o ? money.whole(o.quizRevenue) : "—"}
          sub={o ? `${o.quizOrders.toLocaleString()} orders${aovLift != null && aovLift > 0 ? ` · +${aovLift}% per order` : ""}` : "Appears after the first quiz order"}
          delta={o ? <Delta cur={o.quizRevenue} prev={po ? po.quizRevenue : null} /> : undefined}
          help="Orders from carts that reached their matches in this range."
        />
      </InlineGrid>
      <InlineGrid columns={{ xs: 1, md: "3fr 2fr" }} gap="400">
        <Section title="Shoppers per day" hint={<><span style={{ color: BLUE }}>■</span> Started &nbsp; <span style={{ color: BLUE_SOFT }}>■</span> Reached matches</>}>
          <TrendChart daily={cur.daily} />
        </Section>
        <Section title="What to look at">
          {insights.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Insights appear once at least 20 shoppers have taken the quiz in this range.
            </Text>
          ) : (
            <BlockStack gap="300">
              {insights.map((i) => (
                <InlineStack key={i.text} align="space-between" blockAlign="center" gap="200" wrap={false}>
                  <Text as="p" variant="bodyMd">
                    {i.text}
                  </Text>
                  {i.tab ? (
                    <Button variant="plain" onClick={() => onTab(i.tab!)}>
                      {TABS.find((t) => t.id === i.tab)!.content}
                    </Button>
                  ) : null}
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </Section>
      </InlineGrid>
      {cur.started >= 20 && (
        <Box background="bg-surface-info" padding="400" borderRadius="300">
          <Text as="p" variant="bodyMd">
            <b>Typical quiz shopper:</b> {cur.mobile + cur.desktop > 0 ? `${mobileShare >= 50 ? "on a phone" : "on a computer"} (${Math.max(mobileShare, 100 - mobileShare)}%)` : "on any device"}
            {Math.max(...cur.hoursUtc) > 0 ? <PeakHour utcHour={peakUtc} /> : null}
            {tops.length > 0 ? `, answering ${tops.join(", ")}` : ""}.
          </Text>
        </Box>
      )}
    </BlockStack>
  );
}

function PeakHour({ utcHour }: { utcHour: number }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const local = new Date(Date.UTC(2026, 0, 1, utcHour, 0, 0));
    setLabel(local.toLocaleTimeString(undefined, { hour: "numeric" }));
  }, [utcHour]);
  return label ? <>{`, busiest around ${label} your time`}</> : null;
}

function Funnel({ d, cur }: { d: QuizDashboardData; cur: WindowStats }) {
  if (cur.views === 0 && cur.started === 0) return <NoActivity range={d.range} />;
  const ordered = d.orders && d.orderStatsComplete ? d.orders.quizBuyerCarts : null;
  const steps = [
    { label: "Started", value: cur.started },
    { label: "Reached matches", value: cur.finished },
    { label: "Opened or added a product", value: cur.engaged },
    { label: "Added to cart", value: cur.added },
    ...(ordered != null ? [{ label: "Ordered", value: ordered }] : []),
  ];
  // Biggest drop between consecutive steps with a meaningful base.
  let drop: { from: string; to: string; lost: number; share: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    if (a.value < 20 || b.label === "Added to cart") continue;
    const share = pct(a.value - b.value, a.value);
    if (!drop || share > drop.share) drop = { from: a.label, to: b.label, lost: a.value - b.value, share };
  }
  const reach = cur.questionReach;
  let worst = -1;
  let worstShare = 0;
  for (let i = 1; i < reach.length; i++) {
    const share = pct(reach[i - 1].shoppers - reach[i].shoppers, reach[i - 1].shoppers);
    if (reach[i - 1].shoppers >= 20 && share > worstShare) {
      worst = i;
      worstShare = share;
    }
  }
  const qLabel = (qi: number, axisKey: string | null) => {
    const q = (axisKey && d.questions.find((x) => x.axisKey === axisKey)) || d.questions[qi];
    return `${qi + 1}. ${q ? q.prompt : `Question ${qi + 1}`}`;
  };
  const health: Array<{ title: string; value: string; sub: string }> = [];
  if (cur.leadViewed > 0) health.push({ title: "Email step", value: `${pct(cur.leadJoined, cur.leadViewed)}% join`, sub: `${cur.leadJoined} of ${cur.leadViewed} who saw it` });
  if (cur.photoStep > 0) health.push({ title: "Photo step", value: `${pct(cur.photoSkipped, cur.photoStep)}% skip`, sub: `${cur.photoUploaded} added a photo` });
  if (cur.shadeDetected + cur.shadeFailed > 0) health.push({ title: "Shade detection", value: `${pct(cur.shadeFailed, cur.shadeDetected + cur.shadeFailed)}% failed`, sub: `${cur.shadeDetected} detected from photos` });
  if (cur.mobile + cur.desktop > 0) health.push({ title: "Device", value: `${pct(cur.mobile, cur.mobile + cur.desktop)}% mobile`, sub: `${cur.mobile} phone, ${cur.desktop} computer` });
  if (cur.finished > 0) health.push({ title: "Retakes", value: `${pct(cur.restarted, cur.finished)}%`, sub: `${cur.restarted} shoppers started over` });
  if (cur.bundleAdds + cur.crossSellViews > 0) health.push({ title: "Bundle & cross-sell", value: `${cur.bundleAdds} bundle adds`, sub: `${cur.crossSellAdds} add-ons from ${cur.crossSellViews} who saw them` });
  return (
    <BlockStack gap="400">
      <Section title="Where shoppers go">
        <Bars rows={steps.map((s, i) => ({ label: s.label, value: s.value, display: i === 0 ? s.value.toLocaleString() : `${s.value.toLocaleString()} · ${pct(s.value, steps[0].value)}%` }))} />
        {drop && drop.share > 0 ? (
          <Banner tone="warning">
            <Text as="p" variant="bodyMd">
              <b>Biggest drop:</b> {drop.lost.toLocaleString()} shoppers ({drop.share}%) leave between &ldquo;{drop.from}&rdquo; and &ldquo;{drop.to}&rdquo;.
            </Text>
          </Banner>
        ) : null}
      </Section>
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Section
          title="Reach by question"
          badge={cur.questionReachExact ? null : <Badge>Estimated</Badge>}
          hint={
            reach.length === 0
              ? "Appears once shoppers answer questions in this range."
              : worst > 0
                ? `Question ${worst + 1} loses the most shoppers (${worstShare}%).${cur.questionReachExact ? "" : " Exact per-question numbers start with this release."}`
                : cur.questionReachExact
                  ? undefined
                  : "Estimated from how many answers each shopper gave. Exact per-question numbers start with this release."
          }
        >
          <Bars soft rows={reach.map((r, i) => ({ label: qLabel(r.qi, r.axisKey), value: r.shoppers, display: r.shoppers.toLocaleString(), flag: i === worst ? "Biggest drop" : undefined }))} />
        </Section>
        <Section title="When shoppers take the quiz" hint="Quiz starts by hour, in your time.">
          <HoursChart hoursUtc={cur.hoursUtc} />
        </Section>
      </InlineGrid>
      {health.length > 0 && (
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          {health.map((h) => (
            <Card key={h.title}>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  {h.title}
                </Text>
                <Text as="p" variant="headingLg">
                  {h.value}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {h.sub}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      )}
    </BlockStack>
  );
}

function Answers({ d, cur }: { d: QuizDashboardData; cur: WindowStats }) {
  const fromEvents = cur.answersSource !== null;
  const leadTotal = d.leads.leads.length;
  const cards: Array<{ key: string; title: string; multi: boolean; n: number; rows: Array<{ label: string; value: number }> }> = [];
  if (fromEvents) {
    for (const q of d.questions) {
      const counts = cur.answers[q.axisKey];
      const n = cur.answerRespondents[q.axisKey] || 0;
      if (!counts || n === 0) continue;
      const rows = Object.entries(counts)
        .map(([v, c]) => ({ label: q.options.find((o) => o.axisValue === v)?.label ?? v, value: c }))
        .sort((a, b) => b.value - a.value);
      cards.push({ key: q.axisKey, title: q.prompt, multi: q.multiSelect, n, rows });
    }
  } else {
    for (const [question, counts] of Object.entries(d.leadAnswers.counts)) {
      const n = d.leadAnswers.respondents[question] || 0;
      const rows = Object.entries(counts).map(([label, c]) => ({ label, value: c })).sort((a, b) => b.value - a.value);
      cards.push({ key: question, title: question, multi: rows.reduce((s, r) => s + r.value, 0) > n, n, rows });
    }
  }
  return (
    <BlockStack gap="400">
      <Banner tone={fromEvents ? "info" : "warning"}>
        {fromEvents
          ? `Answers from ${Math.max(0, ...Object.values(cur.answerRespondents)).toLocaleString()} shoppers who reached their matches in this range.`
          : leadTotal > 0
            ? `Early signal from ${leadTotal} email ${leadTotal === 1 ? "lead" : "leads"}. Answers from every shopper who finishes start appearing with this release.`
            : "Answers from every shopper who finishes start appearing with this release."}
      </Banner>
      {cards.length === 0 ? null : (
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          {cards.map((c) => (
            <Section
              key={c.key}
              title={c.title}
              badge={
                <InlineStack gap="100">
                  {c.multi ? <Badge>Pick several</Badge> : null}
                  {c.n < 20 ? <Badge tone="warning">{`Early signal · ${c.n}`}</Badge> : null}
                </InlineStack>
              }
              hint={c.multi ? "Share of shoppers who picked each answer." : undefined}
            >
              <Bars rows={c.rows.map((r) => ({ label: r.label, value: r.value, display: `${pct(r.value, c.n)}%` }))} />
            </Section>
          ))}
        </InlineGrid>
      )}
    </BlockStack>
  );
}

function Products({ d, money }: { d: QuizDashboardData; money: Money }) {
  const o = d.orders;
  const aov = o && o.quizOrders > 0 ? o.quizRevenue / o.quizOrders : null;
  const storeAov = o && o.storeOrders > 0 ? o.storeRevenue / o.storeOrders : null;
  const rows = d.products.map((p) => [
    p.name,
    p.recommended.toLocaleString(),
    p.opened.toLocaleString(),
    p.added.toLocaleString(),
    p.orders == null ? "—" : p.orders.toLocaleString(),
  ]);
  return (
    <BlockStack gap="400">
      <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
        <Kpi label="Quiz orders" value={o ? o.quizOrders.toLocaleString() : "—"} sub={o && o.finisherCarts > 0 ? `${pct(o.quizBuyerCarts, o.finisherCarts)}% of shoppers who saw matches bought` : undefined} />
        <Kpi label="Quiz revenue" value={o ? money.whole(o.quizRevenue) : "—"} sub={o && o.storeRevenue > 0 ? `${((o.quizRevenue / o.storeRevenue) * 100).toFixed(1)}% of store revenue` : undefined} />
        <Kpi label="Quiz order value" value={aov != null ? money.cents(aov) : "—"} sub={storeAov != null ? `store average ${money.cents(storeAov)}` : undefined} />
        <Kpi label="Bundle adds" value={d.current.bundleAdds.toLocaleString()} sub={`${d.current.discountApplied} with the bundle discount applied`} />
      </InlineGrid>
      <Section
        title="Products"
        hint={
          d.products.length === 0
            ? "Shows what the quiz recommends, and what shoppers open, add and buy, as quiz activity comes in with this release."
            : `Shoppers per product in this range.${d.productOrdersAvailable ? " Ordered counts orders from quiz carts." : " Ordered appears once order tracking is set up."}`
        }
      >
        {d.products.length > 0 && (
          <DataTable
            columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
            headings={["Product", "Recommended", "Opened", "Added", "Ordered"]}
            rows={rows}
            truncate
          />
        )}
      </Section>
      <Text as="p" variant="bodySm" tone="subdued">
        An order counts as a quiz order when it comes from a cart that reached its matches during this range.
      </Text>
    </BlockStack>
  );
}

function Leads({ d, range }: { d: QuizDashboardData; range: number }) {
  const leadStats = d.leads;
  const cur = d.current;
  const o = d.orders;
  const leadAnswerSummary = (lead: QuizDashboardData["leads"]["leads"][number]) =>
    lead.quizAnswers.map((a) => `${a.question}: ${a.answer}`).join(" · ");
  const exportLeadsCsv = () => {
    // Emails and answers are shopper-typed via a public endpoint: a leading
    // = + - @ or tab would execute as a formula when the merchant opens the
    // export in Excel/Sheets (CSV injection), so neutralize it with a
    // leading apostrophe. BOM so Excel decodes UTF-8 labels.
    const esc = (v: string) => {
      const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["Email", "Phone", "Device", "Captured at", "Quiz answers", "Matches shown"],
      ...leadStats.leads.map((lead) => [
        lead.email ?? "",
        lead.phone ?? "",
        lead.deviceType ?? "",
        new Date(lead.createdAt).toISOString(),
        leadAnswerSummary(lead),
        (lead.matchesShown ?? []).join(" · "),
      ]),
    ];
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz-leads-last-${range}-days.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <BlockStack gap="400">
      <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
        <Kpi label="Leads" value={leadStats.count.toLocaleString()} sub={`in the last ${range} days`} />
        <Kpi label="Join rate" value={cur.leadViewed > 0 ? `${pct(cur.leadJoined, cur.leadViewed)}%` : "—"} sub={cur.leadViewed > 0 ? `${cur.leadJoined} of ${cur.leadViewed} who saw the email step` : "Turn on the email step in Studio"} />
        <Kpi label="Leads who bought" value={o ? o.leadsBought.toLocaleString() : "—"} sub={d.orderStatsComplete ? "same cart or email, within 60 days" : "email match within 60 days"} />
        <Kpi label="Contact type" value={`${leadStats.leads.filter((l) => l.email).length} email`} sub={`${leadStats.leads.filter((l) => l.phone).length} with a phone number`} />
      </InlineGrid>
      {leadStats.count === 0 ? (
        <Card>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              No leads captured yet
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Turn on the email step in Studio and shoppers&rsquo; emails, with their quiz answers, appear here.
            </Text>
          </BlockStack>
        </Card>
      ) : (
        <Card padding="0">
          <Box padding="400" paddingBlockEnd="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  {leadStats.count.toLocaleString()} {leadStats.count === 1 ? "lead" : "leads"} in the last {range} days
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  Each lead includes the shopper&rsquo;s quiz answers at submit time.
                </Text>
              </BlockStack>
              <Button onClick={exportLeadsCsv} disabled={leadStats.leads.length === 0}>
                Export CSV
              </Button>
            </InlineStack>
          </Box>
          <Divider />
          <Box padding="400" paddingBlockStart="300" paddingBlockEnd="300" background="bg-surface-secondary">
            <InlineGrid columns={{ xs: "1fr 1fr", md: "1.4fr 0.6fr 0.8fr 2fr" }} gap="400" alignItems="center">
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Contact
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Device
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Captured
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Quiz answers
              </Text>
            </InlineGrid>
          </Box>
          {leadStats.leads.slice(0, 50).map((lead, index) => (
            <div key={lead.id}>
              {index > 0 && <Divider />}
              <Box padding="400" paddingBlockStart="300" paddingBlockEnd="300">
                <InlineGrid columns={{ xs: "1fr 1fr", md: "1.4fr 0.6fr 0.8fr 2fr" }} gap="400" alignItems="start">
                  <BlockStack gap="050">
                    {lead.email && (
                      <Text as="span" variant="bodyMd" fontWeight="semibold" breakWord>
                        {lead.email}
                      </Text>
                    )}
                    {lead.phone && (
                      <Text as="span" variant={lead.email ? "bodySm" : "bodyMd"} tone={lead.email ? "subdued" : undefined} fontWeight={lead.email ? undefined : "semibold"}>
                        {lead.phone}
                      </Text>
                    )}
                  </BlockStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {lead.deviceType ?? "—"}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {leadAnswerSummary(lead) || "—"}
                  </Text>
                </InlineGrid>
              </Box>
            </div>
          ))}
          {leadStats.count > 50 && (
            <>
              <Divider />
              <Box padding="300">
                <Text as="span" variant="bodySm" tone="subdued">
                  Showing the 50 most recent. Export CSV includes up to the {leadStats.leads.length.toLocaleString()} newest leads in this range.
                </Text>
              </Box>
            </>
          )}
        </Card>
      )}
    </BlockStack>
  );
}
