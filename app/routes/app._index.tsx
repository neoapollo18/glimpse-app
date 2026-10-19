import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher, useSearchParams, useRevalidator } from "@remix-run/react";
import { useState, useEffect, useRef } from "react";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  InlineGrid,
  Banner,
  Badge,
  Select,
} from "@shopify/polaris";
import { Modal, SaveBar, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  supabase,
  getRecommendationCounts,
  getChatAssistantConfig,
  findShopByDomain,
  shopHasTryOnConfig,
  getConfiguredProducts,
  getOnboardingState,
} from "../lib/supabase.server";
import { getQuizFunnelSummary, type QuizFunnelSummary } from "../lib/quiz-dashboard.server";
import { shouldOfferSetup } from "../lib/setup-offer.server";
import { SetupOfferCard } from "../components/SetupOfferModal";
import { QuizPlacementStatus } from "../components/QuizPlacementStatus";
import { CHAT_ASSISTANT_RETIRED, TRYON_WIDGETS_RETIRED } from "../lib/retired-features";
import {
  STUDIO_NAV_CHANNEL,
  postStudioAction,
  readStudioState,
  type StudioAction,
  type StudioHostState,
} from "../components/studio/navigate-parent";

// Z0 (V3-SPEC Part 1): the setup wizard, its step components, the manual
// catalog-sync button and the OVERHAUL_ONBOARDING gate are gone. A shop
// with no quiz that would previously have seen the wizard is sent to
// /app/onboarding/welcome (then scope) by the loader; everyone else gets the dashboard.
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
  /** Distinct shoppers over the last 30 days, counted exactly as the
   * Analytics page counts them. Null when it couldn't be read. */
  quizStats: QuizFunnelSummary | null;
  setupOffer: { show: boolean; email: string };
}

// The setup-offer popup's answers don't change anything this page shows.
export const shouldRevalidate = ({ formAction, defaultShouldRevalidate }: { formAction?: string; defaultShouldRevalidate: boolean }) => {
  if (formAction?.includes("/app/api/setup-offer")) return false;
  return defaultShouldRevalidate;
};

// ============================================================
// Loader
// ============================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let ownerName = "";
  let shopEmail = "";
  try {
    const response = await admin.graphql(`
      query GetShopOwner {
        shop {
          shopOwnerName
          email
        }
      }
    `);
    const data = await response.json();
    ownerName = data.data?.shop?.shopOwnerName || "";
    shopEmail = data.data?.shop?.email || "";
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
  const [allProducts, onboarding, chatConfig, quizStats, transformCountRes] = await Promise.all([
    getConfiguredProducts(shopDomain),
    getOnboardingState(shopDomain),
    getChatAssistantConfig(shopDomain).catch(() => null),
    // The Analytics page's default window and shopper counting, so the
    // two pages show the same numbers.
    shopRow ? getQuizFunnelSummary(shopRow.id, 30).catch(() => null) : Promise.resolve(null),
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
    // The welcome intro forwards to the scope screen once it's done.
    throw redirect(`/app/onboarding/welcome${search}`);
  }

  // Done-for-you setup offer: only while the quiz isn't live, and (once a
  // quiz exists) only for shops that built it through self-serve onboarding.
  const showSetupOffer =
    !quiz.quizLive &&
    (await shouldOfferSetup(shopRow?.id, { selfServeOnly: quiz.questions > 0 }).catch(() => false));

  return json<LoaderData>({
    shopDomain,
    ownerName,
    quiz,
    totalTransformations: transformCountRes?.count ?? 0,
    quizStats,
    setupOffer: { show: showSetupOffer, email: shopEmail },
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
      const { writeQuizSurface } = await import("../lib/quiz-draft.server");
      // Shared surface writer (migration 081 go-live stamp): showing a
      // template quiz that was OFF publishes its template, switching to
      // chat-only un-publishes it, and quiz <-> both on a quiz that is
      // already on leaves the template's live state alone (adding the chat
      // bubble must never publish a template as a side effect). Switching
      // to chat-only is never blocked by a config read error.
      const quizOn = mode === "quiz" || mode === "both";
      const result = await writeQuizSurface(shopDomain, quizOn, () => ({
        assistant_mode: mode,
        ...(quizOn ? { enabled: true } : {}),
      }));
      if (!result.ok) {
        return json({ ok: false, error: result.error ?? "Failed to save" }, { status: 422 });
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
// (which hosts everything else). Plain Polaris cards and buttons so it
// reads as part of the admin; the brand shows only as the small logo.

// App Bridge groups title-bar buttons under a <section label>: React's
// typings don't know the attribute, so it rides in as a spread.
const TITLE_BAR_MENU = { label: "More actions" } as unknown as React.HTMLAttributes<HTMLElement>;

// Capped: a shopper who started just before the window can finish inside it.
const pct = (n: number, of: number) => (of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0);

function DashboardView({
  ownerName,
  shopDomain,
  quiz,
  totalTransformations,
  quizStats,
  setupOffer,
  navigate,
}: {
  ownerName: string;
  shopDomain: string;
  quiz: LoaderData["quiz"];
  totalTransformations: number;
  quizStats: LoaderData["quizStats"];
  setupOffer: LoaderData["setupOffer"];
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
  // Optional rail item to open on (e.g. the retired Quiz settings page
  // redirects here with slide=matching).
  const studioSlide = params.get("slide");
  // Per-tab token: BroadcastChannel reaches EVERY same-origin admin tab;
  // without this a studio click navigated other dashboards too. Minted
  // client-side only: a render-time random value hydrates differently
  // than the SSR pass, and the server-rendered iframe src would carry a
  // token the listener never accepts.
  const [navToken, setNavToken] = useState<string | null>(null);
  useEffect(() => {
    setNavToken(Math.random().toString(36).slice(2, 10));
  }, []);
  // Title bar actions and save bar the open Studio asked for. Null until it
  // reports, which only opted-in shops' Studios do
  // (lib/studio-admin-bars.server): everyone else's draws its own.
  const [studioActions, setStudioActions] = useState<StudioHostState | null>(null);
  // Load watchdog: set once the open Studio says it booted. A frame that
  // never boots (auth redirect, error page, hung loader) has no App Bridge,
  // so the admin's spinner never clears and the window's X stops
  // answering; past the budget we close it from here and say so.
  const [studioReady, setStudioReady] = useState(false);
  const [studioStuck, setStudioStuck] = useState(false);
  const openStudio = (step?: string) => {
    setStudioStuck(false);
    setParams(
      (prev) => {
        prev.set("open", "studio");
        if (step) prev.set("step", step);
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
        prev.delete("slide");
        return prev;
      },
      { replace: true },
    );
    setStudioActions(null);
    revalidator.revalidate();
  };
  const closeStudioRef = useRef(closeStudio);
  closeStudioRef.current = closeStudio;

  // The studio (max-modal iframe) can't navigate the app frame itself;
  // it broadcasts, we close the modal and route. An opted-in Studio also
  // reports its title bar actions and save bar; their clicks go back on
  // the same channel.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(STUDIO_NAV_CHANNEL);
      channel.onmessage = (e: MessageEvent) => {
        const data = e.data as ({ url?: string; token?: string; type?: string } & Record<string, unknown>) | null;
        if (!data || data.token !== navToken) return; // another tab's studio
        if (data.type === "studio-ready" || data.type === "studio-state") setStudioReady(true);
        if (data.type === "studio-state") {
          setStudioActions(readStudioState(data));
          return;
        }
        const url = String(data?.url ?? "");
        if (!url.startsWith("/app")) return;
        closeStudioRef.current();
        navigate(url);
      };
    } catch {
      // BroadcastChannel unsupported: studio falls back to _top navigation
      // and draws its own Publish / View on my store.
    }
    return () => channel?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToken]);
  useEffect(() => {
    if (!studioOpen || !navToken) {
      setStudioReady(false);
      return;
    }
    // No BroadcastChannel = no ready message; never close a working Studio.
    if (studioReady || typeof BroadcastChannel === "undefined") return;
    const t = window.setTimeout(() => {
      setStudioStuck(true);
      closeStudioRef.current();
    }, 45_000);
    return () => window.clearTimeout(t);
  }, [studioOpen, navToken, studioReady]);
  // The Studio frame authenticates and boots App Bridge from ITS OWN URL
  // (shop, host, embedded; the session-token bounce adds id_token), so
  // pass them. This frame's URL loses them after any client-side
  // navigation (onboarding's navigate("/app?open=studio"), nav menu
  // links), and a param-less /studio lands on /auth/login, which has no
  // App Bridge: the admin's loading spinner never clears.
  const studioSrc = (() => {
    const q = new URLSearchParams({ tab: studioStep });
    if (studioSlide) q.set("slide", studioSlide);
    if (navToken) q.set("navtoken", navToken);
    const cfg =
      typeof window === "undefined"
        ? undefined
        : (window as unknown as { shopify?: { config?: { shop?: string; host?: string } } }).shopify?.config;
    if (cfg?.shop && cfg.host) {
      q.set("shop", cfg.shop);
      q.set("host", cfg.host);
      q.set("embedded", "1");
    }
    return `/studio?${q.toString()}`;
  })();
  const studioAction = (action: StudioAction) => {
    if (navToken) postStudioAction(navToken, action);
  };
  // Open the store tab here, in the admin's click: relayed into the Studio,
  // the click has no user activation left and the tab would be blocked.
  // No link yet (or blocked anyway): the Studio opens it or offers it.
  const viewStore = () => {
    const url = studioActions?.storeUrl;
    if (url && window.open(url, "_blank")) studioAction("store-opened");
    else studioAction("view-store");
  };

  const [mode, setMode] = useState<string>(quiz.assistantMode);
  useEffect(() => {
    setMode(quiz.assistantMode);
  }, [quiz.assistantMode]);
  const submitMode = (next: string) => {
    const fd = new FormData();
    fd.append("intent", "set-mode");
    fd.append("assistant_mode", next);
    fetcher.submit(fd, { method: "POST" });
  };
  const saving = fetcher.state !== "idle";

  // "Shoppers matched" = quiz matches for quiz-first shops; only legacy
  // try-on shops (VTO configured, quiz not live) see the selfie try-on count.
  // Off while the try-on widgets are retired (lib/retired-features.ts).
  const showTryOnStat = !TRYON_WIDGETS_RETIRED && quiz.vtoEnabled && !quiz.quizLive;
  const showStats = quiz.quizLive || showTryOnStat || (quizStats?.started ?? 0) > 0;

  // Storefront surface control. With the chat bubble retired the only
  // surface is the quiz page, so it is one button; shops already on
  // "both" keep their stored mode. The chooser comes back with the flag.
  const surfaceChooser = (labelHidden: boolean) => (
    <InlineStack gap="200" blockAlign="end" wrap>
      <div style={{ minWidth: 200 }}>
        <Select
          label="Where Gleame appears"
          labelHidden={labelHidden}
          options={[
            { label: "Chat bubble only", value: "chat" },
            { label: "Quiz page only", value: "quiz" },
            { label: "Both", value: "both" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <Button onClick={() => submitMode(mode)} loading={saving} disabled={mode === quiz.assistantMode}>
        Save
      </Button>
    </InlineStack>
  );

  return (
    <Page>
      <TitleBar title="Gleame">
        {/* Rarely used tools live in the title bar's menu, off the page body. */}
        <section {...TITLE_BAR_MENU}>
          <button onClick={() => navigate("/app/assistant/recommendations")}>Advanced rules editor</button>
          {quiz.vtoEnabled && <button onClick={() => navigate("/app/products")}>Try-on product settings</button>}
        </section>
      </TitleBar>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <img src="/placeholders/gleametransparent.svg" alt="" width={32} height={32} style={{ display: "block" }} />
              <Text as="h1" variant="headingLg">
                Welcome back, {displayName}
              </Text>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              {quiz.questions === 0
                ? "Let's build your quiz. Gleame drafts the whole thing from your catalog in a minute or two."
                : quiz.quizLive
                  ? "Your quiz is live and matching shoppers to products."
                  : "Your quiz isn't live yet."}
            </Text>
            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={() => (quiz.questions === 0 ? navigate("/app/onboarding/scope") : openStudio())}
              >
                {quiz.questions === 0 ? "Build my quiz" : "Open Studio"}
              </Button>
              <Button onClick={() => navigate("/app/analytics")}>View analytics</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
        {studioStuck && (
          <Banner
            tone="critical"
            title="The Studio didn't open"
            action={{ content: "Try again", onAction: () => openStudio() }}
            onDismiss={() => setStudioStuck(false)}
          >
            It took too long to load. Try again, or reload the page if it keeps happening.
          </Banner>
        )}

        {/* Go-live strip: only while the quiz isn't on the storefront */}
        {!quiz.quizLive && quiz.questions > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Make it live
              </Text>
              {!CHAT_ASSISTANT_RETIRED && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  Two steps: set the storefront to &ldquo;Quiz page&rdquo; or &ldquo;Both&rdquo;, then put the quiz on its own
                  page. The setup guide in Studio walks you through it, or publish with one click.
                </Text>
              )}
              {/* The quiz goes on its own page (Studio setup guide or
                  one-click Publish), never the home page: a full-page
                  quiz there would sit on a page Shopify scores for
                  storefront speed. */}
              <InlineStack gap="300" blockAlign="center" wrap>
                {CHAT_ASSISTANT_RETIRED ? (
                  <Button onClick={() => submitMode("quiz")} loading={saving}>
                    Show quiz to shoppers
                  </Button>
                ) : (
                  surfaceChooser(false)
                )}
                <Button variant="plain" onClick={() => openStudio("live")}>
                  Set up the quiz page
                </Button>
              </InlineStack>
              <QuizPlacementStatus quizLive={false} />
            </BlockStack>
          </Card>
        )}

        {/* Stats: only once there is something to show (a zero before the
            quiz is live just reads as bad news). */}
        {showStats && (
        <InlineGrid columns={{ xs: 1, sm: quiz.quizLive ? 2 : 1 }} gap="400">
          <Card>
            {showTryOnStat ? (
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  Shoppers matched
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {totalTransformations}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  selfie try-ons in the last year
                </Text>
              </BlockStack>
            ) : (
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  Last 30 days
                </Text>
                {quizStats ? (
                  <>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {quizStats.started.toLocaleString()} {quizStats.started === 1 ? "shopper started" : "shoppers started"}
                    </Text>
                    {quizStats.started > 0 && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`${pct(quizStats.finished, quizStats.started)}% reached their matches · ${quizStats.added.toLocaleString()} added to cart`}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text as="p" variant="bodyMd">
                    Couldn&rsquo;t load your numbers. They&rsquo;re in Analytics.
                  </Text>
                )}
              </BlockStack>
            )}
          </Card>
          {quiz.quizLive && (
            <Card>
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  Storefront
                </Text>
                {CHAT_ASSISTANT_RETIRED ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="success">Quiz on</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Hide it from shoppers on the Live tab in Studio.
                    </Text>
                  </InlineStack>
                ) : (
                  surfaceChooser(true)
                )}
                <InlineStack gap="200">
                  <Button variant="plain" onClick={() => openStudio("live")}>
                    Placement
                  </Button>
                </InlineStack>
                <QuizPlacementStatus quizLive />
              </BlockStack>
            </Card>
          )}
        </InlineGrid>
        )}

        {/* Done-for-you offer: a dismissible card, never a popup. */}
        {setupOffer.show && <SetupOfferCard defaultEmail={setupOffer.email} source="dashboard" />}
      </BlockStack>

      {/* Mounted ONLY while open: rendering the App Bridge Modal closed
          calls .hide() on the not-yet-upgraded ui-modal element and crashes
          the page. Also gated on the client-minted navToken. For opted-in
          shops, Publish and View on my store sit in the app window's title
          bar and the save bar hangs on the modal (App Bridge reads both
          from a src modal's children); the Studio says which apply and
          handles the clicks. The save bar mounts only while shown. */}
      {studioOpen && navToken && (
        <Modal
          variant="max"
          open
          src={studioSrc}
          onHide={closeStudio}
        >
          <TitleBar title="Studio">
            {studioActions?.showViewStore && (
              <button disabled={studioActions.viewStoreDisabled} onClick={viewStore}>
                View on my store
              </button>
            )}
            {studioActions?.showPublish && (
              <button variant="primary" onClick={() => studioAction("publish")}>
                Publish
              </button>
            )}
          </TitleBar>
          {studioActions?.dirty && (
            <SaveBar id="gleame-studio-save-bar" open discardConfirmation>
              <button variant="primary" loading={studioActions.saving ? "" : undefined} onClick={() => studioAction("save")}>
                Save
              </button>
              <button disabled={studioActions.saving} onClick={() => studioAction("discard")}>
                Discard
              </button>
            </SaveBar>
          )}
        </Modal>
      )}
    </Page>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function Dashboard() {
  const { shopDomain, ownerName, quiz, totalTransformations, quizStats, setupOffer } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <DashboardView
      ownerName={ownerName}
      shopDomain={shopDomain}
      quiz={quiz}
      totalTransformations={totalTransformations}
      quizStats={quizStats}
      setupOffer={setupOffer}
      navigate={navigate}
    />
  );
}
