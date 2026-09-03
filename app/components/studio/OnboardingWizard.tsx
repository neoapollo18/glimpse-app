import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Collapsible,
  InlineStack,
  ProgressBar,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { readSseStream } from "../../lib/sse-client";
import { useCatalogSync } from "../../lib/use-catalog-sync";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";

// Alia-style onboarding for empty shops: catalog → brief → generating →
// land in Build. Renders as an overlay over the studio regions; the top bar
// stays. Generation reuses the existing /app/api/quiz-generate SSE route
// (which creates the draft itself).

type GenerateEvent =
  | { type: "progress"; phase: string; streamed?: number }
  | { type: "result"; summary: { questions: number; rules: number; mode: string }; warnings: string[] }
  | { type: "error"; error: string; warnings?: string[] }
  | { type: "heartbeat" };

// Rough size of a full generated quiz config (model output chars) — used
// only to map streaming progress onto the bar's drafting band.
const EXPECTED_DRAFT_CHARS = 9000;

const MODE_LABELS: Record<string, string> = {
  matrix: "Rules only",
  ai: "AI",
  hybrid: "Rules + AI",
};

export function OnboardingWizard({
  data,
  onDone,
}: {
  data: StudioLoaderData;
  /** notice: generation warnings worth showing after landing in Build
   * (e.g. "your brief said nail polish but the catalog is hair"). */
  onDone: (firstSlide: string, notice?: string) => void;
}) {
  const revalidator = useRevalidator();
  const blankFetcher = useFetcher<StudioActionData>();
  const needsCatalog = !data.catalog.syncEnabled;
  const [stepIndex, setStepIndex] = useState(needsCatalog ? 0 : 1);
  const [skippedCatalog, setSkippedCatalog] = useState(false);
  const sync = useCatalogSync({
    onComplete: () => {
      revalidator.revalidate();
      setStepIndex(1);
    },
  });

  const [category, setCategory] = useState(data.topProductType ?? "");
  const [brandVoice, setBrandVoice] = useState("");
  const [accentColor, setAccentColor] = useState(data.storeBrand?.accentColor ?? "");
  const prefilled = Boolean(data.topProductType || data.storeBrand?.accentColor);
  const [quizLength, setQuizLength] = useState("standard");
  const [modePreference, setModePreference] = useState("auto");
  const [extraNotes, setExtraNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [genPhase, setGenPhase] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const generateRunningRef = useRef(false);

  // The accent color is applied SERVER-SIDE (quiz-generate and
  // start-blank-draft both accept it): any client-side follow-up apply was
  // lost whenever the SSE stream cut or the revalidation unmounted this
  // wizard before the follow-up ran.

  // ---- Progress feedback ----
  // The drafting call runs for minutes. Three layers keep it honest:
  // 1. a smooth bar easing toward a per-phase cap (never a frozen bar),
  // 2. elapsed time + a "connection quiet" hint off heartbeat recency,
  // 3. WATCH MODE when the stream cuts: the server keeps generating and
  //    saves the draft at the end, so we poll the loader until the draft
  //    appears (which unmounts this wizard) instead of declaring failure.
  const [barPct, setBarPct] = useState(0);
  const [elapsedS, setElapsedS] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [watching, setWatching] = useState(false);
  const phaseRef = useRef<string | null>(null);
  const watchingRef = useRef(false);
  const genStartRef = useRef(0);
  const lastEventAtRef = useRef(0);
  const watchTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (watchTimerRef.current != null) window.clearInterval(watchTimerRef.current);
    },
    [],
  );

  const setPhase = (phase: string | null) => {
    phaseRef.current = phase;
    setGenPhase(phase);
  };
  // Streamed model-output chars for the current call — drives REAL motion
  // through the drafting band instead of parking the bar at a phase cap.
  const streamedRef = useRef(0);
  const capForPhase = (phase: string | null) => {
    if (watchingRef.current) return 97;
    if (!phase) return 0;
    if (phase.startsWith("Starting")) return 8;
    if (phase.startsWith("Reading")) return 16;
    if (phase.startsWith("Drafting")) {
      return 20 + Math.min(66, (streamedRef.current / EXPECTED_DRAFT_CHARS) * 66);
    }
    // The repair pass is a SECOND full model call (minutes): stream through
    // its own band instead of parking at a fixed cap. The bar never moves
    // backwards (easing clamps at the current value), so the band starting
    // below the drafting band's end is safe.
    if (phase.startsWith("Fixing")) {
      return 80 + Math.min(15, (streamedRef.current / EXPECTED_DRAFT_CHARS) * 15);
    }
    if (phase.startsWith("Saving")) return 97;
    return 60;
  };

  useEffect(() => {
    if (stepIndex !== 2) return;
    const id = window.setInterval(() => {
      setBarPct((p) => p + Math.max(0, capForPhase(phaseRef.current) - p) * 0.035);
      setElapsedS(Math.round((Date.now() - genStartRef.current) / 1000));
      setQuiet(
        lastEventAtRef.current > 0 && Date.now() - lastEventAtRef.current > 25_000 && !watchingRef.current,
      );
    }, 250);
    return () => window.clearInterval(id);
  }, [stepIndex]);

  // Watch mode is otherwise blind to server-side failure (a post-cut
  // generation that fails writes no draft): the loader surfaces the
  // recorded outcome; stop the watch on a failure newer than this run.
  useEffect(() => {
    if (!watching) return;
    const status = data.genStatus;
    if (status?.error && status.at >= genStartRef.current) {
      if (watchTimerRef.current != null) window.clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
      watchingRef.current = false;
      setWatching(false);
      setPhase(null);
      setBarPct(0);
      setGenError(status.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, data.genStatus]);

  const startWatching = () => {
    // A retry must never race a stale watcher from the previous attempt.
    if (watchTimerRef.current != null) window.clearInterval(watchTimerRef.current);
    watchingRef.current = true;
    setWatching(true);
    const startedAt = Date.now();
    watchTimerRef.current = window.setInterval(() => {
      // Generous budget: a generation that needs the repair round-trip is
      // TWO full model calls (~3 min each worst case) plus save — the old
      // 4-minute cutoff declared failure while the server was still
      // legitimately working.
      if (Date.now() - startedAt > 10 * 60_000) {
        if (watchTimerRef.current != null) window.clearInterval(watchTimerRef.current);
        watchTimerRef.current = null;
        watchingRef.current = false;
        setWatching(false);
        setPhase(null);
        setBarPct(0);
        setGenError("Generation didn't finish. Try again — your answers are still filled in.");
        return;
      }
      // When the draft lands, the revalidated loader flips needsOnboarding
      // and unmounts this wizard — that IS the success path here.
      revalidator.revalidate();
    }, 5_000);
  };

  const generationAvailable = data.aiConfigured && data.catalog.syncEnabled && !skippedCatalog;

  const runGenerate = async () => {
    if (generateRunningRef.current || !category.trim()) return;
    generateRunningRef.current = true;
    setStepIndex(2);
    setPhase("Starting…");
    setGenError(null);
    setBarPct(2);
    setWatching(false);
    watchingRef.current = false;
    genStartRef.current = Date.now();
    streamedRef.current = 0;
    lastEventAtRef.current = Date.now();
    const fd = new FormData();
    fd.append("category", category);
    fd.append("brandVoice", brandVoice);
    fd.append("quizLength", quizLength);
    fd.append("modePreference", modePreference);
    fd.append("extraNotes", extraNotes);
    if (/^#[0-9a-fA-F]{6}$/.test(accentColor)) fd.append("accentColor", accentColor);
    let gotTerminal = false;
    let streamStarted = false;
    try {
      const res = await fetch("/app/api/quiz-generate", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      streamStarted = true;
      await readSseStream<GenerateEvent>(res, (event) => {
        lastEventAtRef.current = Date.now();
        if (event.type === "progress") {
          if (typeof event.streamed === "number") streamedRef.current = event.streamed;
          setPhase(event.phase);
        } else if (event.type === "result") {
          gotTerminal = true;
          setBarPct(100);
          revalidator.revalidate();
          onDone("intro", (event.warnings ?? []).slice(0, 2).join(" ") || undefined);
        } else if (event.type === "error") {
          gotTerminal = true;
          setGenError(event.error);
          // If the error is "a draft already exists" (e.g. a retry racing a
          // slow first run that eventually saved), the revalidated loader
          // unmounts this wizard into the studio — without this the merchant
          // was stranded behind the overlay with no way forward.
          revalidator.revalidate();
        }
      });
      if (!gotTerminal) {
        // The connection died mid-stream, but the server keeps going and
        // saves the draft at the end — watch for it instead of failing.
        startWatching();
      }
    } catch (err) {
      if (streamStarted && !gotTerminal) {
        // Stream died mid-flight: the server keeps going — watch for the
        // draft. A read error AFTER a terminal event is already handled;
        // spinning up a watcher then could time out a healthy retry later.
        startWatching();
      } else if (!gotTerminal) {
        setGenError(err instanceof Error ? err.message : "Generation failed");
      }
    } finally {
      if (!watchingRef.current) setPhase(null);
      generateRunningRef.current = false;
    }
  };

  const formatElapsed = (s: number) =>
    s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;

  const dots = (
    <InlineStack gap="150" align="center">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: i === stepIndex ? 24 : 8,
            height: 8,
            borderRadius: 999,
            background: i <= stepIndex ? "#1a1a1a" : "#E1E3E5",
            transition: "width 160ms ease",
          }}
        />
      ))}
    </InlineStack>
  );

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "56px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      {dots}

      {stepIndex === 0 && (
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            First, connect your products
          </Text>
          <Text as="p" tone="subdued">
            Gleame builds your quiz from your real products. Existing product
            configuration is never overwritten.
          </Text>
          {sync.progress ? (
            <BlockStack gap="200">
              <ProgressBar
                progress={sync.progress.total ? Math.round((sync.progress.done / sync.progress.total) * 100) : 10}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                Synced {sync.progress.done}
                {sync.progress.total ? ` of ${sync.progress.total}` : ""} products…
              </Text>
            </BlockStack>
          ) : (
            <InlineStack gap="300">
              <Button variant="primary" loading={sync.busy} onClick={() => sync.start(data.catalog.cursor ?? undefined)}>
                Sync catalog
              </Button>
              <Button
                variant="plain"
                onClick={() => {
                  setSkippedCatalog(true);
                  setStepIndex(1);
                }}
              >
                Skip for now
              </Button>
            </InlineStack>
          )}
          {sync.syncError && <Banner tone="critical">{sync.syncError}</Banner>}
        </BlockStack>
      )}

      {stepIndex === 1 && (
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            Tell Gleame about your store
          </Text>
          {prefilled && (
            <Text as="p" variant="bodySm" tone="subdued">
              We prefilled what we could from your store. Edit anything.
            </Text>
          )}
          {!generationAvailable && (
            <Banner tone="info">
              {!data.aiConfigured
                ? "AI generation isn't available for this installation, but you can build your quiz by hand."
                : "AI generation needs a synced catalog. You can still start from scratch."}
            </Banner>
          )}
          <TextField
            label="What do you sell?"
            placeholder="e.g. nail polish, hair extensions"
            value={category}
            onChange={setCategory}
            autoComplete="off"
            helpText={
              generationAvailable && data.catalog.productCount
                ? `Your quiz is built from your synced catalog (${data.catalog.productCount} products) — it only ever recommends products you actually sell.`
                : undefined
            }
          />
          <TextField
            label="Brand voice"
            placeholder={data.storeBrand?.slogan ? `e.g. ${data.storeBrand.slogan}` : "e.g. playful and bold"}
            value={brandVoice}
            onChange={setBrandVoice}
            autoComplete="off"
          />
          <TextField
            label="Brand accent color"
            value={accentColor}
            onChange={setAccentColor}
            placeholder="Blank = elegant default"
            helpText="Buttons and highlights across the quiz. You can refine every color later in the Theme panel."
            autoComplete="off"
            connectedLeft={
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#1a1a1a"}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{
                  width: 34,
                  height: 34,
                  padding: 2,
                  border: "1px solid #c9cccf",
                  borderRadius: "8px 0 0 8px",
                  cursor: "pointer",
                  background: "#fff",
                }}
              />
            }
          />
          <Select
            label="Quiz length"
            options={[
              { label: "Standard (5-7 questions)", value: "standard" },
              { label: "Short (3-4 questions)", value: "short" },
            ]}
            value={quizLength}
            onChange={setQuizLength}
          />
          <TextField
            label="Anything else Gleame should know? (optional)"
            placeholder="Bestsellers, collections to feature, things to avoid…"
            value={extraNotes}
            onChange={setExtraNotes}
            multiline={2}
            autoComplete="off"
          />
          <Button variant="plain" onClick={() => setAdvancedOpen((v) => !v)} disclosure={advancedOpen ? "up" : "down"}>
            Advanced
          </Button>
          <Collapsible id="wizard-advanced" open={advancedOpen}>
            <Select
              label="Matching style"
              options={[
                { label: "Let Gleame decide", value: "auto" },
                { label: "Exact rules", value: "matrix" },
                { label: "AI ranking", value: "ai" },
                { label: "Rules + AI", value: "hybrid" },
              ]}
              value={modePreference}
              onChange={setModePreference}
              helpText="How answers map to products. Let Gleame decide is right for most stores."
            />
          </Collapsible>
          <InlineStack gap="300">
            <Button
              variant="primary"
              disabled={!generationAvailable || !category.trim()}
              onClick={runGenerate}
            >
              Generate my quiz
            </Button>
            <Button
              variant="plain"
              loading={blankFetcher.state !== "idle"}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", "start-blank-draft");
                if (accentColor) fd.append("accentColor", accentColor);
                blankFetcher.submit(fd, { method: "POST", action: "/studio" });
              }}
            >
              Start from scratch
            </Button>
          </InlineStack>
          {generationAvailable && !category.trim() && (
            <Text as="p" variant="bodySm" tone="subdued">
              Tell Gleame what you sell to enable generation.
            </Text>
          )}
        </BlockStack>
      )}

      {stepIndex === 2 && (
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            Drafting your quiz
          </Text>
          <div role="status">
            <Text as="p" variant="bodyLg">
              {watching
                ? "Still working — the connection dropped, but generation continues on our server. This closes by itself when your quiz is ready."
                : genPhase ?? (genError ? "Stopped." : "…")}
            </Text>
          </div>
          <ProgressBar progress={Math.min(99, Math.round(barPct))} />
          {!genError && (
            <Text as="p" variant="bodySm" tone="subdued">
              Working for {formatElapsed(elapsedS)}
              {quiet ? " — the connection has gone quiet, still trying" : ""}.
              Usually one to three minutes; occasionally longer while Gleame
              double-checks details. It only ever writes to your draft.
            </Text>
          )}
          {genError && (
            <BlockStack gap="200">
              <Banner tone="critical">{genError}</Banner>
              <InlineStack gap="300">
                <Button onClick={runGenerate}>Try again</Button>
                <Button
                  variant="plain"
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "start-blank-draft");
                    if (accentColor) fd.append("accentColor", accentColor);
                    blankFetcher.submit(fd, { method: "POST", action: "/studio" });
                  }}
                >
                  Start from scratch
                </Button>
              </InlineStack>
            </BlockStack>
          )}
        </BlockStack>
      )}
    </div>
  );
}
