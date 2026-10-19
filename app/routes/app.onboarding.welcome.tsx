// Welcome intro (2026-10-18): what a new install sees before the scope
// screen. Three slides, skippable: welcome (with how it works), what the
// quiz should do for the store (goals that change the generated quiz), and
// "How do you want to get started?" (free setup by our team, or build it
// with AI now). Built for Shopify 4.2.2: concise, guides to completion,
// every question says what it's used for; the expert card is the slide's
// one primary action and promises no outcomes (4.3.1). Every surface is a
// Polaris component; only the drawings are custom.
//
// The drawings show the merchant's own products when we can read a few
// (lib/onboarding-preview.server.ts), and drawn product forms otherwise.
//
// While the merchant reads, the store is read in the background (the same
// chunked catalog sync the scope screen runs), so "Reading your store…"
// is usually done by the time they get there. Leaving pauses the sync at a
// page boundary and the scope screen resumes from the stored cursor.
//
// Shops with a quiz, and shops that finished (or predate) the intro, never
// see this (lib/onboarding-intro.server.ts).

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  List,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { CheckCircleIcon, CheckIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShopExists, supabase } from "../lib/supabase.server";
import { shopHasRealQuiz } from "../lib/quiz-draft.server";
import { useCatalogSync } from "../lib/use-catalog-sync";
import { getSetupOfferContact } from "../lib/setup-offer.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import { introDone, type IntroGoal, type IntroPath } from "../lib/onboarding-intro.server";
import { loadPreviewProducts } from "../lib/onboarding-preview.server";
import {
  ART_CSS,
  BrandLockup,
  CheckGlyph,
  FALLBACK_PRODUCTS,
  ProductArt,
  type PreviewProduct,
} from "../components/onboarding/OnboardingArt";

/** Same route with the embedded-admin params (host/shop/embedded) carried
 * over, so App Bridge doesn't re-bootstrap the frame. */
function withParams(request: Request, path: string, extra: Record<string, string> = {}): string {
  const params = new URL(request.url).searchParams;
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// The background sync posts one fetcher page per 8 products, and the intro
// records each step: none of that needs this loader again.
export const shouldRevalidate = ({ formAction, defaultShouldRevalidate }: { formAction?: string; defaultShouldRevalidate: boolean }) => {
  if (formAction?.includes("/app/api/catalog-sync")) return false;
  if (formAction?.includes("/app/api/setup-offer")) return false;
  return defaultShouldRevalidate;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await ensureShopExists(session.shop);
  const shop = await supabase
    .from("shops")
    .select("id, catalog_sync_enabled, catalog_sync_cursor, catalog_last_synced_at, catalog_product_count")
    .eq("shop_domain", session.shop)
    .single();
  if (shop.error || !shop.data) throw new Response("Shop not found", { status: 404 });

  // ?replay=1 shows the intro on any store (QA, demos, support links): its
  // exits land where they normally would (the scope screen sends a store
  // that has a quiz on to the Studio). Otherwise new installs only, once.
  const replay = new URL(request.url).searchParams.get("replay") === "1";
  if (!replay && (await shopHasRealQuiz(shop.data.id).catch(() => false))) {
    return redirect(withParams(request, "/app", { open: "studio" }));
  }
  if (!replay && (await introDone(shop.data.id))) {
    return redirect(withParams(request, "/app/onboarding/scope"));
  }

  const syncEnabled = shop.data.catalog_sync_enabled === true;
  const syncCursor = (shop.data.catalog_sync_cursor as string | null) ?? null;
  const lastSyncedAt = (shop.data.catalog_last_synced_at as string | null) ?? null;
  const productCount = Number(shop.data.catalog_product_count ?? 0) || 0;
  // A few of the store's own products for the slides' quiz preview.
  const [contact, preview] = await Promise.all([
    getSetupOfferContact(admin),
    loadPreviewProducts(shop.data.id, admin, 4),
  ]);
  trackOverhaulEvent(session.shop, "onboarding_intro_viewed", { replay });
  return json({
    shopDomain: session.shop,
    shopName: contact.shopName,
    firstName: contact.ownerName.trim().split(/\s+/)[0] ?? "",
    email: contact.email,
    // Same rule as the scope screen: never synced, stopped mid-catalog, or
    // "enabled" with no page ever landed.
    syncNeeded: !syncEnabled || syncCursor !== null || lastSyncedAt === null || productCount <= 0,
    syncCursor: syncEnabled && lastSyncedAt !== null ? syncCursor : null,
    productCount,
    preview,
  });
};

// ---------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------

export const INTRO_STEPS = ["welcome", "goals", "path"] as const;
export type IntroStep = (typeof INTRO_STEPS)[number];

// Each body says what picking it changes (Built for Shopify 4.2.2: no
// question without a reason). "emails" and "returns" shape the generated
// quiz (lib/quiz-generator.server.ts); the other two describe what every
// quiz already does, so picking them changes nothing.
const GOAL_CHOICES: Array<{ id: IntroGoal; title: string; body: string }> = [
  { id: "choose", title: "Help shoppers choose", body: "Every answer leads to real products from your catalog." },
  { id: "emails", title: "Grow my email list", body: "We'll add an email step to your quiz. You choose where it goes." },
  { id: "returns", title: "Cut returns", body: "We'll include a question that pins down fit: shade, size or skin type." },
  { id: "insights", title: "Know your shoppers", body: "Every answer shows up in Analytics, from the first shopper." },
];

const HOW_STEPS: Array<{ title: string; body: string }> = [
  { title: "We read your store", body: "Your products, collections and the look of your theme." },
  { title: "AI writes your quiz", body: "Questions, answers, and which products each answer leads to." },
  { title: "You make it yours", body: "Change anything in the Studio, then put it on a page." },
];

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

export interface WelcomeData {
  shopDomain: string;
  shopName: string;
  firstName: string;
  email: string;
  syncNeeded: boolean;
  syncCursor: string | null;
  productCount: number;
  /** A few of the store's products with photos; empty draws the fallback. */
  preview?: PreviewProduct[];
}

export default function OnboardingWelcome() {
  const data = useLoaderData<typeof loader>();
  return <WelcomeIntro data={data} />;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTRO_API = "/app/api/onboarding-intro";
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The intro itself; `initialStep` lets tests and the screenshot harness
 * open any slide. */
export function WelcomeIntro({ data, initialStep = 0 }: { data: WelcomeData; initialStep?: number }) {
  const navigate = useNavigate();
  const offer = useFetcher<{ ok: boolean; error?: string; requested?: boolean }>();
  const [step, setStep] = useState(Math.max(0, Math.min(INTRO_STEPS.length - 1, initialStep)));
  const [goals, setGoals] = useState<IntroGoal[]>([]);
  const [leaving, setLeaving] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const products = data.preview ?? [];

  // --- Background store read ---
  const [storeCount, setStoreCount] = useState(data.syncNeeded ? 0 : data.productCount);
  const [storeReady, setStoreReady] = useState(!data.syncNeeded);
  const sync = useCatalogSync({
    onComplete: () => setStoreReady(true),
    // Not a dead end: the scope screen reads (and reports) it again.
    onError: () => setStoreReady(false),
  });
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !data.syncNeeded) return;
    started.current = true;
    sync.start(data.syncCursor ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (sync.progress) setStoreCount(sync.progress.done);
  }, [sync.progress]);

  const post = (fields: Record<string, string>) => {
    const fd = new FormData();
    fd.append("goals", JSON.stringify(goals));
    fd.append("step", String(step));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fetch(INTRO_API, { method: "POST", body: fd }).catch(() => null);
  };

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(INTRO_STEPS.length - 1, next));
    if (clamped === step) return;
    if (INTRO_STEPS[step] === "goals" && clamped > step) post({ intent: "goals" });
    setStep(clamped);
    post({ intent: "step", step: String(clamped) });
    // Keep the new slide's heading in view inside the admin frame.
    requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: false }));
  };

  // Leave for the scope screen: record the path, let the page of the store
  // read that's on the wire land (its cursor is what scope resumes from),
  // then go.
  // Latest sync state for the leave loop (it outlives the render it began in).
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const leave = async (path: IntroPath) => {
    if (leaving) return;
    setLeaving(true);
    sync.pause();
    // Recorded before leaving: the scope screen sends unfinished intros
    // back here.
    await post({ intent: "complete", path });
    const t0 = Date.now();
    while (syncRef.current.pageInFlight && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 150));
    navigate("/app/onboarding/scope");
  };

  const toggleGoal = (g: IntroGoal) =>
    setGoals((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const last = step === INTRO_STEPS.length - 1;
  const storeLine = storeReady
    ? storeCount > 0
      ? `Your store is ready: ${plural(storeCount, "product")} read`
      : null
    : sync.progress
      ? storeCount > 0
        ? `Reading your store in the background · ${plural(storeCount, "product")} so far`
        : "Reading your store in the background…"
      : null;

  const footNote =
    INTRO_STEPS[step] === "goals"
      ? goals.length > 0
        ? `${goals.length} selected · Everything stays editable in the Studio`
        : "Picks are optional · Everything stays editable in the Studio"
      : null;

  return (
    <Page>
      <TitleBar title="Welcome to Gleame" />
      <style>{ART_CSS + WELCOME_CSS}</style>
      <div className="gw">
        <Card padding={{ xs: "400", sm: "600" }} roundedAbove="xs">
          <BlockStack gap="600">
            <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
              <BrandLockup size={28} />
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <Text as="p" variant="bodySm" tone="subdued">
                  Step {step + 1} of {INTRO_STEPS.length}
                </Text>
                {!last && (
                  <Button variant="tertiary" onClick={() => void leave("skip")} disabled={leaving}>
                    Skip intro
                  </Button>
                )}
              </InlineStack>
            </InlineStack>

            <div className="gw-stage" ref={stageRef} key={step}>
              {step === 0 && <SlideWelcome shopName={data.shopName} products={products} onNext={() => go(1)} />}
              {step === 1 && (
                <SlideGoals goals={goals} products={products} disabled={leaving} onToggle={toggleGoal} />
              )}
              {step === 2 && (
                <SlidePath
                  email={data.email}
                  offer={offer}
                  leaving={leaving}
                  onBuild={() => void leave("ai")}
                  onExpertDone={() => void leave("expert")}
                />
              )}
            </div>

            {step > 0 && (
              <BlockStack gap="400">
                <Divider />
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                  <Button variant="tertiary" onClick={() => go(step - 1)} disabled={leaving}>
                    Back
                  </Button>
                  <InlineStack gap="400" blockAlign="center" wrap={false}>
                    {footNote && (
                      <span className="gw-foot-note">
                        <Text as="span" variant="bodySm" tone="subdued">
                          {footNote}
                        </Text>
                      </span>
                    )}
                    {!last && (
                      <Button variant="primary" size="large" onClick={() => go(step + 1)}>
                        Continue
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
        {storeLine && (
          <div className="gw-store" aria-live="polite">
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              <span className={`gw-store-dot${storeReady ? " is-ready" : ""}`} aria-hidden />
              {storeLine}
            </Text>
          </div>
        )}
      </div>
    </Page>
  );
}

// --- Slide 1: welcome -------------------------------------------------

function SlideWelcome({
  shopName,
  products,
  onNext,
}: {
  shopName: string;
  products: PreviewProduct[];
  onNext: () => void;
}) {
  return (
    <InlineGrid columns={{ xs: 1, md: 2 }} gap={{ xs: "600", md: "800" }} alignItems="center">
      <BlockStack gap="600">
        <BlockStack gap="300">
          <h1 className="gw-title" tabIndex={-1}>
            <Text as="span" variant="heading2xl">
              Help every shopper find their match
            </Text>
          </h1>
          <Text as="p" variant="bodyLg" tone="subdued">
            Gleame turns your catalog into a short quiz. Shoppers answer a few questions, see the products made for
            them, and add them to cart.
          </Text>
        </BlockStack>
        <BlockStack gap="300">
          <Text as="h2" variant="headingSm">
            How it works
          </Text>
          <List type="number" gap="loose">
            {HOW_STEPS.map((h) => (
              <List.Item key={h.title}>
                <BlockStack gap="050">
                  <Text as="span" fontWeight="semibold">
                    {h.title}
                  </Text>
                  <Text as="span" tone="subdued">
                    {h.body}
                  </Text>
                </BlockStack>
              </List.Item>
            ))}
          </List>
        </BlockStack>
        <InlineStack>
          <Button variant="primary" size="large" onClick={onNext}>
            Get started
          </Button>
        </InlineStack>
      </BlockStack>
      <QuizScene shopName={shopName} products={products} />
    </InlineGrid>
  );
}

// A question that fits nails, makeup or clothes alike, so it reads true
// next to whatever the merchant sells.
const LOOKS: Array<[string, string]> = [
  ["#EBCFC4", "Soft & natural"],
  ["#D8C3AC", "Clean & classic"],
  ["#A3222D", "Bold & bright"],
  ["#2B2422", "Dark & moody"],
];

/** The quiz on the merchant's own storefront: a question card in front of
 * a phone showing the matches, with their product photos when we have them. */
function QuizScene({ shopName, products }: { shopName: string; products: PreviewProduct[] }) {
  const tiles = [0, 1, 2, 3].map((i) =>
    products.length >= 4
      ? { product: products[i], name: products[i].name }
      : { product: null, name: FALLBACK_PRODUCTS[i] },
  );
  return (
    <div className="gw-scene" aria-hidden>
      <span className="gw-arch" />
      <div className="gw-stagebox">
        <div className="gw-phone">
          <div className="gw-screen">
            <div className="gw-status">
              <span>9:41</span>
              <span className="gw-status-r">
                <i />
                <i />
                <b />
              </span>
            </div>
            <span className="gw-island" />
            <div className="gw-sbar">
              <svg viewBox="0 0 16 12">
                <path d="M1 1.5h14M1 6h14M1 10.5h14" />
              </svg>
              <span className="gw-sbar-name">{shopName || "Your store"}</span>
              <svg viewBox="0 0 16 16">
                <path d="M3 5.5h10l-.8 9H3.8z M5.6 5.5V4a2.4 2.4 0 0 1 4.8 0v1.5" />
              </svg>
            </div>
            <div className="gw-res">
              <span className="gw-res-k">Your matches</span>
              <p className="gw-res-h">Picked for you.</p>
              <div className="gw-res-grid">
                {tiles.map((t, i) => (
                  <span key={i} className="gw-res-tile">
                    <span className="gw-res-img">
                      <ProductArt product={t.product} index={i} width={110} />
                      {i === 0 && <span className="gw-res-tag">Best match</span>}
                    </span>
                    <span className="gw-res-name">{t.name}</span>
                  </span>
                ))}
              </div>
              <span className="gw-res-cta">Add all to cart</span>
            </div>
          </div>
        </div>
        <div className="gw-q">
          <div className="gw-q-top">
            <span>Question 2 of 4</span>
            <span className="gw-q-prog">
              <i />
            </span>
          </div>
          <p className="gw-q-h">Which look feels most like you?</p>
          <div className="gw-q-opts">
            {LOOKS.map(([c, l], i) => (
              <span key={l} className={`gw-q-opt${i === 1 ? " is-on" : ""}`}>
                <i style={{ background: c }} />
                {l}
                {i === 1 && (
                  <b>
                    <CheckGlyph />
                  </b>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Slide 2: goals ----------------------------------------------------

function SlideGoals({
  goals,
  products,
  disabled,
  onToggle,
}: {
  goals: IntroGoal[];
  products: PreviewProduct[];
  disabled: boolean;
  onToggle: (g: IntroGoal) => void;
}) {
  return (
    <BlockStack gap="600">
      <BlockStack gap="200">
        <h2 className="gw-title" tabIndex={-1}>
          <Text as="span" variant="headingXl">
            What should your quiz do for you?
          </Text>
        </h2>
        <Text as="p" variant="bodyLg" tone="subdued">
          Pick any that apply, or none. We use your picks to shape the quiz we write for you.
        </Text>
      </BlockStack>
      <div className="gw-goals" role="group" aria-label="Goals">
        {GOAL_CHOICES.map((g) => {
          const on = goals.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`gw-goal${on ? " is-on" : ""}`}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(g.id)}
            >
              <span className="gw-goal-art" aria-hidden>
                <GoalVignette id={g.id} products={products} />
              </span>
              <span className="gw-goal-text">
                <Text as="span" variant="headingMd">
                  {g.title}
                </Text>
                <Text as="span" tone="subdued">
                  {g.body}
                </Text>
              </span>
              {/* Drawn like a Polaris checkbox: a button can't hold an input. */}
              <span className="gw-goal-check" aria-hidden>
                {on && <CheckGlyph />}
              </span>
            </button>
          );
        })}
      </div>
    </BlockStack>
  );
}

/** A small piece of the quiz each goal adds or relies on, drawn as the
 * shopper (or the merchant, for Analytics) would see it. */
function GoalVignette({ id, products }: { id: IntroGoal; products: PreviewProduct[] }) {
  if (id === "choose") {
    const two = [0, 1].map((i) => (products.length >= 2 ? products[i] : null));
    return (
      <span className="vg-prods">
        {two.map((p, i) => (
          <span key={i} className="vg-pc">
            <span className="vg-pc-img">
              <ProductArt product={p} index={i} width={72} />
              {i === 0 && <span className="vg-pc-tag">Best match</span>}
            </span>
            <span className="vg-pc-n">{p?.name ?? FALLBACK_PRODUCTS[i]}</span>
            <span className="vg-pc-add">Add to cart</span>
          </span>
        ))}
      </span>
    );
  }
  if (id === "emails") {
    return (
      <span className="vg-card vg-mail">
        <span className="vg-mail-t">Email me my matches</span>
        <span className="vg-mail-row">
          <span className="vg-mail-in">you@example.com</span>
          <span className="vg-mail-go">
            <svg viewBox="0 0 16 16">
              <path d="M3 8h9.5M8.5 4l4 4-4 4" />
            </svg>
          </span>
        </span>
        <span className="vg-mail-fine">Just your picks. No spam.</span>
      </span>
    );
  }
  if (id === "returns") {
    return (
      <span className="vg-card vg-fit">
        <span className="vg-fit-row">
          <span className="vg-k">Shade</span>
          <span className="vg-v">Light warm</span>
        </span>
        <span className="vg-swatches">
          {["#F3DDD2", "#E9C1AA", "#D7A283", "#B98461", "#94603F", "#6B402B"].map((c, i) => (
            <i key={c} className={i === 1 ? "is-on" : undefined} style={{ background: c }} />
          ))}
        </span>
        <span className="vg-fit-row vg-fit-row--rule">
          <span className="vg-k">Size</span>
          <span className="vg-sizes">
            {["XS", "S", "M", "L"].map((s) => (
              <i key={s} className={s === "M" ? "is-on" : undefined}>
                {s}
              </i>
            ))}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="vg-card vg-chart">
      <span className="vg-fit-row">
        <span className="vg-chart-t">Skin type</span>
        <span className="vg-k">30 days</span>
      </span>
      {[
        ["Dry", 46],
        ["Normal", 32],
        ["Oily", 22],
      ].map(([label, pct], i) => (
        <span key={label} className="vg-bar">
          <span className="vg-bar-l">{label}</span>
          <span className="vg-bar-track">
            <i style={{ width: `${pct}%` }} className={`is-${i}`} />
          </span>
          <span className="vg-bar-v">{pct}%</span>
        </span>
      ))}
    </span>
  );
}

// --- Slide 3: choose a path ----------------------------------------------

const AI_POINTS = [
  "A complete quiz written from your catalog",
  "Edit every question, answer and match in the Studio",
  "Publish whenever you're ready",
];
const EXPERT_POINTS = [
  "We build, style and launch the quiz on your store",
  "A person tunes which products each answer leads to",
  "You can keep editing it after",
];

function CheckList({ items }: { items: string[] }) {
  return (
    <BlockStack as="ul" gap="200">
      {items.map((t) => (
        <InlineStack as="li" key={t} gap="200" blockAlign="start" wrap={false}>
          <span className="gw-tick">
            <Icon source={CheckIcon} tone="base" />
          </span>
          <Text as="span">{t}</Text>
        </InlineStack>
      ))}
    </BlockStack>
  );
}

function SlidePath({
  email,
  offer,
  leaving,
  onBuild,
  onExpertDone,
}: {
  email: string;
  offer: ReturnType<typeof useFetcher<{ ok: boolean; error?: string; requested?: boolean }>>;
  leaving: boolean;
  onBuild: () => void;
  onExpertDone: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [mail, setMail] = useState(email);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [mailError, setMailError] = useState<string | null>(null);
  const requested = offer.data?.requested === true;
  const sending = offer.state !== "idle";

  const request = () => {
    if (!EMAIL_RE.test(mail.trim())) {
      setMailError("Enter an email we can reach you at.");
      return;
    }
    offer.submit(
      { intent: "request", source: "onboarding_intro", email: mail, phone, notes },
      { method: "POST", action: "/app/api/setup-offer" },
    );
  };

  let expertBody: ReactNode;
  let expertCta: ReactNode;
  if (requested) {
    expertBody = (
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <span className="gw-tick">
            <Icon source={CheckCircleIcon} tone="success" />
          </span>
          <Text as="h4" variant="headingMd">
            You're on the list
          </Text>
        </InlineStack>
        <Text as="p" tone="subdued">
          Our setup team will email you at{" "}
          <Text as="span" fontWeight="semibold" tone="base">
            {mail}
          </Text>
          . Build a draft with AI in the meantime and we'll pick up from there.
        </Text>
      </BlockStack>
    );
    expertCta = (
      <Button variant="primary" size="large" fullWidth onClick={onExpertDone} loading={leaving}>
        Build a draft while I wait
      </Button>
    );
  } else if (formOpen) {
    expertBody = (
      <BlockStack gap="300">
        {offer.data?.error && <Banner tone="critical">{offer.data.error}</Banner>}
        <TextField
          label="Your email"
          type="email"
          autoComplete="email"
          value={mail}
          onChange={(v) => {
            setMail(v);
            setMailError(null);
          }}
          error={mailError ?? undefined}
        />
        <TextField label="Phone (optional)" type="tel" autoComplete="tel" value={phone} onChange={setPhone} />
        <TextField
          label="Anything we should know? (optional)"
          autoComplete="off"
          multiline={2}
          value={notes}
          onChange={setNotes}
          placeholder="Products to cover, a launch date…"
        />
      </BlockStack>
    );
    expertCta = (
      <InlineStack gap="200" blockAlign="center">
        <Button variant="primary" size="large" onClick={request} loading={sending} disabled={!mail.trim()}>
          Request free setup
        </Button>
        <Button variant="tertiary" onClick={() => setFormOpen(false)} disabled={sending}>
          Cancel
        </Button>
      </InlineStack>
    );
  } else {
    expertBody = <CheckList items={EXPERT_POINTS} />;
    expertCta = (
      <Button variant="primary" size="large" fullWidth onClick={() => setFormOpen(true)}>
        Get free expert setup
      </Button>
    );
  }

  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <h2 className="gw-title" tabIndex={-1}>
          <Text as="span" variant="headingXl" alignment="center">
            How do you want to get started?
          </Text>
        </h2>
        <Text as="p" variant="bodyLg" tone="subdued" alignment="center">
          Either way, you can change everything later.
        </Text>
      </BlockStack>
      <div className="gw-paths">
        <section className="gw-path" aria-labelledby="gw-path-ai">
          <div className="gw-path-body">
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h3" variant="headingLg" id="gw-path-ai">
                  Build it myself with AI
                </Text>
                <Text as="p" tone="subdued">
                  Ready in about 2 minutes.
                </Text>
              </BlockStack>
              <CheckList items={AI_POINTS} />
            </BlockStack>
            <div className="gw-path-cta">
              <Button size="large" fullWidth onClick={onBuild} loading={leaving && !requested}>
                Build my quiz
              </Button>
            </div>
          </div>
        </section>
        {/* The recommended option: black border and label, the slide's one primary. */}
        <section className="gw-path gw-path--feature" aria-labelledby="gw-path-expert">
          <Box background="bg-fill-brand" paddingBlock="150" paddingInline="400">
            <Text as="p" variant="bodySm" fontWeight="semibold" tone="text-inverse" alignment="center">
              Free · done for you
            </Text>
          </Box>
          <div className="gw-path-body">
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h3" variant="headingLg" id="gw-path-expert">
                  Set it up with an expert
                </Text>
                <Text as="p" tone="subdued">
                  Our team does it with you.
                </Text>
              </BlockStack>
              {expertBody}
            </BlockStack>
            <div className="gw-path-cta">{expertCta}</div>
          </div>
        </section>
      </div>
    </BlockStack>
  );
}

// Polaris components and tokens throughout (Built for Shopify 4.1.1).
// Custom CSS covers only what Polaris has no component for: the phone
// scene, the goal vignettes, and the selectable goal cards (drawn like
// Polaris choices). Black, white and Polaris greys; no AI purple, no
// sparkle glyphs. No looping motion (4.3.3): one fade as a slide enters.
const WELCOME_CSS = `
  .gw { max-width: 1080px; margin: 0 auto; padding: var(--p-space-400) 0 var(--p-space-1200); }
  .gw-title { margin: 0; outline: none; text-wrap: balance; }
  .gw-stage { animation: gw-in 220ms ease-out; }
  @keyframes gw-in { from { opacity: 0; } to { opacity: 1; } }

  /* Store read status, under the card */
  .gw-store { margin-top: var(--p-space-400); padding: 0 var(--p-space-200); }
  .gw-store-dot { display: inline-block; width: 7px; height: 7px; margin-right: var(--p-space-200); border-radius: 50%; vertical-align: 1px;
    box-shadow: inset 0 0 0 1.5px var(--p-color-icon); }
  .gw-store-dot.is-ready { background: var(--p-color-bg-fill-success); box-shadow: none; }

  /* The scene: a grey panel with a centered arch, the phone, and a question
     card in front. The stage is drawn once at 420x580 and scaled (--gw-s)
     by the panel's own width, so it keeps the same margins at any size. */
  .gw-scene { container: gw-scene / inline-size; position: relative; display: flex; align-items: center; justify-content: center; min-height: 560px;
    border-radius: var(--p-border-radius-300); background: var(--p-color-bg-surface-secondary); overflow: hidden; }
  .gw-stagebox, .gw-arch { --gw-s: 1; }
  .gw-stagebox { position: relative; flex: none; width: 420px; height: 580px; transform: scale(var(--gw-s)); }
  /* Flat, symmetric, bottom flush; its crown clears the phone by 34px. The
     999px radius resolves to half the width: a true semicircle. */
  .gw-arch { position: absolute; left: 50%; bottom: 0; width: min(72%, calc(336px * var(--gw-s))); top: calc(50% - 277px * var(--gw-s));
    transform: translateX(-50%); border-radius: 999px 999px 0 0; background: var(--p-color-bg); }
  .gw-phone { position: absolute; left: 18px; top: calc(50% - 243px); width: 236px; height: 486px; padding: 8px; box-sizing: border-box; border-radius: 42px; background: #111;
    box-shadow: inset 0 0 0 1.5px #3a3a3a, 0 44px 60px -36px rgba(0, 0, 0, .5), 0 18px 30px -18px rgba(0, 0, 0, .25); }
  .gw-screen { position: relative; height: 100%; border-radius: 34px; background: #fff; overflow: hidden; display: flex; flex-direction: column; }
  .gw-status { display: flex; justify-content: space-between; align-items: center; height: 38px; padding: 4px 22px 0 26px; font-size: 11px; font-weight: 650; color: #111; flex: none; }
  .gw-status-r { display: inline-flex; align-items: center; gap: 3px; }
  .gw-status-r i { width: 3px; height: 7px; border-radius: 1px; background: #111; }
  .gw-status-r i:first-child { height: 5px; }
  .gw-status-r b { width: 18px; height: 8px; margin-left: 3px; border-radius: 2.5px; box-shadow: inset 0 0 0 1px #111; background: linear-gradient(90deg, #111 70%, transparent 70%); background-clip: content-box; padding: 1.5px; box-sizing: border-box; }
  .gw-island { position: absolute; top: 10px; left: 50%; width: 70px; height: 20px; margin-left: -35px; border-radius: 999px; background: #111; }
  .gw-sbar { display: grid; grid-template-columns: 16px 1fr 16px; align-items: center; gap: 8px; height: 36px; padding: 0 16px; border-bottom: 1px solid #EBEBEB; flex: none; }
  .gw-sbar svg { width: 14px; height: 14px; fill: none; stroke: #111; stroke-width: 1.4; }
  .gw-sbar-name { text-align: center; font-size: 10.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gw-res { display: flex; flex-direction: column; flex: 1; padding: 16px 14px 14px; min-height: 0; }
  .gw-res-k { font-size: 9.5px; font-weight: 600; color: #616161; }
  .gw-res-h { margin: 3px 0 12px; font-size: 19px; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; color: #111; }
  .gw-res-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 8px; }
  .gw-res-tile { display: grid; gap: 5px; min-width: 0; }
  .gw-res-img { position: relative; display: block; aspect-ratio: 1 / 1.08; border-radius: 8px; overflow: hidden; }
  .gw-res-tag { position: absolute; top: 6px; left: 6px; padding: 3px 6px; border-radius: 999px; background: #111; color: #fff; font-size: 6.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .gw-res-name { font-size: 10px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gw-res-cta { margin-top: auto; display: block; text-align: center; padding: 10px; border-radius: 999px; background: #111; color: #fff; font-size: 11px; font-weight: 600; }
  .gw-q { position: absolute; right: 18px; top: calc(50% - 92px); width: 206px; padding: 14px; box-sizing: border-box; border-radius: 14px; background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .05), 0 28px 50px -22px rgba(0, 0, 0, .38), 0 6px 14px -8px rgba(0, 0, 0, .14); }
  .gw-q-top { display: grid; gap: 7px; font-size: 9.5px; font-weight: 600; color: #616161; }
  .gw-q-prog { display: block; height: 3px; border-radius: 2px; background: #E3E3E3; overflow: hidden; }
  .gw-q-prog i { display: block; width: 50%; height: 100%; border-radius: 2px; background: #111; }
  .gw-q-h { margin: 10px 0 12px; font-size: 14px; line-height: 1.25; font-weight: 700; letter-spacing: -0.015em; color: #111; text-wrap: balance; }
  .gw-q-opts { display: grid; gap: 6px; }
  .gw-q-opt { position: relative; display: flex; align-items: center; gap: 9px; height: 32px; padding: 0 10px; border-radius: 9px; border: 1px solid #E3E3E3; font-size: 11.5px; font-weight: 550; color: #222; }
  .gw-q-opt i { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08); flex: none; }
  .gw-q-opt.is-on { border-color: #111; box-shadow: inset 0 0 0 .5px #111; }
  .gw-q-opt b { margin-left: auto; width: 15px; height: 15px; border-radius: 50%; background: #111; color: #fff; display: inline-flex; }
  .gw-q-opt b svg { width: 15px; height: 15px; }

  /* Slide 2: selectable goal cards with Polaris states: hover, pressed,
     selected (black, like a checked Polaris checkbox), focus ring, disabled. */
  .gw-goals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--p-space-300); }
  .gw-goal { appearance: none; font: inherit; color: inherit; position: relative; display: flex; flex-direction: column; text-align: left; cursor: pointer;
    padding: var(--p-space-150) var(--p-space-150) var(--p-space-400); border-radius: var(--p-border-radius-300); background: var(--p-color-bg-surface);
    border: var(--p-border-width-025) solid var(--p-color-border);
    transition: border-color var(--p-motion-duration-100) var(--p-motion-ease), box-shadow var(--p-motion-duration-100) var(--p-motion-ease), background-color var(--p-motion-duration-100) var(--p-motion-ease); }
  .gw-goal:not(:disabled):hover { border-color: var(--p-color-border-hover); background: var(--p-color-bg-surface-hover); }
  .gw-goal:not(:disabled):active { background: var(--p-color-bg-surface-active); }
  .gw-goal:focus-visible { outline: var(--p-border-width-050) solid var(--p-color-border-focus); outline-offset: var(--p-space-025); }
  .gw-goal.is-on, .gw-goal.is-on:not(:disabled):hover { border-color: var(--p-color-bg-fill-brand); box-shadow: inset 0 0 0 var(--p-border-width-025) var(--p-color-bg-fill-brand); }
  .gw-goal:disabled { cursor: default; border-color: var(--p-color-border-disabled); }
  .gw-goal:disabled > * { opacity: .5; }
  .gw-goal-art { display: flex; align-items: flex-end; justify-content: center; height: 156px; padding-bottom: 18px; box-sizing: border-box;
    border-radius: var(--p-border-radius-200); background: var(--p-color-bg-surface-secondary); overflow: hidden; transition: background-color var(--p-motion-duration-100) var(--p-motion-ease); }
  .gw-goal:not(:disabled):hover .gw-goal-art, .gw-goal.is-on .gw-goal-art { background: var(--p-color-bg-surface-secondary-hover); }
  .gw-goal-text { display: grid; gap: var(--p-space-100); padding: var(--p-space-400) var(--p-space-300) 0; }
  .gw-goal-check { position: absolute; top: var(--p-space-300); right: var(--p-space-300); display: inline-flex; width: 18px; height: 18px;
    border-radius: var(--p-border-radius-100); background: var(--p-color-bg-surface); color: var(--p-color-text-brand-on-bg-fill);
    box-shadow: inset 0 0 0 var(--p-border-width-0165) var(--p-color-input-border); }
  .gw-goal:not(:disabled):hover .gw-goal-check { box-shadow: inset 0 0 0 var(--p-border-width-0165) var(--p-color-input-border-hover); }
  .gw-goal.is-on .gw-goal-check { background: var(--p-color-bg-fill-brand-selected); box-shadow: none; }
  .gw-goal-check svg { width: 18px; height: 18px; }

  /* Goal vignettes: small, exact UI */
  .vg-card { display: grid; gap: 8px; width: 150px; padding: 11px; box-sizing: border-box; border-radius: 10px; background: #fff; line-height: 1.25;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .05), 0 10px 22px -12px rgba(0, 0, 0, .28); }
  .vg-k { font-size: 8.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #616161; }
  .vg-v { font-size: 10.5px; font-weight: 650; color: #111; }
  .vg-prods { display: flex; gap: 8px; align-items: stretch; }
  .vg-pc { display: grid; gap: 5px; width: 70px; line-height: 1.25; padding: 5px 5px 7px; box-sizing: border-box; border-radius: 9px; background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .05), 0 10px 22px -12px rgba(0, 0, 0, .28); }
  .vg-pc-img { position: relative; display: block; height: 54px; border-radius: 6px; overflow: hidden; }
  .vg-pc-tag { position: absolute; left: 4px; top: 4px; padding: 2px 4px; border-radius: 999px; background: #111; color: #fff; font-size: 5.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .vg-pc-n { font-size: 9px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 1px; }
  .vg-pc-add { display: block; text-align: center; padding: 4px 0; border-radius: 999px; background: #111; color: #fff; font-size: 7px; font-weight: 600; }
  .vg-pc + .vg-pc .vg-pc-add { background: #fff; color: #111; box-shadow: inset 0 0 0 1px #CCCCCC; }
  .vg-mail-t { font-size: 11px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #111; }
  .vg-mail-row { display: flex; gap: 5px; }
  .vg-mail-in { flex: 1; display: flex; align-items: center; height: 26px; padding: 0 8px; border-radius: 6px; box-shadow: inset 0 0 0 1px #CCCCCC; font-size: 9.5px; color: #8A8A8A; }
  .vg-mail-go { width: 26px; height: 26px; border-radius: 6px; background: #111; display: inline-flex; align-items: center; justify-content: center; }
  .vg-mail-go svg { width: 13px; height: 13px; fill: none; stroke: #fff; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .vg-mail-fine { font-size: 8px; color: #8A8A8A; }
  .vg-fit-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .vg-fit-row--rule { padding-top: 8px; border-top: 1px solid #EBEBEB; }
  .vg-swatches { display: flex; justify-content: space-between; }
  .vg-swatches i { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }
  .vg-swatches i.is-on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.25px #111; }
  .vg-sizes { display: inline-flex; gap: 3px; }
  .vg-sizes i { font-style: normal; display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 3px; box-sizing: border-box; border-radius: 4px; box-shadow: inset 0 0 0 1px #CCCCCC; font-size: 8.5px; font-weight: 600; color: #303030; }
  .vg-sizes i.is-on { background: #111; color: #fff; box-shadow: none; }
  .vg-chart-t { font-size: 11px; font-weight: 700; letter-spacing: -0.01em; color: #111; }
  .vg-chart { gap: 8px; }
  .vg-bar { display: grid; grid-template-columns: 38px 1fr 22px; align-items: center; gap: 6px; }
  .vg-bar-l { font-size: 9px; color: #303030; }
  .vg-bar-track { height: 6px; border-radius: 3px; background: #F1F1F1; overflow: hidden; }
  .vg-bar-track i { display: block; height: 100%; border-radius: 3px; background: #111; }
  .vg-bar-track i.is-1 { background: #616161; }
  .vg-bar-track i.is-2 { background: #B5B5B5; }
  .vg-bar-v { font-size: 9px; font-weight: 600; color: #111; text-align: right; font-variant-numeric: tabular-nums; }

  /* Slide 3: two option cards; the recommended one has a black border and
     label. Equal heights so both buttons line up at the bottom. */
  .gw-paths { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--p-space-400); max-width: 860px; width: 100%; margin: 0 auto; }
  .gw-path { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border-radius: var(--p-border-radius-300);
    border: var(--p-border-width-025) solid var(--p-color-border); background: var(--p-color-bg-surface); }
  .gw-path--feature { border: var(--p-border-width-050) solid var(--p-color-bg-fill-brand); }
  .gw-path-body { flex: 1; display: flex; flex-direction: column; gap: var(--p-space-600); padding: var(--p-space-500); }
  .gw-path-cta { margin-top: auto; }
  /* Polaris Icon centers itself with auto margins; pin it to the first line. */
  .gw-tick { display: inline-flex; flex: none; }

  @media (max-width: 900px) {
    .gw-goals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container gw-scene (max-width: 499px) { .gw-stagebox, .gw-arch { --gw-s: .92; } }
  @container gw-scene (max-width: 459px) { .gw-stagebox, .gw-arch { --gw-s: .88; } }
  @container gw-scene (max-width: 419px) { .gw-stagebox, .gw-arch { --gw-s: .84; } }
  @container gw-scene (max-width: 389px) { .gw-stagebox, .gw-arch { --gw-s: .78; } }
  @container gw-scene (max-width: 359px) { .gw-stagebox, .gw-arch { --gw-s: .72; } }
  @container gw-scene (max-width: 329px) { .gw-stagebox, .gw-arch { --gw-s: .66; } }
  @container gw-scene (max-width: 299px) { .gw-stagebox, .gw-arch { --gw-s: .6; } }
  /* Below Polaris md the grid stacks (InlineGrid xs: 1). */
  @media (max-width: 47.9975em) {
    /* Stacked, the panel's height follows its width (the stage scales
       with the width, so its margins stay even). */
    .gw-scene { min-height: 0; aspect-ratio: 4 / 5; max-height: 620px; }
    .gw-paths { grid-template-columns: 1fr; }
    .gw-path--feature { order: -1; }
  }
  @media (max-width: 489px) {
    .gw { padding-left: var(--p-space-400); padding-right: var(--p-space-400); }
  }
  @media (max-width: 640px) {
    .gw-goals { grid-template-columns: 1fr; }
    .gw-goal-art { height: 132px; padding-bottom: 14px; }
    .gw-goal-art > * { transform: scale(.9); transform-origin: bottom center; }
    .gw-foot-note { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gw-stage { animation: none; }
    .gw-goal, .gw-goal-art { transition: none; }
  }
`;
