// Welcome intro (2026-10-18): what a new install sees before the scope
// screen. Three slides, skippable: welcome (with how it works), what the
// quiz should do for the store (goals that change the generated quiz), and
// "How do you want to get started?" (free setup by our team, or build it
// with AI now). Built for Shopify 4.2.2: concise, guides to completion,
// every question says what it's used for; the expert card is the slide's
// one primary action and promises no outcomes (4.3.1).
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
import { Banner, BlockStack, Button, Icon, InlineStack, Page, Text, TextField } from "@shopify/polaris";
import {
  ChartVerticalIcon,
  CheckIcon,
  EmailIcon,
  MagicIcon,
  PackageReturnedIcon,
  PersonIcon,
  StoreIcon,
  TargetIcon,
  ThemeEditIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShopExists, supabase } from "../lib/supabase.server";
import { shopHasRealQuiz } from "../lib/quiz-draft.server";
import { useCatalogSync } from "../lib/use-catalog-sync";
import { getSetupOfferContact } from "../lib/setup-offer.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import { introDone, type IntroGoal, type IntroPath } from "../lib/onboarding-intro.server";

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
  const contact = await getSetupOfferContact(admin);
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
const GOAL_CHOICES: Array<{ id: IntroGoal; title: string; body: string; icon: typeof TargetIcon }> = [
  { id: "choose", title: "Help shoppers choose", body: "Every answer leads to real products from your catalog.", icon: TargetIcon },
  { id: "emails", title: "Grow my email list", body: "We'll add an email step to your quiz. You choose where it goes.", icon: EmailIcon },
  { id: "returns", title: "Cut returns", body: "We'll include a question that pins down fit: shade, size or skin type.", icon: PackageReturnedIcon },
  { id: "insights", title: "Learn what shoppers want", body: "Every answer shows up in Analytics, from the first shopper.", icon: ChartVerticalIcon },
];

const HOW_STEPS: Array<{ title: string; body: string; icon: typeof TargetIcon }> = [
  { title: "We read your store", body: "Your products, collections and the look of your theme.", icon: StoreIcon },
  { title: "AI writes your quiz", body: "Questions, answers, and which products each answer leads to.", icon: MagicIcon },
  { title: "You make it yours", body: "Change anything in the Studio, then put it on a page.", icon: ThemeEditIcon },
];

// The Gleame "G" (public/placeholders/gleametransparent.svg).
const G_PATHS = [
  "M270.314 21.0001V21.3223C132.622 21.3223 21 134.639 21 274.421C21 373.976 63.8516 451.773 146.184 493.102C136.046 487.808 140.348 490.009 131.677 483.036C95.6525 454.069 73.3975 410.683 73.3975 353.101C73.3975 238.649 161.317 145.689 270.222 144.641V144.632H365.396C432.655 144.632 487.18 89.2798 487.18 21.0001H270.314Z",
  "M143.264 490.907C161.826 494.411 179.736 492.577 197.451 489.147C227.389 483.351 254.31 469.192 279.928 450.049C322.499 418.236 353.942 370.527 362.189 319.712L245.748 320.816C245.34 320.82 244.969 320.658 244.696 320.392C244.156 319.976 243.945 319.226 244.23 318.568L260.097 281.892L260.103 281.878L260.113 281.851C260.132 281.805 260.161 281.735 260.196 281.648C260.269 281.47 260.374 281.206 260.514 280.868C260.792 280.19 261.2 279.207 261.716 277.988C262.748 275.548 264.217 272.153 265.964 268.333C269.449 260.715 274.077 251.33 278.575 244.466C279.888 242.463 281.471 240.299 283.21 238.07C298.966 217.878 324.122 208.61 349.256 208.61C349.323 208.61 349.396 208.602 349.461 208.61L517.133 208.625V278.334C517.133 321.827 506.415 364.629 485.955 402.843L484.308 405.919C473.542 426.026 459.96 444.444 443.988 460.594C397.154 507.947 332.574 533.89 266.751 526.843C245.836 524.604 226.787 521.983 215.711 519.085C197.963 514.44 159.247 497.551 142.338 490.907C140.985 490.488 141.95 490.659 143.264 490.907Z",
];

function GleameMark({ size = 40 }: { size?: number }) {
  return (
    <span className="gw-mark" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="15 21 508 508">
        {G_PATHS.map((d) => (
          <path key={d.slice(0, 12)} d={d} />
        ))}
      </svg>
    </span>
  );
}

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

  return (
    <Page>
      <TitleBar title="Welcome to Gleame" />
      <style>{WELCOME_CSS}</style>
      <div className="gw">
        <div className="gw-card">
          <div className="gw-top">
            <div className="gw-brand">
              <GleameMark size={28} />
              <span className="gw-brand-name">Gleame</span>
            </div>
            {!last && (
              <Button variant="tertiary" onClick={() => void leave("skip")} disabled={leaving}>
                Skip intro
              </Button>
            )}
          </div>

          <div className="gw-stage" ref={stageRef} key={step}>
            {step === 0 && <SlideWelcome firstName={data.firstName} onNext={() => go(1)} />}
            {step === 1 && <SlideGoals goals={goals} onToggle={toggleGoal} />}
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

          <div className="gw-foot">
            <div className="gw-foot-side">
              {step > 0 && (
                <Button variant="tertiary" onClick={() => go(step - 1)} disabled={leaving}>
                  Back
                </Button>
              )}
            </div>
            <div className="gw-dots" role="list" aria-label={`Step ${step + 1} of ${INTRO_STEPS.length}`}>
              {INTRO_STEPS.map((s, i) => (
                <span key={s} role="listitem" className={`gw-dot${i === step ? " is-on" : ""}${i < step ? " is-done" : ""}`} aria-current={i === step ? "step" : undefined} />
              ))}
            </div>
            <div className="gw-foot-side gw-foot-end">
              {step > 0 && !last && (
                <Button variant="primary" onClick={() => go(step + 1)}>
                  {INTRO_STEPS[step] === "goals" && goals.length === 0 ? "Skip this" : "Continue"}
                </Button>
              )}
            </div>
          </div>
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

function SlideWelcome({ firstName, onNext }: { firstName: string; onNext: () => void }) {
  return (
    <div className="gw-split">
      <div className="gw-copy">
        <BlockStack gap="400">
          <span className="gw-eyebrow">{firstName ? `Welcome, ${firstName}` : "Welcome to Gleame"}</span>
          <h1 className="gw-h1" tabIndex={-1}>
            Help every shopper find their match
          </h1>
          <Text as="p" variant="bodyLg" tone="subdued">
            Gleame turns your catalog into a short quiz. Shoppers answer a few questions, see the products made
            for them, and add them to cart.
          </Text>
          <ol className="gw-how" aria-label="How it works">
            {HOW_STEPS.map((h) => (
              <li key={h.title} className="gw-how-row">
                <span className="gw-ic">
                  <Icon source={h.icon} />
                </span>
                <span className="gw-how-text">
                  <span className="gw-how-t">{h.title}</span>
                  <span className="gw-how-b">{h.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <InlineStack gap="300" blockAlign="center">
            <Button variant="primary" size="large" onClick={onNext}>
              Get started
            </Button>
            <Text as="span" variant="bodySm" tone="subdued">
              About 2 minutes · nothing goes live until you publish
            </Text>
          </InlineStack>
        </BlockStack>
      </div>
      <QuizIllustration />
    </div>
  );
}

/** A quiz on a phone, drawn in CSS: one question, then the matches. */
function QuizIllustration() {
  return (
    <div className="gw-ill" aria-hidden>
      <div className="gw-glow" />
      <div className="gw-phone">
        <div className="gw-ph-bar">
          <span className="gw-ph-step">Question 2 of 4</span>
          <span className="gw-ph-prog">
            <i style={{ width: "50%" }} />
          </span>
        </div>
        <p className="gw-ph-q">Which shade family feels most like you?</p>
        <div className="gw-ph-opts">
          {[
            ["#F2D4C9", "Fair & cool"],
            ["#E3B49A", "Light & warm"],
            ["#B9825F", "Medium & golden"],
            ["#7A4A33", "Deep & rich"],
          ].map(([c, l], i) => (
            <span key={l} className={`gw-ph-opt${i === 1 ? " is-on" : ""}`}>
              <i style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
        <span className="gw-ph-cta">Continue</span>
      </div>
      <div className="gw-match">
        <span className="gw-match-k">Your matches</span>
        <div className="gw-match-row">
          <span className="gw-prod" style={{ background: "linear-gradient(160deg,#F6E3DA,#E8BFAE)" }}>
            <b style={{ background: "#C98A76" }} />
          </span>
          <span className="gw-prod" style={{ background: "linear-gradient(160deg,#F3E7EF,#DCC3D6)" }}>
            <b style={{ background: "#8E4C78" }} />
          </span>
        </div>
        <span className="gw-match-add">Add both to cart</span>
      </div>
    </div>
  );
}

// --- Slide 2: goals ----------------------------------------------------

function SlideGoals({ goals, onToggle }: { goals: IntroGoal[]; onToggle: (g: IntroGoal) => void }) {
  return (
    <BlockStack gap="600">
      <BlockStack gap="200">
        <h2 className="gw-h2" tabIndex={-1}>
          What should your quiz do for you?
        </h2>
        <Text as="p" variant="bodyLg" tone="subdued">
          Pick any that apply. We use your picks to shape the quiz we write for you.
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
              onClick={() => onToggle(g.id)}
            >
              <span className="gw-ic">
                <Icon source={g.icon} />
              </span>
              <span className="gw-goal-text">
                <span className="gw-goal-t">{g.title}</span>
                <span className="gw-goal-b">{g.body}</span>
              </span>
              <span className="gw-goal-check" aria-hidden>
                {on && <Icon source={CheckIcon} />}
              </span>
            </button>
          );
        })}
      </div>
      <Text as="p" variant="bodySm" tone="subdued">
        Everything stays editable in the Studio after your quiz is built.
      </Text>
    </BlockStack>
  );
}

// --- Slide 3: choose a path ----------------------------------------------

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
  if (requested) {
    expertBody = (
      <>
        <div className="gw-done">
          <span className="gw-ok">
            <Icon source={CheckIcon} />
          </span>
          <Text as="h4" variant="headingMd">
            You're on the list
          </Text>
        </div>
        <Text as="p" tone="subdued">
          Our setup team will email you at <b>{mail}</b>. Build a draft with AI in the meantime and we'll pick up
          from there.
        </Text>
        <div className="gw-path-cta">
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
        <div className="gw-path-cta">
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
        <ul className="gw-ticks">
          <li>We build, style and launch the quiz on your store</li>
          <li>A person tunes which products each answer leads to</li>
          <li>Free, and you can keep editing it after</li>
        </ul>
        <div className="gw-path-cta">
          <Button variant="primary" size="large" fullWidth onClick={() => setFormOpen(true)}>
            Get free expert setup
          </Button>
        </div>
      </>
    );
  }

  return (
    <BlockStack gap="600">
      <div className="gw-head-center">
        <h2 className="gw-h2" tabIndex={-1}>
          How do you want to get started?
        </h2>
        <Text as="p" variant="bodyLg" tone="subdued">
          Either way, you can change everything later.
        </Text>
      </div>
      <div className="gw-paths">
        <section className="gw-path">
          <div className="gw-path-head">
            <span className="gw-ic">
              <Icon source={MagicIcon} />
            </span>
            <Text as="h3" variant="headingLg">
              Build it myself with AI
            </Text>
            <Text as="p" tone="subdued">
              Ready in about 2 minutes.
            </Text>
          </div>
          <ul className="gw-ticks">
            <li>A complete quiz written from your catalog</li>
            <li>Edit every question, answer and match in the Studio</li>
            <li>Publish whenever you're ready</li>
          </ul>
          <div className="gw-path-cta">
            <Button size="large" fullWidth onClick={onBuild} loading={leaving && !requested}>
              Build my quiz
            </Button>
          </div>
        </section>
        <section className="gw-path gw-path--feature">
          <div className="gw-path-band">Free · done for you</div>
          <div className="gw-path-head">
            <span className="gw-ic gw-ic--feature">
              <Icon source={PersonIcon} />
            </span>
            <Text as="h3" variant="headingLg">
              Set it up with an expert
            </Text>
            <Text as="p" tone="subdued">
              Our team does it with you.
            </Text>
          </div>
          {expertBody}
        </section>
      </div>
    </BlockStack>
  );
}

// Admin surfaces and spacing come from Polaris tokens (Built for Shopify
// 4.1.1); the brand purple only accents icons, the selected state and the
// featured card. No looping motion (4.3.3): one fade as a slide enters.
const WELCOME_CSS = `
  .gw { --gw-plum: #4B0A4B; --gw-violet: #6A2393; --gw-tint: #F4EEF6;
    --gw-line: var(--p-color-border-secondary, #e3e3e3); max-width: 1040px; margin: 0 auto; padding: var(--p-space-400, 16px) 0 var(--p-space-1200, 48px); }
  .gw-card { background: var(--p-color-bg-surface, #fff); border-radius: var(--p-border-radius-300, 12px);
    box-shadow: var(--p-shadow-100, 0 1px 0 rgba(26,26,26,.07)), inset 0 -1px 0 rgba(0,0,0,.08), inset 0 0 0 1px rgba(0,0,0,.04);
    padding: var(--p-space-600, 24px) var(--p-space-1000, 40px) var(--p-space-500, 20px); }
  .gw-top { display: flex; align-items: center; justify-content: space-between; min-height: 36px; }
  .gw-brand { display: inline-flex; align-items: center; gap: 10px; }
  .gw-brand-name { font-weight: var(--p-font-weight-semibold, 650); font-size: 15px; color: var(--p-color-text, #303030); }
  .gw-mark { display: inline-flex; align-items: center; justify-content: center; border-radius: 30%;
    background: linear-gradient(145deg, var(--gw-violet), var(--gw-plum)); flex: none; }
  .gw-mark svg { width: 62%; height: 62%; fill: #fff; }
  .gw-stage { min-height: 420px; padding: var(--p-space-600, 24px) 0 var(--p-space-200, 8px); animation: gw-in 220ms ease-out; }
  @keyframes gw-in { from { opacity: 0; } to { opacity: 1; } }
  .gw-h1 { margin: 0; font-size: clamp(28px, 3.4vw, 40px); line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; color: var(--p-color-text, #303030); outline: none; }
  .gw-h2 { margin: 0; font-size: clamp(22px, 2.4vw, 28px); line-height: 1.2; letter-spacing: -0.015em; font-weight: 700; color: var(--p-color-text, #303030); outline: none; }
  .gw-eyebrow { font-size: 12px; font-weight: var(--p-font-weight-semibold, 650); letter-spacing: .06em; text-transform: uppercase; color: var(--gw-violet); }
  .gw-split { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: var(--p-space-1000, 40px); align-items: center; }
  .gw-copy { max-width: 460px; }

  /* Icon tile, shared by how-it-works, goals and paths */
  .gw-ic { width: 36px; height: 36px; border-radius: var(--p-border-radius-200, 8px); display: inline-flex; align-items: center; justify-content: center;
    background: var(--gw-tint); color: var(--gw-violet); flex: none; }
  .gw-ic .Polaris-Icon { width: 20px; height: 20px; margin: 0; }
  .gw-ic svg { fill: currentColor; }
  .gw-ic--feature { background: linear-gradient(145deg, var(--gw-violet), var(--gw-plum)); color: #fff; }

  /* How it works (welcome slide) */
  .gw-how { list-style: none; margin: 4px 0 8px; padding: 0; display: grid; gap: 14px; }
  .gw-how-row { display: flex; gap: 12px; align-items: flex-start; }
  .gw-how-text { display: grid; gap: 2px; padding-top: 1px; }
  .gw-how-t { font-size: 14px; font-weight: var(--p-font-weight-semibold, 650); color: var(--p-color-text, #303030); }
  .gw-how-b { font-size: 13px; line-height: 18px; color: var(--p-color-text-secondary, #616161); }

  /* Illustration: a phone with one quiz question, and the matches card */
  .gw-ill { position: relative; height: 420px; }
  .gw-glow { position: absolute; inset: 4% 0 2% 6%; border-radius: var(--p-border-radius-500, 20px);
    background: linear-gradient(160deg, #F7F1F8 0%, var(--p-color-bg-surface-secondary, #f7f7f7) 100%); }
  .gw-phone { position: absolute; left: 13%; top: 7%; width: 232px; height: 380px; border-radius: 32px; background: #fff;
    box-shadow: 0 0 0 6px #1d1b20, 0 18px 36px rgba(40,10,40,.18); padding: 24px 18px 18px; display: flex; flex-direction: column; gap: 14px; }
  .gw-ph-bar { display: grid; gap: 8px; }
  .gw-ph-step { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #8a7f8c; }
  .gw-ph-prog { display: block; height: 4px; border-radius: 4px; background: #EFE8F1; overflow: hidden; }
  .gw-ph-prog i { display: block; height: 100%; background: var(--gw-violet); border-radius: 4px; }
  .gw-ph-q { margin: 0; font-size: 17px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #1d1b20; }
  .gw-ph-opts { display: grid; gap: 8px; }
  .gw-ph-opt { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 12px; border: 1px solid #ECE6EE; font-size: 12.5px; font-weight: 550; color: #2a2530; }
  .gw-ph-opt i { width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.06); flex: none; }
  .gw-ph-opt.is-on { border-color: var(--gw-violet); box-shadow: 0 0 0 1px var(--gw-violet); background: #FBF7FC; }
  .gw-ph-cta { margin-top: auto; text-align: center; padding: 11px; border-radius: 999px; background: #1d1b20; color: #fff; font-size: 12.5px; font-weight: 600; }
  .gw-match { position: absolute; right: 0; bottom: 5%; width: 204px; background: #fff; border-radius: 16px; padding: 14px;
    box-shadow: 0 14px 32px rgba(40,10,40,.16), 0 0 0 1px rgba(0,0,0,.05); display: grid; gap: 10px; }
  .gw-match-k { font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--gw-violet); }
  .gw-match-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .gw-prod { position: relative; height: 88px; border-radius: 10px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 12px; }
  .gw-prod b { width: 22px; height: 44px; border-radius: 6px 6px 4px 4px; box-shadow: inset -3px 0 0 rgba(0,0,0,.08); }
  .gw-match-add { text-align: center; padding: 8px; border-radius: 999px; background: var(--gw-tint); color: var(--gw-plum); font-size: 12px; font-weight: 650; }

  /* Goals */
  .gw-goals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--p-space-300, 12px); }
  .gw-goal { appearance: none; font: inherit; text-align: left; cursor: pointer; display: flex; gap: 14px; align-items: flex-start;
    padding: var(--p-space-500, 20px); min-height: 112px; border-radius: var(--p-border-radius-300, 12px); background: var(--p-color-bg-surface, #fff); border: 1px solid var(--gw-line);
    transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease; }
  .gw-goal:hover { background: var(--p-color-bg-surface-hover, #f7f7f7); }
  .gw-goal:focus-visible { outline: 2px solid var(--p-color-border-focus, #005bd3); outline-offset: 1px; }
  .gw-goal.is-on { border-color: var(--gw-violet); box-shadow: inset 0 0 0 1px var(--gw-violet); background: #FCFAFD; }
  .gw-goal-text { display: grid; gap: 4px; flex: 1; min-width: 0; padding-top: 1px; }
  .gw-goal-t { font-size: 14px; font-weight: var(--p-font-weight-semibold, 650); color: var(--p-color-text, #303030); }
  .gw-goal-b { font-size: 13px; line-height: 18px; color: var(--p-color-text-secondary, #616161); }
  .gw-goal-check { flex: none; width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid #c9c2cc; display: inline-flex; align-items: center; justify-content: center; margin-top: 2px; }
  .gw-goal.is-on .gw-goal-check { background: var(--gw-violet); border-color: var(--gw-violet); }
  .gw-goal-check .Polaris-Icon { width: 16px; height: 16px; margin: 0; }
  .gw-goal-check svg { fill: #fff; }

  /* Paths */
  .gw-ticks { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .gw-ticks li { position: relative; padding-left: 26px; font-size: 13.5px; line-height: 20px; color: var(--p-color-text, #303030); }
  .gw-ticks li::before { content: ""; position: absolute; left: 0; top: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--gw-tint) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M8.2 13.4 4.9 10.1l1.1-1.1 2.2 2.2 5.8-5.8 1.1 1.1z' fill='%236A2393'/%3E%3C/svg%3E") center/13px no-repeat; }
  .gw-paths { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--p-space-400, 16px); align-items: stretch; max-width: 820px; margin: 0 auto; width: 100%; }
  .gw-path { position: relative; display: flex; flex-direction: column; padding: var(--p-space-600, 24px); border-radius: var(--p-border-radius-300, 12px); border: 1px solid var(--gw-line); background: var(--p-color-bg-surface, #fff); }
  .gw-path { gap: var(--p-space-400, 16px); }
  .gw-path-head { display: grid; gap: var(--p-space-150, 6px); justify-items: start; }
  .gw-path-head .gw-ic { margin-bottom: 4px; }
  .gw-path-cta { margin-top: auto; padding-top: var(--p-space-100, 4px); }
  .gw-done { display: flex; align-items: center; gap: 8px; }
  .gw-head-center { display: grid; gap: var(--p-space-200, 8px); text-align: center; justify-items: center; }
  .gw-path--feature { border-color: var(--gw-violet); box-shadow: inset 0 0 0 1px var(--gw-violet); padding-top: 52px; }
  .gw-path-band { position: absolute; top: 0; left: 0; right: 0; padding: 7px; text-align: center; border-radius: 11px 11px 0 0;
    background: linear-gradient(90deg, var(--gw-plum), var(--gw-violet)); color: #fff; font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
  .gw-ok { width: 24px; height: 24px; border-radius: 50%; background: var(--gw-violet); display: inline-flex; align-items: center; justify-content: center; }
  .gw-ok .Polaris-Icon { width: 16px; height: 16px; margin: 0; }
  .gw-ok svg { fill: #fff; }

  /* Footer: back, dots, continue */
  .gw-foot { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding-top: var(--p-space-400, 16px); margin-top: var(--p-space-300, 12px); border-top: 1px solid var(--gw-line); min-height: 36px; }
  .gw-foot-end { display: flex; justify-content: flex-end; }
  .gw-dots { display: inline-flex; gap: 6px; }
  .gw-dot { width: 8px; height: 8px; border-radius: 99px; background: #ddd7df; transition: width 180ms ease, background 180ms ease; }
  .gw-dot.is-done { background: #b9a6be; }
  .gw-dot.is-on { width: 22px; background: var(--gw-violet); }
  .gw-store { display: flex; align-items: center; justify-content: center; gap: 8px; margin: var(--p-space-400, 16px) 0 0; font-size: 12.5px; color: var(--p-color-text-secondary, #616161); }
  .gw-store-dot { width: 7px; height: 7px; border-radius: 50%; background: #c9a3d4; }
  .gw-store-dot.is-ready { background: var(--p-color-bg-fill-success, #29845a); }

  @media (max-width: 860px) {
    .gw-card { padding: var(--p-space-500, 20px) var(--p-space-400, 16px) var(--p-space-400, 16px); }
    .gw-split { grid-template-columns: 1fr; gap: var(--p-space-600, 24px); }
    .gw-ill { height: 340px; order: -1; }
    .gw-phone { left: 4%; transform: scale(.86); transform-origin: top left; }
    .gw-match { transform: scale(.9); transform-origin: bottom right; }
    .gw-goals, .gw-paths { grid-template-columns: 1fr; }
    .gw-goal { min-height: 0; padding: var(--p-space-400, 16px); }
    .gw-path--feature { order: -1; }
    .gw-stage { min-height: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gw-stage { animation: none; }
    .gw-dot { transition: none; }
  }
`;
