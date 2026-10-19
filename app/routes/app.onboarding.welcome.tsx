// Welcome intro (2026-10-18): what a new install sees before the scope
// screen. Three slides, skippable: welcome (with how it works), what the
// quiz should do for the store (goals that change the generated quiz), and
// "How do you want to get started?" (free setup by our team, or build it
// with AI now). Built for Shopify 4.2.2: concise, guides to completion,
// every question says what it's used for; the expert half is the slide's
// one primary action and promises no outcomes (4.3.1).
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
import { Banner, BlockStack, Button, InlineStack, Page, Text, TextField } from "@shopify/polaris";
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
  GLEAME_LOGO_SRC,
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
        <div className="gw-card">
          <div className="gw-top">
            <BrandLockup size={28} />
            <div className="gw-top-end">
              <div className="gw-steps">
                <span className="gw-steps-label" aria-hidden>
                  Step {step + 1} of {INTRO_STEPS.length}
                </span>
                <div className="gw-dots" role="list" aria-label={`Step ${step + 1} of ${INTRO_STEPS.length}`}>
                  {INTRO_STEPS.map((s, i) => (
                    <span
                      key={s}
                      role="listitem"
                      className={`gw-dot${i === step ? " is-on" : ""}${i < step ? " is-done" : ""}`}
                      aria-current={i === step ? "step" : undefined}
                    />
                  ))}
                </div>
              </div>
              {!last && (
                <span className="gw-skip">
                  <Button variant="tertiary" onClick={() => void leave("skip")} disabled={leaving}>
                    Skip intro
                  </Button>
                </span>
              )}
            </div>
          </div>

          <div className="gw-stage" ref={stageRef} key={step}>
            {step === 0 && (
              <SlideWelcome
                firstName={data.firstName}
                shopName={data.shopName}
                products={products}
                onNext={() => go(1)}
              />
            )}
            {step === 1 && <SlideGoals goals={goals} products={products} onToggle={toggleGoal} />}
            {step === 2 && (
              <SlidePath
                products={products}
                email={data.email}
                offer={offer}
                leaving={leaving}
                onBuild={() => void leave("ai")}
                onExpertDone={() => void leave("expert")}
              />
            )}
          </div>

          {step > 0 && (
            <div className="gw-foot">
              <span className="gw-back">
                <Button variant="tertiary" onClick={() => go(step - 1)} disabled={leaving}>
                  Back
                </Button>
              </span>
              <div className="gw-foot-end">
                {footNote && <span className="gw-foot-note">{footNote}</span>}
                {!last && (
                  <Button variant="primary" size="large" onClick={() => go(step + 1)}>
                    Continue
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        {storeLine && (
          <p className="gw-store" aria-live="polite">
            <span className={`gw-store-dot${storeReady ? " is-ready" : ""}`} aria-hidden />
            {storeLine}
          </p>
        )}
      </div>
    </Page>
  );
}

// --- Slide 1: welcome -------------------------------------------------

function SlideWelcome({
  firstName,
  shopName,
  products,
  onNext,
}: {
  firstName: string;
  shopName: string;
  products: PreviewProduct[];
  onNext: () => void;
}) {
  return (
    <div className="gw-hero">
      <div className="gw-copy">
        <span className="gw-eyebrow">{firstName ? `Welcome, ${firstName}` : "Welcome to Gleame"}</span>
        <h1 className="gw-h1" tabIndex={-1}>
          Help every shopper find their match.
        </h1>
        <p className="gw-lede">
          Gleame turns your catalog into a short quiz. Shoppers answer a few questions, see the products made for
          them, and add them to cart.
        </p>
        <ol className="gw-how" aria-label="How it works">
          {HOW_STEPS.map((h, i) => (
            <li key={h.title}>
              <span className="gw-how-n" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="gw-how-text">
                <span className="gw-how-t">{h.title}</span>
                <span className="gw-how-b">{h.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="gw-cta">
          <Button variant="primary" size="large" onClick={onNext}>
            Get started
          </Button>
          <span className="gw-meta">
            About 2 minutes
            <i aria-hidden />
            Nothing goes live until you publish
          </span>
        </div>
      </div>
      <QuizScene shopName={shopName} products={products} />
    </div>
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
              <i className="is-on" />
              <i className="is-on" />
              <i />
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
  onToggle,
}: {
  goals: IntroGoal[];
  products: PreviewProduct[];
  onToggle: (g: IntroGoal) => void;
}) {
  return (
    <div className="gw-goals-slide">
      <div className="gw-head">
        <h2 className="gw-h2" tabIndex={-1}>
          What should your quiz do for you?
        </h2>
        <p className="gw-lede">Pick any that apply, or none. We use your picks to shape the quiz we write for you.</p>
      </div>
      <div className="gw-goals" role="group" aria-label="Goals">
        {GOAL_CHOICES.map((g) => {
          const on = goals.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`gw-goal${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => onToggle(g.id)}
            >
              <span className="gw-goal-art" aria-hidden>
                <GoalVignette id={g.id} products={products} />
              </span>
              <span className="gw-goal-text">
                <span className="gw-goal-t">{g.title}</span>
                <span className="gw-goal-b">{g.body}</span>
              </span>
              <span className="gw-goal-check" aria-hidden>
                {on && <CheckGlyph />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
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

// The AI path: a draft quiz outline where every question already leads to
// products (the store's own when we have them).
const DRAFT_QUESTIONS = ["Which look feels most like you?", "How bold do you like it?", "What's the occasion?"];

function DraftVignette({ products }: { products: PreviewProduct[] }) {
  return (
    <span className="vg-card vp-draft">
      <span className="vg-fit-row vp-head">
        <span className="vg-chart-t">Your quiz</span>
        <span className="vg-k">Draft</span>
      </span>
      {DRAFT_QUESTIONS.map((q, i) => (
        <span key={q} className="vp-q">
          <span className="vp-q-n">{String(i + 1).padStart(2, "0")}</span>
          <span className="vp-q-t">{q}</span>
          <span className="vp-q-m">
            {[i, i + 1].map((k) => (
              <span key={k} className="vp-q-img">
                <ProductArt product={products.length >= 4 ? products[k] : null} index={k} width={20} />
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

// The expert path: who does it, and the four things the setup offer covers
// (components/SetupOfferModal: questions, product matches, styling, launch).
const TEAM_COVERS = ["Questions", "Product matches", "Styling", "Launch"];

function TeamVignette() {
  return (
    <span className="vg-card vp-team">
      <span className="vp-team-who">
        <img className="vp-team-av" src={GLEAME_LOGO_SRC} alt="" width={28} height={28} />
        <span className="vp-team-id">
          <span className="vg-chart-t">Gleame setup team</span>
          <span className="vp-team-s">Works with you by email</span>
        </span>
      </span>
      <span className="vp-team-covers">
        {TEAM_COVERS.map((c) => (
          <span key={c}>
            <CheckGlyph />
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}

// --- Slide 3: choose a path ----------------------------------------------

function SlidePath({
  products,
  email,
  offer,
  leaving,
  onBuild,
  onExpertDone,
}: {
  products: PreviewProduct[];
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
  if (requested) {
    expertBody = (
      <>
        <div className="gw-done">
          <span className="gw-ok">
            <CheckGlyph />
          </span>
          <Text as="h4" variant="headingMd">
            You're on the list
          </Text>
        </div>
        <p className="gw-opt-p">
          Our setup team will email you at <b>{mail}</b>. Build a draft with AI in the meantime and we'll pick up from
          there.
        </p>
        <div className="gw-opt-cta">
          <Button variant="primary" size="large" fullWidth onClick={onExpertDone} loading={leaving}>
            Build a draft while I wait
          </Button>
        </div>
      </>
    );
  } else if (formOpen) {
    expertBody = (
      <>
        {offer.data?.error && <Banner tone="critical">{offer.data.error}</Banner>}
        <BlockStack gap="300">
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
        <div className="gw-opt-cta">
          <InlineStack gap="200" blockAlign="center">
            <Button variant="primary" size="large" onClick={request} loading={sending} disabled={!mail.trim()}>
              Request free setup
            </Button>
            <Button variant="tertiary" onClick={() => setFormOpen(false)} disabled={sending}>
              Cancel
            </Button>
          </InlineStack>
        </div>
      </>
    );
  } else {
    expertBody = (
      <>
        <ul className="gw-spec">
          <li>We build, style and launch the quiz on your store</li>
          <li>A person tunes which products each answer leads to</li>
          <li>You can keep editing it after</li>
        </ul>
        <div className="gw-opt-cta">
          <Button variant="primary" size="large" fullWidth onClick={() => setFormOpen(true)}>
            Get free expert setup
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="gw-path-slide">
      <div className="gw-head gw-head--center">
        <h2 className="gw-h2" tabIndex={-1}>
          How do you want to get started?
        </h2>
        <p className="gw-lede">Either way, you can change everything later.</p>
      </div>
      <div className="gw-fork">
        <section className="gw-opt" aria-labelledby="gw-opt-ai">
          <span className="gw-opt-art" aria-hidden>
            <DraftVignette products={products} />
          </span>
          <span className="gw-opt-k">On your own</span>
          <h3 className="gw-opt-h" id="gw-opt-ai">
            Build it myself with AI
          </h3>
          <p className="gw-opt-sub">Ready in about 2 minutes.</p>
          <ul className="gw-spec">
            <li>A complete quiz written from your catalog</li>
            <li>Edit every question, answer and match in the Studio</li>
            <li>Publish whenever you're ready</li>
          </ul>
          <div className="gw-opt-cta">
            <Button size="large" fullWidth onClick={onBuild} loading={leaving && !requested}>
              Build my quiz
            </Button>
          </div>
        </section>
        <div className="gw-or" aria-hidden>
          <span>or</span>
        </div>
        <section className="gw-opt gw-opt--feature" aria-labelledby="gw-opt-expert">
          <span className="gw-opt-art" aria-hidden>
            <TeamVignette />
          </span>
          <span className="gw-opt-k">Free · done for you</span>
          <h3 className="gw-opt-h" id="gw-opt-expert">
            Set it up with an expert
          </h3>
          <p className="gw-opt-sub">Our team does it with you.</p>
          {expertBody}
        </section>
      </div>
    </div>
  );
}

// Admin surfaces stay Polaris (Page, Buttons, form controls; Built for
// Shopify 4.1.1). The brand is the black logo only: black, white and warm
// greys, no AI purple, no sparkle glyphs. No looping motion (4.3.3): one
// fade as a slide enters. Text colors hold WCAG AA on white and on sand.
const WELCOME_CSS = `
  .gw { --gw-ink: #141414; --gw-text: #303030; --gw-muted: #6B6862; --gw-line: #E8E6E1; --gw-line-2: #D6D3CC;
    --gw-sand: #F5F4F1; --gw-sand-2: #ECE9E3;
    max-width: 1080px; margin: 0 auto; padding: var(--p-space-400, 16px) 0 var(--p-space-1200, 48px); }
  .gw-card { background: var(--p-color-bg-surface, #fff); border-radius: var(--p-border-radius-300, 12px);
    box-shadow: var(--p-shadow-100, 0 1px 0 rgba(26,26,26,.07)), inset 0 -1px 0 rgba(0,0,0,.08), inset 0 0 0 1px rgba(0,0,0,.04);
    padding: 22px 40px 28px; }

  /* Top bar: lockup, progress, skip */
  .gw-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 36px; }
  .gw-top-end { display: flex; align-items: center; gap: 12px; }
  .gw-steps { display: inline-flex; align-items: center; gap: 12px; }
  .gw-steps-label { font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--gw-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gw-dots { display: inline-flex; gap: 4px; }
  .gw-dot { width: 20px; height: 3px; border-radius: 2px; background: var(--gw-line-2); transition: background 180ms ease; }
  .gw-dot.is-done, .gw-dot.is-on { background: var(--gw-ink); }
  .gw-skip { display: inline-flex; padding-left: 8px; margin-right: -12px; border-left: 1px solid var(--gw-line); }
  .gw-back { display: inline-flex; margin-left: -12px; }

  .gw-stage { min-height: 440px; padding: 36px 0 4px; animation: gw-in 220ms ease-out; }
  @keyframes gw-in { from { opacity: 0; } to { opacity: 1; } }

  /* Type */
  .gw-eyebrow { display: flex; align-items: center; gap: 12px; font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: var(--gw-muted); }
  .gw-eyebrow::before { content: ""; width: 24px; height: 1.5px; background: var(--gw-ink); flex: none; }
  .gw-h1 { margin: 16px 0 0; font-size: clamp(34px, 4.4vw, 50px); line-height: 1.03; letter-spacing: -0.035em; font-weight: 700; color: var(--gw-ink); outline: none; text-wrap: balance; }
  .gw-h2 { margin: 0; font-size: clamp(26px, 3vw, 34px); line-height: 1.1; letter-spacing: -0.028em; font-weight: 700; color: var(--gw-ink); outline: none; text-wrap: balance; }
  .gw-lede { margin: 14px 0 0; font-size: 16px; line-height: 1.55; color: #4D4A45; max-width: 31em; text-wrap: pretty; }
  .gw-head .gw-lede { margin-top: 10px; max-width: 40em; }
  .gw-head--center { text-align: center; display: grid; justify-items: center; }
  .gw-meta { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; color: var(--gw-muted); }
  .gw-meta i { width: 3px; height: 3px; border-radius: 50%; background: var(--gw-line-2); }

  /* Slide 1: copy beside the quiz scene */
  .gw-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: 40px; align-items: stretch; }
  .gw-copy { max-width: 470px; align-self: center; }
  .gw-how { list-style: none; margin: 28px 0 0; padding: 0; border-top: 1px solid var(--gw-line); }
  .gw-how li { display: grid; grid-template-columns: 40px minmax(0, 1fr); padding: 13px 0; border-bottom: 1px solid var(--gw-line); }
  .gw-how-n { font-size: 12px; line-height: 20px; font-weight: 600; letter-spacing: .04em; color: var(--gw-ink); font-variant-numeric: tabular-nums; }
  .gw-how-text { display: grid; gap: 2px; }
  .gw-how-t { font-size: 14px; line-height: 20px; font-weight: 650; color: var(--gw-ink); }
  .gw-how-b { font-size: 13px; line-height: 18px; color: var(--gw-muted); text-wrap: pretty; }
  .gw-cta { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 18px; margin-top: 28px; }

  /* The scene: a sand panel with a centered arch, the phone, and a question
     card in front. The stage is drawn once at 420x580 and scaled (--gw-s)
     by the panel's own width, so it keeps the same margins at any size. */
  .gw-scene { container: gw-scene / inline-size; position: relative; display: flex; align-items: center; justify-content: center; min-height: 560px;
    border-radius: 14px; background: var(--gw-sand); overflow: hidden; }
  .gw-stagebox, .gw-arch { --gw-s: 1; }
  .gw-stagebox { position: relative; flex: none; width: 420px; height: 580px; transform: scale(var(--gw-s)); }
  /* Flat, symmetric, bottom flush; its crown clears the phone by 34px. The
     999px radius resolves to half the width: a true semicircle. */
  .gw-arch { position: absolute; left: 50%; bottom: 0; width: min(72%, calc(336px * var(--gw-s))); top: calc(50% - 277px * var(--gw-s));
    transform: translateX(-50%); border-radius: 999px 999px 0 0; background: var(--gw-sand-2); }
  .gw-phone { position: absolute; left: 18px; top: calc(50% - 243px); width: 236px; height: 486px; padding: 8px; box-sizing: border-box; border-radius: 42px; background: #111;
    box-shadow: inset 0 0 0 1.5px #3a3a3a, 0 44px 60px -36px rgba(30, 22, 12, .55), 0 18px 30px -18px rgba(30, 22, 12, .3); }
  .gw-screen { position: relative; height: 100%; border-radius: 34px; background: #fff; overflow: hidden; display: flex; flex-direction: column; }
  .gw-status { display: flex; justify-content: space-between; align-items: center; height: 38px; padding: 4px 22px 0 26px; font-size: 11px; font-weight: 650; color: #111; flex: none; }
  .gw-status-r { display: inline-flex; align-items: center; gap: 3px; }
  .gw-status-r i { width: 3px; height: 7px; border-radius: 1px; background: #111; }
  .gw-status-r i:first-child { height: 5px; }
  .gw-status-r b { width: 18px; height: 8px; margin-left: 3px; border-radius: 2.5px; box-shadow: inset 0 0 0 1px #111; background: linear-gradient(90deg, #111 70%, transparent 70%); background-clip: content-box; padding: 1.5px; box-sizing: border-box; }
  .gw-island { position: absolute; top: 10px; left: 50%; width: 70px; height: 20px; margin-left: -35px; border-radius: 999px; background: #111; }
  .gw-sbar { display: grid; grid-template-columns: 16px 1fr 16px; align-items: center; gap: 8px; height: 36px; padding: 0 16px; border-bottom: 1px solid #EEECE8; flex: none; }
  .gw-sbar svg { width: 14px; height: 14px; fill: none; stroke: #111; stroke-width: 1.4; }
  .gw-sbar-name { text-align: center; font-size: 10.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gw-res { display: flex; flex-direction: column; flex: 1; padding: 16px 14px 14px; min-height: 0; }
  .gw-res-k { display: flex; align-items: center; gap: 7px; font-size: 8px; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; color: #6B6862; }
  .gw-res-k::before { content: ""; width: 12px; height: 1px; background: #111; }
  .gw-res-h { margin: 6px 0 12px; font-size: 19px; line-height: 1.1; font-weight: 700; letter-spacing: -0.03em; color: #111; }
  .gw-res-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 8px; }
  .gw-res-tile { display: grid; gap: 5px; min-width: 0; }
  .gw-res-img { position: relative; display: block; aspect-ratio: 1 / 1.08; border-radius: 8px; overflow: hidden; }
  .gw-res-tag { position: absolute; top: 6px; left: 6px; padding: 3px 6px; border-radius: 999px; background: #111; color: #fff; font-size: 6.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .gw-res-name { font-size: 10px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gw-res-cta { margin-top: auto; display: block; text-align: center; padding: 10px; border-radius: 999px; background: #111; color: #fff; font-size: 11px; font-weight: 600; }
  .gw-q { position: absolute; right: 18px; top: calc(50% - 92px); width: 206px; padding: 14px; box-sizing: border-box; border-radius: 14px; background: #fff;
    box-shadow: 0 0 0 1px rgba(20, 16, 10, .05), 0 28px 50px -22px rgba(30, 22, 12, .42), 0 6px 14px -8px rgba(30, 22, 12, .16); }
  .gw-q-top { display: flex; align-items: center; justify-content: space-between; font-size: 8px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; color: #6B6862; }
  .gw-q-prog { display: inline-flex; gap: 3px; }
  .gw-q-prog i { width: 12px; height: 2.5px; border-radius: 2px; background: #DDD9D2; }
  .gw-q-prog i.is-on { background: #111; }
  .gw-q-h { margin: 10px 0 12px; font-size: 14px; line-height: 1.25; font-weight: 700; letter-spacing: -0.015em; color: #111; text-wrap: balance; }
  .gw-q-opts { display: grid; gap: 6px; }
  .gw-q-opt { position: relative; display: flex; align-items: center; gap: 9px; height: 32px; padding: 0 10px; border-radius: 9px; border: 1px solid #E8E6E1; font-size: 11.5px; font-weight: 550; color: #222; }
  .gw-q-opt i { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08); flex: none; }
  .gw-q-opt.is-on { border-color: #111; box-shadow: inset 0 0 0 .5px #111; }
  .gw-q-opt b { margin-left: auto; width: 15px; height: 15px; border-radius: 50%; background: #111; color: #fff; display: inline-flex; }
  .gw-q-opt b svg { width: 15px; height: 15px; }

  /* Slide 2: goals */
  .gw-goals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 32px; }
  .gw-goal { appearance: none; font: inherit; position: relative; display: flex; flex-direction: column; text-align: left; cursor: pointer;
    padding: 6px 6px 18px; border-radius: 16px; background: #fff; border: 1px solid var(--gw-line); color: inherit;
    transition: border-color 140ms ease, box-shadow 140ms ease; }
  .gw-goal:hover { border-color: var(--gw-line-2); }
  .gw-goal:focus-visible { outline: 2px solid var(--p-color-border-focus, #005bd3); outline-offset: 2px; }
  .gw-goal.is-on { border-color: var(--gw-ink); box-shadow: inset 0 0 0 1px var(--gw-ink); }
  .gw-goal-art { display: flex; align-items: flex-end; justify-content: center; height: 156px; padding-bottom: 18px; box-sizing: border-box; border-radius: 11px; background: var(--gw-sand); overflow: hidden; transition: background 140ms ease; }
  .gw-goal.is-on .gw-goal-art { background: var(--gw-sand-2); }
  .gw-goal-text { display: grid; gap: 5px; padding: 16px 12px 0; }
  .gw-goal-t { font-size: 15px; line-height: 20px; font-weight: 650; letter-spacing: -0.01em; color: var(--gw-ink); }
  .gw-goal-b { font-size: 13px; line-height: 18px; color: var(--gw-muted); }
  .gw-goal-check { position: absolute; top: 13px; right: 13px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 1.5px var(--gw-line-2); color: #fff; display: inline-flex; }
  .gw-goal.is-on .gw-goal-check { background: var(--gw-ink); box-shadow: none; }
  .gw-goal-check svg { width: 20px; height: 20px; }

  /* Goal vignettes: small, exact UI */
  .vg-card { display: grid; gap: 8px; width: 150px; padding: 11px; box-sizing: border-box; border-radius: 10px; background: #fff; line-height: 1.25;
    box-shadow: 0 0 0 1px rgba(20, 16, 10, .05), 0 10px 22px -12px rgba(30, 22, 12, .3); }
  .vg-k { font-size: 8.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #6B6862; }
  .vg-v { font-size: 10.5px; font-weight: 650; color: #111; }
  .vg-prods { display: flex; gap: 8px; align-items: stretch; }
  .vg-pc { display: grid; gap: 5px; width: 70px; line-height: 1.25; padding: 5px 5px 7px; box-sizing: border-box; border-radius: 9px; background: #fff;
    box-shadow: 0 0 0 1px rgba(20, 16, 10, .05), 0 10px 22px -12px rgba(30, 22, 12, .3); }
  .vg-pc-img { position: relative; display: block; height: 54px; border-radius: 6px; overflow: hidden; }
  .vg-pc-tag { position: absolute; left: 4px; top: 4px; padding: 2px 4px; border-radius: 999px; background: #111; color: #fff; font-size: 5.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .vg-pc-n { font-size: 9px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 1px; }
  .vg-pc-add { display: block; text-align: center; padding: 4px 0; border-radius: 999px; background: #111; color: #fff; font-size: 7px; font-weight: 600; }
  .vg-pc + .vg-pc .vg-pc-add { background: #fff; color: #111; box-shadow: inset 0 0 0 1px #D6D3CC; }
  .vg-mail-t { font-size: 11px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #111; }
  .vg-mail-row { display: flex; gap: 5px; }
  .vg-mail-in { flex: 1; display: flex; align-items: center; height: 26px; padding: 0 8px; border-radius: 6px; box-shadow: inset 0 0 0 1px #D6D3CC; font-size: 9.5px; color: #8A867F; }
  .vg-mail-go { width: 26px; height: 26px; border-radius: 6px; background: #111; display: inline-flex; align-items: center; justify-content: center; }
  .vg-mail-go svg { width: 13px; height: 13px; fill: none; stroke: #fff; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .vg-mail-fine { font-size: 8px; color: #8A867F; }
  .vg-fit-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .vg-fit-row--rule { padding-top: 8px; border-top: 1px solid #EEECE8; }
  .vg-swatches { display: flex; justify-content: space-between; }
  .vg-swatches i { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }
  .vg-swatches i.is-on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.25px #111; }
  .vg-sizes { display: inline-flex; gap: 3px; }
  .vg-sizes i { font-style: normal; display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 3px; box-sizing: border-box; border-radius: 4px; box-shadow: inset 0 0 0 1px #D6D3CC; font-size: 8.5px; font-weight: 600; color: #303030; }
  .vg-sizes i.is-on { background: #111; color: #fff; box-shadow: none; }
  .vg-chart-t { font-size: 11px; font-weight: 700; letter-spacing: -0.01em; color: #111; }
  .vg-chart { gap: 8px; }
  .vg-bar { display: grid; grid-template-columns: 38px 1fr 22px; align-items: center; gap: 6px; }
  .vg-bar-l { font-size: 9px; color: #303030; }
  .vg-bar-track { height: 6px; border-radius: 3px; background: #F0EEEA; overflow: hidden; }
  .vg-bar-track i { display: block; height: 100%; border-radius: 3px; background: #111; }
  .vg-bar-track i.is-1 { background: #77726A; }
  .vg-bar-track i.is-2 { background: #B5B0A7; }
  .vg-bar-v { font-size: 9px; font-weight: 600; color: #111; text-align: right; font-variant-numeric: tabular-nums; }
  .vp-draft, .vp-team { width: 244px; }
  .vp-draft { gap: 0; padding: 11px 12px 5px; }
  .vp-head { padding-bottom: 8px; }
  .vp-q { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 6px; height: 27px; border-top: 1px solid #EEECE8; }
  .vp-q-n { font-size: 8.5px; font-weight: 600; letter-spacing: .04em; color: #6B6862; font-variant-numeric: tabular-nums; }
  .vp-q-t { font-size: 10px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vp-q-m { display: inline-flex; }
  .vp-q-img { display: block; width: 18px; height: 18px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 1.5px #fff; }
  .vp-q-img + .vp-q-img { margin-left: -4px; }
  .vp-team { gap: 11px; padding: 12px; }
  .vp-team-who { display: flex; align-items: center; gap: 9px; }
  .vp-team-av { display: block; width: 28px; height: 28px; border-radius: 50%; flex: none; }
  .vp-team-id { display: grid; gap: 1px; }
  .vp-team-s { font-size: 9px; color: #6B6862; }
  .vp-team-covers { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; padding-top: 10px; border-top: 1px solid #EEECE8; }
  .vp-team-covers span { display: flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 600; color: #303030; white-space: nowrap; }
  .vp-team-covers svg { width: 12px; height: 12px; flex: none; color: #111; }

  /* Slide 3: one decision, two halves */
  .gw-fork { display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); max-width: 880px; margin: 32px auto 0;
    border: 1px solid var(--gw-line); border-radius: 18px; overflow: hidden; }
  .gw-opt { display: flex; flex-direction: column; padding: 28px 30px 30px; min-width: 0; }
  .gw-opt--feature { background: var(--gw-sand); --gw-line: #E3E0DA; }
  .gw-opt-art { display: flex; align-items: center; justify-content: center; height: 136px; margin: -18px -20px 24px; border-radius: 10px; background: var(--gw-sand); }
  .gw-opt--feature .gw-opt-art { background: var(--gw-sand-2); }
  .gw-opt-k { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--gw-muted); }
  .gw-opt-sub { margin: 4px 0 22px; font-size: 14px; line-height: 20px; color: var(--gw-muted); }
  .gw-opt-h { margin: 10px 0 0; font-size: 22px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; color: var(--gw-ink); }
  .gw-opt-p { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: var(--gw-text); }
  .gw-spec { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--gw-line); }
  .gw-spec li { position: relative; padding: 10px 0 10px 28px; border-bottom: 1px solid var(--gw-line); font-size: 13.5px; line-height: 20px; color: var(--gw-text); }
  .gw-spec li::before { content: ""; position: absolute; left: 1px; top: 12px; width: 16px; height: 16px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.4 6.6 11.3 12.5 4.9' fill='none' stroke='%23141414' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/16px no-repeat; }
  .gw-opt-cta { margin-top: auto; padding-top: 28px; }
  .gw-or { position: relative; background: var(--gw-line); }
  .gw-or span { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 34px; height: 34px; border-radius: 50%;
    background: #fff; box-shadow: 0 0 0 1px var(--gw-line); display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; letter-spacing: .06em; color: var(--gw-muted); }
  .gw-done { display: flex; align-items: center; gap: 10px; }
  .gw-ok { width: 24px; height: 24px; border-radius: 50%; background: var(--gw-ink); color: #fff; display: inline-flex; flex: none; }
  .gw-ok svg { width: 24px; height: 24px; }

  /* Footer: back, then a note and the slide's one primary */
  .gw-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--gw-line); }
  .gw-foot-end { display: flex; align-items: center; gap: 18px; min-width: 0; }
  .gw-foot-note { font-size: 12.5px; color: var(--gw-muted); text-align: right; }

  /* Store read status */
  .gw-store { display: flex; align-items: center; justify-content: center; gap: 8px; width: max-content; max-width: 100%; box-sizing: border-box;
    margin: 18px auto 0; padding: 6px 14px; border-radius: 999px; background: var(--p-color-bg-surface, #fff);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .06); font-size: 12.5px; color: var(--gw-muted); text-align: center; }
  .gw-store-dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--gw-ink); flex: none; }
  .gw-store-dot.is-ready { background: var(--p-color-bg-fill-success, #29845a); box-shadow: none; }

  @media (max-width: 1040px) {
    .gw-card { padding: 22px 28px 24px; }
    .gw-hero { gap: 32px; }
  }
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
  @media (max-width: 860px) {
    .gw-hero { grid-template-columns: 1fr; gap: 28px; }
    .gw-copy { max-width: none; }
    .gw-stage { min-height: 0; }
    /* Stacked, the panel's height follows its width (the stage scales
       with the width, so its margins stay even). */
    .gw-scene { min-height: 0; aspect-ratio: 4 / 5; max-height: 620px; }
  }
  @media (max-width: 489px) {
    .gw { padding-left: 16px; padding-right: 16px; }
  }
  @media (max-width: 640px) {
    .gw-card { padding: 16px 16px 20px; }
    .gw-steps-label { display: none; }
    .gw-skip { padding-left: 8px; }
    .gw-stage { padding-top: 24px; }
    .gw-h1 { font-size: 34px; }
    .gw-h2 { font-size: 26px; }
    .gw-lede { font-size: 15px; }
    .gw-goals { grid-template-columns: 1fr; gap: 12px; margin-top: 24px; }
    .gw-goal-art { height: 132px; padding-bottom: 14px; }
    .gw-goal-art > * { transform: scale(.9); transform-origin: bottom center; }
    .gw-fork { grid-template-columns: 1fr; grid-template-rows: auto 1px auto; margin-top: 24px; }
    .gw-opt { padding: 22px 20px 24px; }
    .gw-opt-art { height: 124px; margin: -12px -10px 20px; }
    .gw-opt--feature { order: -1; }
    .gw-or { order: 0; }
    .gw-opt:not(.gw-opt--feature) { order: 1; padding-top: 34px; }
    .gw-foot { margin-top: 24px; padding-top: 16px; }
    .gw-foot-note { display: none; }
    /* Too long for a one-line pill here: a plain centered status line. */
    .gw-store { display: block; width: auto; padding: 0 8px; background: none; box-shadow: none; text-wrap: balance; }
    .gw-store-dot { display: inline-block; margin-right: 8px; vertical-align: 1px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gw-stage { animation: none; }
    .gw-dot, .gw-goal { transition: none; }
  }
`;
