import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher, useSearchParams, useRevalidator } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  InlineGrid,
  Banner,
  Select,
} from "@shopify/polaris";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  supabase,
  getRecommendationCounts,
  getChatAssistantConfig,
  findShopByDomain,
  shopHasTryOnConfig,
  getConfiguredProducts,
  getQuizEngagement,
  getOnboardingState,
} from "../lib/supabase.server";

// Z0 (V3-SPEC Part 1): the setup wizard, its step components, the manual
// catalog-sync button and the OVERHAUL_ONBOARDING gate are gone. A shop
// with no quiz that would previously have seen the wizard is sent to
// /app/onboarding/scope by the loader; everyone else gets the dashboard.
// shops.overhaul_enabled stays as a column, unread.

// ============================================================
// Types
// ============================================================

interface LoaderData {
  shopDomain: string;
  ownerName: string;
  quiz: {
    questions: number;
    rules: number;
    mode: string;
    hasGuidance: boolean;
    assistantMode: string;
    quizLive: boolean;
    vtoEnabled: boolean;
  };
  totalTransformations: number;
  quizMatches: number;
}

// ============================================================
// Loader
// ============================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let ownerName = "";
  try {
    const response = await admin.graphql(`
      query GetShopOwner {
        shop {
          shopOwnerName
        }
      }
    `);
    const data = await response.json();
    ownerName = data.data?.shop?.shopOwnerName || "";
  } catch (error) {
    console.error("Error fetching shop owner name:", error);
  }

  const shopRow = await findShopByDomain(shopDomain).catch(() => null);
  // The dashboard renders exactly ONE analytics number (the transformation
  // total); getAnalytics also ran a per-product pagination of up to 10x1000
  // joined rows that was entirely discarded here. Inline the single exact
  // head-count query instead.
  const transformSince = new Date();
  transformSince.setDate(transformSince.getDate() - 365);
  const [allProducts, onboarding, chatConfig, quizEngagement, transformCountRes] = await Promise.all([
    getConfiguredProducts(shopDomain),
    getOnboardingState(shopDomain),
    getChatAssistantConfig(shopDomain).catch(() => null),
    getQuizEngagement(shopDomain, 365).catch(() => null),
    shopRow
      ? supabase
          .from("analytics_events")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopRow.id)
          .eq("event_type", "transformation")
          .gte("created_at", transformSince.toISOString())
      : Promise.resolve(null),
  ]);
  const [counts, vtoEnabled] = shopRow
    ? await Promise.all([
        getRecommendationCounts(shopRow.id).catch(() => null),
        shopHasTryOnConfig(shopDomain).catch(() => true),
      ])
    : [null, true];
  const quiz = {
    questions: counts?.questions ?? 0,
    rules: counts?.rules ?? 0,
    mode: (chatConfig?.recommendation_mode as string) ?? "matrix",
    hasGuidance: Boolean(String(chatConfig?.ai_guidance ?? "").trim()),
    assistantMode: (chatConfig?.assistant_mode as string) ?? "chat",
    quizLive: Boolean(
      chatConfig?.enabled &&
        (chatConfig?.assistant_mode === "quiz" || chatConfig?.assistant_mode === "both"),
    ),
    vtoEnabled,
  };

  // "Configured" means TRY-ON configured (has a transformation prompt).
  // Catalog sync inserts prompt-less rows into the same table; counting
  // those would flip the skip heuristic below for mid-sync shops.
  const configuredProductsCount = allProducts.filter(
    (p: any) => typeof p.transformation_prompt === "string" && p.transformation_prompt.length > 0,
  ).length;

  // Onboarding routing (V3-CONTRACTS §10). Exactly the shops the wizard used
  // to catch go to /app/onboarding/scope: no quiz questions AND none of the
  // long-standing skip heuristics:
  //   1. onboarding explicitly completed, OR
  //   2. 2+ try-on products configured (clearly set up), OR
  //   3. try-on products but never started onboarding (pre-existing), OR
  //   4. the quiz is live.
  // Every shop WITH a quiz (ORLY, L&M, Glamnetic, every live merchant) has
  // questions > 0 and never enters onboarding, whatever the flags say.
  const quizIsLive = quiz.questions > 0 && quiz.quizLive;
  const shouldSkipOnboarding =
    onboarding.completed ||
    configuredProductsCount >= 2 ||
    (configuredProductsCount > 0 && onboarding.step === 0) ||
    quizIsLive;
  if (shopRow && quiz.questions === 0 && !shouldSkipOnboarding) {
    // Carry the embedded-admin params (host/shop/embedded) so App Bridge
    // doesn't re-bootstrap the frame on the redirect.
    const search = new URL(request.url).search;
    throw redirect(`/app/onboarding/scope${search}`);
  }

  return json<LoaderData>({
    shopDomain,
    ownerName,
    quiz,
    totalTransformations: transformCountRes?.count ?? 0,
    quizMatches: quizEngagement?.resultsShown ?? 0,
  });
};

// ============================================================
// Action
// ============================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "set-mode": {
      // Storefront surface toggle (moved here from the old quiz hub).
      const mode = formData.get("assistant_mode") as string;
      if (mode !== "chat" && mode !== "quiz" && mode !== "both") {
        return json({ ok: false, error: "Invalid mode" }, { status: 400 });
      }
      const { saveChatAssistantConfig } = await import("../lib/supabase.server");
      try {
        await saveChatAssistantConfig(shopDomain, {
          assistant_mode: mode,
          ...(mode === "quiz" || mode === "both" ? { enabled: true } : {}),
        });
      } catch (err) {
        return json(
          { ok: false, error: err instanceof Error ? err.message : "Failed to save" },
          { status: 500 },
        );
      }
      return json({ ok: true, intent });
    }
    default:
      return json({ error: "Unknown intent" }, { status: 400 });
  }
};

// ============================================================
// Dashboard View (existing dashboard)
// ============================================================

// Quiz-first home: intro + status + one obvious door into the Studio
// (which hosts everything else). Replaces both the old try-on dashboard
// and the standalone quiz hub page.

const THEME_EXT_UUID = "1013fc3f-b18d-aa39-07f6-10dfd57397a6749693b0";

const GLEAME_HERO_CSS = `
  .gleame-hero { position: relative; overflow: hidden; border-radius: 20px; background: linear-gradient(135deg, #FFFFFF 0%, #F7F3FF 55%, #FFF1EA 100%); border: 1px solid #ECE8F4; padding: 40px 48px; box-shadow: 0 6px 24px rgba(23, 23, 27, 0.06); }
  .gleame-hero-glow { position: absolute; width: 420px; height: 420px; border-radius: 50%; top: -240px; right: -100px; background: radial-gradient(circle, rgba(196, 164, 255, 0.18) 0%, rgba(196, 164, 255, 0) 65%); pointer-events: none; }
  .gleame-hero-glow-2 { top: auto; right: auto; bottom: -280px; left: -120px; background: radial-gradient(circle, rgba(255, 178, 145, 0.14) 0%, rgba(255, 178, 145, 0) 65%); }
  .gleame-hero-content { position: relative; max-width: 640px; }
  .gleame-hero-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .gleame-hero-logo { width: 36px; height: 36px; display: block; }
  .gleame-hero-title { margin: 0 0 8px; color: #1A1A1E; font-weight: 700; font-size: 28px; line-height: 1.2; letter-spacing: -0.01em; }
  .gleame-hero-sub { margin: 0 0 24px; color: #5C5F66; font-size: 15px; line-height: 1.55; max-width: 520px; }
  .gleame-hero-actions { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .gleame-hero-cta { border: 0; cursor: pointer; background: #1A1A1E; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 22px; border-radius: 12px; box-shadow: 0 3px 12px rgba(26, 26, 30, 0.22); transition: transform 140ms ease, box-shadow 140ms ease; }
  .gleame-hero-cta:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(26, 26, 30, 0.28); }
  .gleame-hero-ghost { border: 0; cursor: pointer; background: transparent; color: #5C5F66; font-size: 13px; font-weight: 600; padding: 8px 4px; }
  .gleame-hero-ghost:hover { color: #1A1A1E; }
  @media (max-width: 640px) { .gleame-hero { padding: 28px 24px; } .gleame-hero-title { font-size: 23px; } }
`;

const HOME_MODE_LABELS: Record<string, string> = {
  matrix: "Rules only",
  ai: "AI",
  hybrid: "Rules + AI",
};

function DashboardView({
  ownerName,
  shopDomain,
  quiz,
  totalTransformations,
  quizMatches,
  navigate,
}: {
  ownerName: string;
  shopDomain: string;
  quiz: LoaderData["quiz"];
  totalTransformations: number;
  quizMatches: number;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const ownerFirstName = ownerName ? ownerName.split(" ")[0] : "";
  const storeName = shopDomain
    .replace(".myshopify.com", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const displayName = ownerFirstName || storeName;

  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator();
  const studioOpen = params.get("open") === "studio";
  const studioStep = params.get("step") ?? "build";
  // Per-tab token: BroadcastChannel reaches EVERY same-origin admin tab;
  // without this a studio click navigated other dashboards too. Minted
  // client-side only — a render-time random value hydrates differently
  // than the SSR pass, and the server-rendered iframe src would carry a
  // token the listener never accepts.
  const [navToken, setNavToken] = useState<string | null>(null);
  useEffect(() => {
    setNavToken(Math.random().toString(36).slice(2, 10));
  }, []);
  const openStudio = () => {
    setParams(
      (prev) => {
        prev.set("open", "studio");
        return prev;
      },
      { replace: true },
    );
  };
  const closeStudio = () => {
    setParams(
      (prev) => {
        prev.delete("open");
        prev.delete("step");
        return prev;
      },
      { replace: true },
    );
    revalidator.revalidate();
  };

  // The studio (max-modal iframe) can't navigate the app frame itself;
  // it broadcasts, we close the modal and route.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("gleame-studio-nav");
      channel.onmessage = (e: MessageEvent) => {
        const data = e.data as { url?: string; token?: string } | null;
        const url = String(data?.url ?? "");
        if (!url.startsWith("/app")) return;
        if (data?.token !== navToken) return; // another tab's studio
        closeStudio();
        navigate(url);
      };
    } catch {
      // BroadcastChannel unsupported: studio falls back to _top navigation.
    }
    return () => channel?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToken]);

  const [mode, setMode] = useState<string>(quiz.assistantMode);
  useEffect(() => {
    setMode(quiz.assistantMode);
  }, [quiz.assistantMode]);
  const saveMode = () => {
    const fd = new FormData();
    fd.append("intent", "set-mode");
    fd.append("assistant_mode", mode);
    fetcher.submit(fd, { method: "POST" });
  };

  // "Shoppers matched" = quiz matches for quiz-first shops; only legacy
  // try-on shops (VTO configured, quiz not live) see the selfie try-on count.
  const showTryOnStat = quiz.vtoEnabled && !quiz.quizLive;
  const storeHandle = shopDomain.replace(".myshopify.com", "");
  const themeEditorUrl = `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?template=index&addAppBlockId=${THEME_EXT_UUID}/gleame-quiz&target=newAppsSection`;

  return (
    <Page>
      <TitleBar title="Gleame" />
      <BlockStack gap="500">
        {/* Branded hero: one clear door, Gleame's editorial identity. */}
        <div className="gleame-hero">
          <style dangerouslySetInnerHTML={{ __html: GLEAME_HERO_CSS }} />
          <div className="gleame-hero-glow" aria-hidden />
          <div className="gleame-hero-glow gleame-hero-glow-2" aria-hidden />
          <div className="gleame-hero-content">
            <div className="gleame-hero-brand">
              <img className="gleame-hero-logo" src="/placeholders/gleametransparent.svg" alt="Gleame" />
            </div>
            <h1 className="gleame-hero-title">Welcome back, {displayName}</h1>
            <p className="gleame-hero-sub">
              {quiz.questions === 0
                ? "Let's build your quiz. Gleame drafts the whole thing from your catalog in about a minute."
                : quiz.quizLive
                  ? "Your quiz is live and matching shoppers to products."
                  : "Your quiz isn't live yet. Build it in the Studio, then turn it on below."}
            </p>
            <div className="gleame-hero-actions">
              <button
                className="gleame-hero-cta"
                onClick={() => (quiz.questions === 0 ? navigate("/app/onboarding/scope") : openStudio())}
              >
                {quiz.questions === 0 ? "Build my quiz" : "Open Studio"}
                <span aria-hidden> →</span>
              </button>
              <button className="gleame-hero-ghost" onClick={() => navigate("/app/analytics")}>
                View analytics
              </button>
            </div>
          </div>
        </div>

        {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}

        {/* Go-live strip: only while the quiz isn't on the storefront */}
        {!quiz.quizLive && quiz.questions > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Make it live
              </Text>
              <InlineStack gap="400" blockAlign="end" wrap>
                <div style={{ minWidth: 220 }}>
                  <Select
                    label="Where Gleame appears"
                    options={[
                      { label: "Chat bubble only", value: "chat" },
                      { label: "Quiz page only", value: "quiz" },
                      { label: "Both", value: "both" },
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
                </div>
                <Button
                  onClick={saveMode}
                  loading={fetcher.state !== "idle"}
                  disabled={mode === quiz.assistantMode}
                >
                  Save
                </Button>
                <Button url={themeEditorUrl} external>
                  Add the quiz section to your theme
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Two steps: set the storefront to "Quiz page" or "Both", then
                add the Gleame Quiz section to a page in the theme editor.
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* Secondary stats */}
        <InlineGrid columns={{ xs: 1, sm: quiz.quizLive ? 3 : 2 }} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Your quiz
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {quiz.questions} {quiz.questions === 1 ? "question" : "questions"}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {quiz.rules > 0 ? `${quiz.rules} rules · ` : ""}
                {HOME_MODE_LABELS[quiz.mode] ?? quiz.mode} matching
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Shoppers matched
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {showTryOnStat ? totalTransformations : quizMatches}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {showTryOnStat
                  ? "selfie try-ons in the last year"
                  : "quiz matches in the last year"}
              </Text>
            </BlockStack>
          </Card>
          {quiz.quizLive && (
            <Card>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  Storefront
                </Text>
                <div style={{ maxWidth: 200 }}>
                  <Select
                    label="Where Gleame appears"
                    labelHidden
                    options={[
                      { label: "Chat bubble only", value: "chat" },
                      { label: "Quiz page only", value: "quiz" },
                      { label: "Both", value: "both" },
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
                </div>
                <InlineStack gap="200">
                  <Button
                    size="slim"
                    onClick={saveMode}
                    loading={fetcher.state !== "idle"}
                    disabled={mode === quiz.assistantMode}
                  >
                    Save
                  </Button>
                  <Button size="slim" variant="plain" url={themeEditorUrl} external>
                    Theme editor
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}
        </InlineGrid>

        {/* Advanced row */}{/* Advanced row */}
        <InlineStack gap="300">
          <Button variant="plain" onClick={() => navigate("/app/assistant/recommendations")}>
            Advanced rules editor
          </Button>
          {quiz.vtoEnabled && (
            <Button variant="plain" onClick={() => navigate("/app/products")}>
              Try-on product settings
            </Button>
          )}
        </InlineStack>
      </BlockStack>

      {/* Mounted ONLY while open: rendering the App Bridge Modal closed
          calls .hide() on the not-yet-upgraded ui-modal element and crashes
          the page. Also gated on the client-minted navToken. */}
      {studioOpen && navToken && (
        <Modal
          variant="max"
          open
          src={`/studio?tab=${studioStep}&navtoken=${navToken}`}
          onHide={closeStudio}
        >
          <TitleBar title="Studio" />
        </Modal>
      )}
    </Page>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function Dashboard() {
  const { shopDomain, ownerName, quiz, totalTransformations, quizMatches } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <DashboardView
      ownerName={ownerName}
      shopDomain={shopDomain}
      quiz={quiz}
      totalTransformations={totalTransformations}
      quizMatches={quizMatches}
      navigate={navigate}
    />
  );
}
