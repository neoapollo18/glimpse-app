// Onboarding screen 2 of 3 — Building (V3-SPEC Part 6.1–6.3, contract §10).
//
// Five REAL, sequential steps. The list advances ONLY on the generator's
// SSE `step` events, each carrying the real number for that step (catalog
// · theme · questions · paths · images). No fake progress bars: the only
// motion is the elapsed counter and, while the model is drafting, the
// real streamed character count. Two client budgets: 45 s of SILENCE
// (no SSE frame, heartbeats included) and a 10-minute hard cap → the
// failure state: `We couldn't build your quiz` + the completed steps
// ticked + the failed step marked, `Try again` (waits for a run that is
// still going rather than starting a second one; catalog + profile are
// cached, so steps 1–2 complete instantly), `Get help` (Intercom,
// prefilled). Success → the Studio's existing arrival mechanism
// (/app?open=studio).
//
// Generation itself keeps every guard: it refuses to overwrite a quiz with
// real content and never turns the storefront surface on.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { BlockStack, Button, Card, InlineStack, Page, Spinner, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopExists, supabase } from "../lib/supabase.server";
import { shopHasRealQuiz } from "../lib/quiz-draft.server";
import { EVERYTHING_CHIP, GEN_WARNINGS_KEY, readScopeHandoff } from "../lib/onboarding-scope";

/** `/app?open=studio` with the embedded-admin params (host/shop/embedded)
 * carried over, so App Bridge doesn't re-bootstrap the frame. */
function studioUrl(request: Request): string {
  const params = new URL(request.url).searchParams;
  params.delete("retry");
  params.set("open", "studio");
  return `/app?${params.toString()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // A first-ever document load (deep link straight here) can arrive before
  // app.tsx's loader has created the shops row.
  await ensureShopExists(session.shop);
  const shop = await supabase.from("shops").select("id").eq("shop_domain", session.shop).single();
  if (shop.error || !shop.data) throw new Response("Shop not found", { status: 404 });
  // A quiz with real content already exists (including one a previous run
  // finished after the client gave up): generation would refuse anyway -
  // go straight to it.
  if (await shopHasRealQuiz(shop.data.id).catch(() => false)) return redirect(studioUrl(request));
  return json({ shopDomain: session.shop });
};

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

// "save" has no server step event: it is active from the moment "images"
// completes until the result arrives, so a failed save is reported as
// saving, not pinned on the (finished) images step.
type StepKey = "catalog" | "theme" | "questions" | "paths" | "images" | "save";
const STEP_ORDER: StepKey[] = ["catalog", "theme", "questions", "paths", "images", "save"];
const STEP_LABELS: Record<StepKey, string> = {
  catalog: "Reading your catalog",
  theme: "Matching your theme",
  questions: "Writing questions",
  paths: "Checking every product has a path",
  images: "Placing your images",
  save: "Saving your quiz",
};
// Lower-case, past-progressive form for "It stopped while {step}."
const STEP_WHILE: Record<StepKey, string> = {
  catalog: "reading your catalog",
  theme: "matching your theme",
  questions: "writing questions",
  paths: "checking every product has a path",
  images: "placing your images",
  save: "saving your quiz",
};

type StepState = "todo" | "now" | "done" | "failed";
interface StepRow {
  key: StepKey;
  state: StepState;
  detail: string;
}

// `step` null = the run never started streaming (the POST itself was
// refused: session, billing, rate limit, AI not configured…), so no step
// is to blame and the list stays untouched.
interface Failure {
  step: StepKey | null;
  reason: string;
}

// Abort after this much SILENCE (no SSE frame of any kind; the server
// heartbeats every few seconds while it works)…
const INACTIVITY_MS = 45_000;
// …and regardless of traffic after this long.
const HARD_CAP_MS = 10 * 60_000;
// While another run is still going (server 409 `running`, or status says
// so), poll until it ends, up to the hard cap. Never two paid runs.
const WAIT_POLL_MS = 5_000;

const freshSteps = (): StepRow[] => STEP_ORDER.map((key) => ({ key, state: "todo", detail: "" }));

function post(url: string, fields: Record<string, string>): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fetch(url, { method: "POST", body: fd }).then((r) => r.json());
}

function fireEvent(event: string, properties: Record<string, unknown> = {}) {
  void post("/app/api/overhaul-event", { event, properties: JSON.stringify(properties) }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmtChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function fmtWait(seconds: number): string {
  if (seconds > 7200) return `${Math.ceil(seconds / 3600)} hours`;
  if (seconds > 90) return `${Math.ceil(seconds / 60)} minutes`;
  return `${Math.max(1, Math.ceil(seconds))} seconds`;
}

interface GenStatus {
  questions: number;
  running: boolean;
  error: string | null;
}

async function fetchStatus(): Promise<GenStatus | null> {
  try {
    const r = await fetch("/app/api/quiz-generate?intent=status", { signal: AbortSignal.timeout(15_000) }).then((x) => x.json());
    if (!r?.ok) return null;
    return { questions: Number(r.questions) || 0, running: Boolean(r.running), error: r.error ?? null };
  } catch {
    return null;
  }
}

export default function OnboardingBuild() {
  const { shopDomain } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [steps, setSteps] = useState<StepRow[]>(freshSteps);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Real streamed character count from the generator's `progress` events
  // (drafting phase only); 0 = not drafting.
  const [streamed, setStreamed] = useState(0);
  // Set while this screen is waiting for a run it did NOT start to finish.
  const [waiting, setWaiting] = useState(false);
  // Run token: a superseded run (unmount, StrictMode re-mount, retry) must
  // neither paint its outcome nor report a failure.
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const openStudio = useCallback(() => {
    fireEvent("studio_opened", { source: "onboarding_build" });
    navigate("/app?open=studio");
  }, [navigate]);

  /** Poll status while a run is going (≤ hard cap). Resolves with the last
   * status seen (null when the status endpoint itself failed). */
  const waitWhileRunning = useCallback(async (myRun: number, initial?: GenStatus | null): Promise<GenStatus | null> => {
    let st = initial === undefined ? await fetchStatus() : initial;
    const started = Date.now();
    if (st?.running) setWaiting(true);
    while (st?.running && runId.current === myRun && Date.now() - started < HARD_CAP_MS) {
      await sleep(WAIT_POLL_MS);
      st = await fetchStatus();
    }
    if (runId.current === myRun) setWaiting(false);
    return st;
  }, []);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const myRun = ++runId.current;
    const live = () => runId.current === myRun;
    const patch = (key: StepKey, p: Partial<StepRow>) => {
      if (!live()) return;
      setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s)));
    };
    setFailure(null);
    setSteps(freshSteps());
    setElapsed(0);
    setStreamed(0);
    setWaiting(false);

    const handoff = readScopeHandoff();
    const chip = handoff?.chip ?? EVERYTHING_CHIP;
    let active: StepKey = "catalog";
    patch("catalog", { state: "now" });

    const controller = new AbortController();
    abortRef.current = controller;
    let abortReason: string | null = null;
    const hardCap = setTimeout(() => {
      abortReason = "it ran for more than 10 minutes";
      controller.abort();
    }, HARD_CAP_MS);
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const armQuiet = () => {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => {
        abortReason = "the connection went quiet";
        controller.abort();
      }, INACTIVITY_MS);
    };
    const clearTimers = () => {
      clearTimeout(hardCap);
      if (quiet) clearTimeout(quiet);
    };

    const fail = (step: StepKey | null, reason: string) => {
      if (!live()) return;
      if (step) patch(step, { state: "failed", detail: reason });
      else setSteps(freshSteps());
      setFailure({ step, reason });
      fireEvent("generation_failed", { step: step ?? "request", reason: reason.slice(0, 300), source: "onboarding_build" });
    };

    try {
      const fd = new FormData();
      fd.append("quizLength", "standard");
      fd.append("modePreference", "auto");
      fd.append("scopeKind", chip.kind);
      fd.append("scopeLabel", chip.label);
      fd.append("scopeProductIds", JSON.stringify(chip.productIds));
      fd.append("collectionCount", String(handoff?.collectionCount ?? 0));
      if (handoff?.accentColor) fd.append("accentColor", handoff.accentColor);

      armQuiet();
      const res = await fetch("/app/api/quiz-generate", { method: "POST", body: fd, signal: controller.signal });
      if (!res.ok || !res.body) {
        // The run never started; nothing streamed, so no step is to blame.
        clearTimers();
        const body = await res.json().catch(() => null);
        if (!live()) return;
        const message: string = body?.error ?? `Generation failed (${res.status})`;
        if (res.status === 409 && body?.running) {
          // Another run (an earlier click, another tab, a run the server
          // kept finishing after a client gave up) is going: wait for it.
          const st = await waitWhileRunning(myRun, { questions: 0, running: true, error: null });
          if (!live()) return;
          if (st && st.questions > 0) {
            openStudio();
            return;
          }
          if (st?.running) {
            fail(null, "a build has been running for more than 10 minutes");
            return;
          }
          fail(null, st?.error ? `the last build stopped: ${st.error}` : "the last build finished without saving a quiz");
          return;
        }
        if (res.status === 409 && /already has a quiz/i.test(message)) {
          // A quiz landed after all: the Studio is the right place.
          openStudio();
          return;
        }
        if (res.status === 429) {
          const secs = Number(body?.retryAfterSeconds);
          fail(null, Number.isFinite(secs) && secs > 0 ? `build limit reached. Try again in ${fmtWait(secs)}` : message);
          return;
        }
        fail(null, message);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      let genError: string | null = null;
      let warnings: unknown = null;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        // Any bytes at all (a step, progress, or a bare heartbeat) prove the
        // server is alive: reset the silence budget.
        armQuiet();
        buf += decoder.decode(chunk.value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const raw of events) {
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: any;
          try {
            evt = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (evt.type === "step" && STEP_ORDER.includes(evt.key)) {
            const key = evt.key as StepKey;
            patch(key, { state: "done", detail: String(evt.detail ?? "") });
            if (live()) setStreamed(0);
            const next = STEP_ORDER[STEP_ORDER.indexOf(key) + 1];
            if (next) {
              active = next;
              patch(next, { state: "now" });
            }
          } else if (evt.type === "progress") {
            const n = Number(evt.streamed);
            if (live() && Number.isFinite(n) && n > 0) setStreamed(n);
          } else if (evt.type === "result") {
            warnings = evt.warnings ?? null;
            done = true;
          } else if (evt.type === "error") {
            genError = String(evt.error ?? "Generation failed");
            warnings = evt.warnings ?? null;
            done = true;
          }
        }
      }
      clearTimers();
      if (!live()) return;
      if (genError) {
        // A quiz landed after all (e.g. an earlier run finished server-side
        // after this client gave up): the Studio is the right place.
        if (/already has a quiz/i.test(genError)) {
          openStudio();
          return;
        }
        throw new Error(genError);
      }
      if (!done) throw new Error("The connection closed before the quiz was saved");

      // Non-fatal generator warnings ride along to the Studio (it reads them
      // from here; this screen shows nothing extra).
      try {
        if (Array.isArray(warnings) && warnings.length) sessionStorage.setItem(GEN_WARNINGS_KEY, JSON.stringify(warnings));
        else sessionStorage.removeItem(GEN_WARNINGS_KEY);
      } catch {
        /* storage unavailable: nothing to carry */
      }
      openStudio();
    } catch (e) {
      clearTimers();
      // Superseded (unmounted or restarted): stay silent.
      if (!live()) return;
      const reason = abortReason
        ? abortReason
        : (e as Error).name === "AbortError"
          ? "the connection was interrupted"
          : (e as Error).message || "something went wrong";
      fail(active, reason);
    } finally {
      if (live()) abortRef.current = null;
    }
  }, [openStudio, waitWhileRunning]);

  // "Try again" (spec 6.3): the server deliberately finishes a paid run
  // after the client aborts, so first ask whether a quiz landed or a run is
  // still alive - and wait for it (≤ hard cap) - and only then start a
  // fresh run. Never two paid generations for one merchant click.
  const retry = useCallback(async () => {
    const myRun = ++runId.current;
    abortRef.current?.abort();
    setFailure(null);
    setElapsed(0);
    setStreamed(0);
    setSteps(() => {
      const rows = freshSteps();
      rows[0] = { ...rows[0], state: "now", detail: "Checking on your last build…" };
      return rows;
    });
    const st = await waitWhileRunning(myRun);
    if (runId.current !== myRun) return;
    if (st && st.questions > 0) {
      openStudio();
      return;
    }
    if (st?.running) {
      // Still going after the whole cap: don't pile a second run on top.
      setSteps(freshSteps());
      setFailure({ step: null, reason: "a build has been running for more than 10 minutes" });
      return;
    }
    void run();
  }, [openStudio, run, waitWhileRunning]);

  // Mount (and ?retry=1) run immediately; unmount invalidates + aborts the
  // in-flight run so it can't report a failure for a screen that is gone.
  // The abort is deferred one tick so React 18 StrictMode's synchronous
  // mount → cleanup → mount in dev neither aborts the only run nor
  // dispatches a second POST (`startedFor` survives the simulated remount).
  const startedFor = useRef<string | null>(null);
  const pendingAbort = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryParam = params.get("retry") ?? "";
  useEffect(() => {
    const ids = runId;
    const aborts = abortRef;
    const pending = pendingAbort;
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    if (startedFor.current !== retryParam) {
      startedFor.current = retryParam;
      void run();
    }
    return () => {
      pending.current = setTimeout(() => {
        pending.current = null;
        ids.current++;
        aborts.current?.abort();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryParam]);

  // Honest motion: a real elapsed counter next to the active step.
  useEffect(() => {
    if (failure) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [failure]);

  // Skip auto-generate after a failed build: seed a one-question starter
  // and open the Studio (app.api.quiz-start-manual; a quiz that landed
  // meanwhile is kept, never overwritten).
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const startManual = async () => {
    setManualBusy(true);
    setManualError(null);
    try {
      const d = await post("/app/api/quiz-start-manual", {});
      if (!d?.ok) throw new Error(d?.error || "Couldn't start your quiz");
      openStudio();
    } catch (e) {
      setManualError((e as Error).message);
      setManualBusy(false);
    }
  };

  const getHelp = () => {
    const where = failure?.step ? `stopped while ${STEP_WHILE[failure.step]}` : failure ? "couldn't start" : "stopped";
    const text = `Hi — my quiz build on ${shopDomain} ${where}${failure ? ` (${failure.reason})` : ""}. Can you take a look?`;
    import("@intercom/messenger-js-sdk")
      .then((m) => m.showNewMessage(text))
      .catch(() => {
        const w = window as unknown as { Intercom?: (cmd: string, arg?: string) => void };
        if (typeof w.Intercom === "function") w.Intercom("showNewMessage", text);
        else window.open(`mailto:support@gleame.ai?subject=${encodeURIComponent("Quiz build failed")}&body=${encodeURIComponent(text)}`);
      });
  };

  const visible = failure?.step ? steps.slice(0, STEP_ORDER.indexOf(failure.step) + 1) : steps;

  const activeDetail = (s: StepRow): string => {
    if (s.state === "done" || s.state === "failed") return s.detail;
    if (s.state !== "now") return "";
    if (s.detail) return s.detail;
    const parts: string[] = [];
    if (elapsed >= 3) parts.push(`${elapsed}s`);
    if (streamed > 0) parts.push(`writing… ${fmtChars(streamed)} characters`);
    return parts.join(" · ");
  };

  return (
    <Page narrowWidth>
      <style>{BUILD_CSS}</style>
      <div className="gq-ob">
        <Card padding="600">
          <BlockStack gap="600">
            <BlockStack gap="200">
              <Text as="h1" variant="headingXl">
                {failure ? (failure.step ? "We couldn't build your quiz" : "We couldn't start your quiz") : waiting ? "Finishing an earlier build" : "Building your quiz"}
              </Text>
              <Text as="p" tone="subdued">
                {failure ? (
                  failure.step ? (
                    <>
                      It stopped while <strong>{STEP_WHILE[failure.step]}</strong>. Your catalog and theme are saved,
                      so trying again picks up from there.
                    </>
                  ) : (
                    <>
                      The build didn't start: <strong>{failure.reason}</strong>.
                    </>
                  )
                ) : waiting ? (
                  "A build for this store is still running. We're waiting for it instead of starting another."
                ) : (
                  "Each step finishes with a real number."
                )}
              </Text>
            </BlockStack>

            <ol className={`gq-ob-steps${failure ? " is-failed" : ""}`}>
              {visible.map((s) => (
                <li key={s.key} className={`gq-ob-step is-${s.state}`}>
                  <span className="gq-ob-st" aria-hidden>
                    {s.state === "done" && <CheckGlyph />}
                    {s.state === "now" && <Spinner size="small" accessibilityLabel="" />}
                    {s.state === "failed" && "!"}
                  </span>
                  <span className="gq-ob-label">{STEP_LABELS[s.key]}</span>
                  <span className="gq-ob-detail">{activeDetail(s)}</span>
                </li>
              ))}
            </ol>

            {failure ? (
              <BlockStack gap="200">
                <InlineStack gap="300">
                  <Button variant="primary" onClick={() => void retry()}>
                    Try again
                  </Button>
                  <Button onClick={() => void startManual()} loading={manualBusy}>
                    Set it up myself
                  </Button>
                  <Button variant="plain" onClick={getHelp}>
                    Get help
                  </Button>
                </InlineStack>
                {manualError && (
                  <Text as="p" tone="critical" variant="bodySm">
                    {manualError}
                  </Text>
                )}
              </BlockStack>
            ) : waiting ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Checking every few seconds{elapsed >= 3 ? ` · ${elapsed}s` : ""}. Nothing goes live until you turn it on.
              </Text>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                About a minute. Nothing goes live until you turn it on.
              </Text>
            )}
          </BlockStack>
        </Card>
      </div>
    </Page>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.5l2.3 2.3L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const BUILD_CSS = `
  .gq-ob { padding-top: 48px; padding-bottom: 48px; }
  .gq-ob-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .gq-ob-step { display: grid; grid-template-columns: 26px 1fr auto; align-items: center; column-gap: 12px; padding: 13px 0; border-top: 1px solid var(--p-color-border-secondary, #e3e3e3); font-size: 14px; color: var(--p-color-text, #303030); transition: color 220ms ease; }
  .gq-ob-step:last-child { border-bottom: 1px solid var(--p-color-border-secondary, #e3e3e3); }
  .gq-ob-step.is-todo { color: var(--p-color-text-secondary, #8a8a8a); }
  .gq-ob-step.is-now .gq-ob-label { font-weight: 600; }
  .gq-ob-st { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid var(--p-color-border, #c9c9c9); font-size: 12px; font-weight: 700; color: var(--p-color-text-secondary, #8a8a8a); }
  .gq-ob-step.is-done .gq-ob-st { border-color: var(--p-color-bg-fill-success, #29845a); background: var(--p-color-bg-fill-success, #29845a); color: #fff; }
  .gq-ob-step.is-now .gq-ob-st { border-color: transparent; }
  .gq-ob-step.is-failed { color: var(--p-color-text-critical, #b3261e); }
  .gq-ob-step.is-failed .gq-ob-st { border-color: var(--p-color-text-critical, #b3261e); color: var(--p-color-text-critical, #b3261e); }
  .gq-ob-detail { font-size: 13px; color: var(--p-color-text-secondary, #616161); font-variant-numeric: tabular-nums; animation: gq-ob-in 220ms ease; }
  .gq-ob-step.is-failed .gq-ob-detail { color: var(--p-color-text-critical, #b3261e); }
  @keyframes gq-ob-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .gq-ob-detail { animation: none; } }
`;
