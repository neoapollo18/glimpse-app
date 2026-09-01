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
  | { type: "progress"; phase: string }
  | { type: "result"; summary: { questions: number; rules: number; mode: string }; warnings: string[] }
  | { type: "error"; error: string; warnings?: string[] }
  | { type: "heartbeat" };

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
  onDone: (firstSlide: string) => void;
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

  const [category, setCategory] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [quizLength, setQuizLength] = useState("standard");
  const [modePreference, setModePreference] = useState("auto");
  const [extraNotes, setExtraNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [genPhase, setGenPhase] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const generateRunningRef = useRef(false);

  // Brand colors picked during onboarding are applied to the draft the
  // moment it exists (generated or blank) through the same design-tokens
  // applier the Theme editor uses — so nobody ever has to find a color
  // field on another page.
  const applyBrandColors = () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) return;
    const fd = new FormData();
    fd.append("intent", "apply-tool");
    fd.append("tool", "update_design_tokens");
    fd.append("input", JSON.stringify({ fields: { quiz_accent_color: accentColor } }));
    fetch("/studio", { method: "POST", body: fd }).catch(() => {});
  };

  // "Start from scratch" creates a blank one-question draft; when the
  // loader revalidates with it, the studio unmounts this wizard.
  const blankProcessedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (blankFetcher.state !== "idle" || !blankFetcher.data) return;
    if (blankProcessedRef.current === blankFetcher.data) return;
    blankProcessedRef.current = blankFetcher.data;
    if (blankFetcher.data.ok) {
      applyBrandColors();
      onDone("intro");
    }
  }, [blankFetcher.state, blankFetcher.data, onDone]);

  const generationAvailable = data.aiConfigured && data.catalog.syncEnabled && !skippedCatalog;

  const runGenerate = async () => {
    if (generateRunningRef.current || !category.trim()) return;
    generateRunningRef.current = true;
    setStepIndex(2);
    setGenPhase("Starting…");
    setGenError(null);
    const fd = new FormData();
    fd.append("category", category);
    fd.append("brandVoice", brandVoice);
    fd.append("quizLength", quizLength);
    fd.append("modePreference", modePreference);
    fd.append("extraNotes", extraNotes);
    let gotTerminal = false;
    try {
      const res = await fetch("/app/api/quiz-generate", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await readSseStream<GenerateEvent>(res, (event) => {
        if (event.type === "progress") setGenPhase(event.phase);
        else if (event.type === "result") {
          gotTerminal = true;
          applyBrandColors();
          revalidator.revalidate();
          onDone("intro");
        } else if (event.type === "error") {
          gotTerminal = true;
          setGenError(event.error);
        }
      });
      if (!gotTerminal) {
        setGenError("Generation was interrupted. A draft may still exist; reload to check, or try again.");
        revalidator.revalidate();
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenPhase(null);
      generateRunningRef.current = false;
    }
  };

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
          />
          <TextField
            label="Brand voice"
            placeholder="e.g. playful and bold"
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
              {genPhase ?? "…"}
            </Text>
          </div>
          <ProgressBar progress={genPhase ? 50 : 5} />
          <Text as="p" variant="bodySm" tone="subdued">
            Takes about a minute. It only ever writes to your draft.
          </Text>
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
