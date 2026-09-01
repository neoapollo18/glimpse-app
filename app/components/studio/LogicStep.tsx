import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { readSseStream } from "../../lib/sse-client";
import {
  framingPrompt,
  photoFramingPrompt,
  GENERAL_FRAMING_PROMPT,
  GENERAL_GUIDANCE_KEY,
} from "../../lib/quiz-guidance-shared";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { StudioFlow } from "./types";

// The Logic step: describe what each answer means in plain words, generate
// the recommendation logic with AI, review it, and save it TO THE DRAFT.
// It goes live when the draft publishes — atomically with the questions the
// logic references. Ported from the standalone logic page; notes still save
// immediately (they're compiler inputs, not runtime config).

const NOTE_MAX_LEN = 4000;

type GenerateEvent =
  | { type: "progress"; phase: string }
  | {
      type: "result";
      guidanceText: string;
      perQuestionSummary: Array<{ axisKey: string; summary: string }>;
      warnings: string[];
    }
  | { type: "error"; error: string }
  | { type: "heartbeat" };

interface ReviewState {
  guidanceText: string;
  perQuestionSummary: Array<{ axisKey: string; summary: string }>;
  warnings: string[];
}

function useLogicModel(data: StudioLoaderData) {
  const flow = (data.draft?.flow ?? { axes: [], questions: [], rules: [] }) as StudioFlow;
  const questions = flow.questions.map((q, i) => ({
    axisKey: q.axisKey,
    prompt: q.prompt,
    position: i + 1,
    framing: framingPrompt({
      prompt: q.prompt,
      multiSelect: q.multiSelect ?? false,
      optionLabels: q.options.map((o) => o.label),
    }),
  }));
  const photoAxes = flow.axes
    .filter((a) => a.source === "photo")
    .map((a) => ({ axisKey: a.key, label: a.label, framing: photoFramingPrompt(a.label) }));
  return { flow, questions, photoAxes };
}

function LogicRail({ data }: { data: StudioLoaderData }) {
  const { questions, photoAxes } = useLogicModel(data);
  const notes = data.notes as Record<string, string>;
  const scrollTo = (id: string) =>
    document.getElementById(`logic-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
      {questions.map((q) => (
        <button key={q.axisKey} className="studio-tree-row" onClick={() => scrollTo(q.axisKey)}>
          <span className="studio-rail-wide" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {q.position}. {q.prompt.trim() || "Untitled question"}
          </span>
          <Badge tone={(notes[q.axisKey] ?? "").trim() ? "success" : "attention"} size="small">
            {(notes[q.axisKey] ?? "").trim() ? "Described" : "Not filled in"}
          </Badge>
        </button>
      ))}
      {photoAxes.map((a) => (
        <button key={a.axisKey} className="studio-tree-row" onClick={() => scrollTo(a.axisKey)}>
          <span className="studio-rail-wide" style={{ flex: 1 }}>{a.label}</span>
          <Badge size="small">Photo</Badge>
        </button>
      ))}
      <button className="studio-tree-row" onClick={() => scrollTo("general")}>
        <span className="studio-rail-wide">Store-wide notes</span>
      </button>
    </div>
  );
}

export function LogicStep({ data, chatBusy }: { data: StudioLoaderData; chatBusy: boolean }) {
  const { questions, photoAxes } = useLogicModel(data);
  const notesFetcher = useFetcher<StudioActionData>();
  const activateFetcher = useFetcher<StudioActionData>();

  const [notes, setNotes] = useState<Record<string, string>>(() => ({
    [GENERAL_GUIDANCE_KEY]: (data.notes as Record<string, string>)[GENERAL_GUIDANCE_KEY] ?? "",
    ...Object.fromEntries(
      [...questions, ...photoAxes].map((q) => [q.axisKey, (data.notes as Record<string, string>)[q.axisKey] ?? ""]),
    ),
  }));
  const notesRef = useRef(notes);
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const [genPhase, setGenPhase] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const draftSettings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const [mode, setMode] = useState<"ai" | "hybrid">(
    (data.draft?.flow.rules.length ?? 0) > 0 ? "hybrid" : "ai",
  );
  const [savedToDraft, setSavedToDraft] = useState(false);
  const generateRunningRef = useRef(false);
  const feedbackRef = useRef<HTMLDivElement | null>(null);

  const setNote = (key: string, value: string) => {
    setNotes((prev) => {
      const next = { ...prev, [key]: value };
      notesRef.current = next;
      return next;
    });
    dirtyKeysRef.current.add(key);
    setNotesDirty(true);
    setNotesSaved(false);
  };

  const saveNotes = () => {
    setNotesSaved(false);
    const fd = new FormData();
    fd.append("intent", "save-notes");
    for (const key of dirtyKeysRef.current) fd.append(`notes:${key}`, notesRef.current[key] ?? "");
    notesFetcher.submit(fd, { method: "POST", action: "/studio" });
  };
  // Leaving the Logic step (unmount) must not drop typed notes: deliver
  // dirty keys fire-and-forget.
  useEffect(
    () => () => {
      const keys = [...dirtyKeysRef.current];
      if (keys.length === 0) return;
      const fd = new FormData();
      fd.append("intent", "save-notes");
      for (const key of keys) fd.append(`notes:${key}`, notesRef.current[key] ?? "");
      fetch("/studio", { method: "POST", body: fd }).catch(() => {});
    },
    [],
  );

  const notesProcessedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (notesFetcher.state !== "idle" || !notesFetcher.data) return;
    if (notesProcessedRef.current === notesFetcher.data) return;
    notesProcessedRef.current = notesFetcher.data;
    if (notesFetcher.data.ok) {
      dirtyKeysRef.current.clear();
      setNotesDirty(false);
      setNotesSaved(true);
    }
  }, [notesFetcher.state, notesFetcher.data]);

  const filledCount = questions.filter((q) => (notes[q.axisKey] ?? "").trim() !== "").length;
  const generateBlocked =
    questions.length === 0 || !data.aiConfigured || data.catalog.productCount === 0;
  const generating = genPhase !== null;

  const runGenerate = async () => {
    if (generateRunningRef.current || generateBlocked) return;
    generateRunningRef.current = true;
    setGenPhase("Starting…");
    setGenError(null);
    setSavedToDraft(false);
    const fd = new FormData();
    fd.append("source", "draft");
    for (const [key, value] of Object.entries(notesRef.current)) fd.append(`notes:${key}`, value);
    let gotTerminal = false;
    try {
      const res = await fetch("/app/api/guidance-generate", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await readSseStream<GenerateEvent>(res, (event) => {
        if (event.type === "progress") setGenPhase(event.phase);
        else if (event.type === "result") {
          gotTerminal = true;
          setReview({
            guidanceText: event.guidanceText,
            perQuestionSummary: event.perQuestionSummary ?? [],
            warnings: event.warnings ?? [],
          });
          dirtyKeysRef.current.clear();
          setNotesDirty(false);
          requestAnimationFrame(() => feedbackRef.current?.scrollIntoView({ behavior: "smooth" }));
        } else if (event.type === "error") {
          gotTerminal = true;
          setGenError(event.error);
        }
      });
      if (!gotTerminal) {
        setGenError("Generation was interrupted. Your notes were saved; hit Generate again.");
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenPhase(null);
      generateRunningRef.current = false;
    }
  };

  const activateProcessedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (activateFetcher.state !== "idle" || !activateFetcher.data) return;
    if (activateProcessedRef.current === activateFetcher.data) return;
    activateProcessedRef.current = activateFetcher.data;
    if (activateFetcher.data.ok) setSavedToDraft(true);
  }, [activateFetcher.state, activateFetcher.data]);

  const currentGuidance = String(draftSettings.ai_guidance ?? "").trim();

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Banner tone="info" title="Describe your logic in plain words. The AI writes the rules.">
          Under each question, tell us what its answers should mean for
          recommendations: which products fit, what to avoid, what matters
          most. Then hit Generate. Nothing goes live until you publish.
        </Banner>

        {currentGuidance !== "" && !review && (
          <Banner tone="success" title="Your draft already has recommendation logic">
            Refine your notes and regenerate any time. Generating replaces the
            draft's logic after you review it.
          </Banner>
        )}

        {questions.map((q) => (
          <div key={q.axisKey} id={`logic-${q.axisKey}`}>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Q{q.position}: {q.prompt.trim() || "Untitled question"}
                  </Text>
                  {(notes[q.axisKey] ?? "").trim() === "" ? (
                    <Badge tone="attention">Not filled in</Badge>
                  ) : (
                    <Badge tone="success">Described</Badge>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {q.framing}
                </Text>
                <TextField
                  label={`Notes for "${q.prompt}"`}
                  labelHidden
                  multiline={4}
                  maxLength={NOTE_MAX_LEN}
                  value={notes[q.axisKey] ?? ""}
                  onChange={(v) => setNote(q.axisKey, v)}
                  placeholder="e.g. Everyday: the breathable line and sheer nudes. Party: glitter, chrome, bold reds."
                  disabled={chatBusy}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </div>
        ))}

        {photoAxes.map((a) => (
          <div key={a.axisKey} id={`logic-${a.axisKey}`}>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    {a.label}
                  </Text>
                  <Badge>From the shopper's photo</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {a.framing}
                </Text>
                <TextField
                  label={`Notes for detected ${a.label}`}
                  labelHidden
                  multiline={3}
                  maxLength={NOTE_MAX_LEN}
                  value={notes[a.axisKey] ?? ""}
                  onChange={(v) => setNote(a.axisKey, v)}
                  placeholder="Optional"
                  disabled={chatBusy}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </div>
        ))}

        <div id="logic-general">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Store-wide notes
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {GENERAL_FRAMING_PROMPT}
              </Text>
              <TextField
                label="Store-wide notes"
                labelHidden
                multiline={4}
                maxLength={NOTE_MAX_LEN}
                value={notes[GENERAL_GUIDANCE_KEY] ?? ""}
                onChange={(v) => setNote(GENERAL_GUIDANCE_KEY, v)}
                placeholder="e.g. Our bestsellers are the Silk Set and Coral Crush. Feature them when they fit."
                disabled={chatBusy}
                autoComplete="off"
              />
            </BlockStack>
          </Card>
        </div>

        {genError && (
          <Banner tone="critical" onDismiss={() => setGenError(null)}>
            {genError}
          </Banner>
        )}
        {notesSaved && !notesDirty && (
          <Banner tone="success" onDismiss={() => setNotesSaved(false)}>
            Notes saved.
          </Banner>
        )}

        <div
          style={{
            position: "sticky",
            bottom: 0,
            background: "#F6F6F7",
            borderTop: "1px solid #E1E3E5",
            padding: "12px 0",
          }}
        >
          <InlineStack gap="300" blockAlign="center">
            <Button variant="primary" onClick={runGenerate} loading={generating} disabled={generateBlocked || chatBusy}>
              Generate my recommendation logic
            </Button>
            <Button onClick={saveNotes} loading={notesFetcher.state !== "idle"} disabled={!notesDirty}>
              Save notes
            </Button>
            <div role="status">
              <Text as="span" variant="bodySm" tone="subdued">
                {genPhase ?? `${filledCount} of ${questions.length} ${questions.length === 1 ? "question" : "questions"} described`}
              </Text>
            </div>
          </InlineStack>
          {generateBlocked && (
            <Text as="p" variant="bodySm" tone="subdued">
              {questions.length === 0
                ? "Add questions on the Build step first."
                : !data.aiConfigured
                  ? "AI generation isn't available for this installation."
                  : "Sync your catalog first (top bar)."}
            </Text>
          )}
        </div>

        <div ref={feedbackRef}>
          {review && (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Review your generated logic
                  </Text>
                  {savedToDraft && <Badge tone="attention">In draft</Badge>}
                </InlineStack>

                {savedToDraft && (
                  <Banner tone="success" title="Logic saved to your draft">
                    It goes live when you publish. Refine your notes and
                    regenerate any time.
                  </Banner>
                )}
                {review.warnings.length > 0 && (
                  <Banner tone="warning" title="Worth a look">
                    <BlockStack gap="100">
                      {review.warnings.map((w, i) => (
                        <Text key={i} as="p" variant="bodySm">
                          {w}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                )}
                {review.perQuestionSummary.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">
                      How each question now steers results
                    </Text>
                    {review.perQuestionSummary.map((s) => (
                      <Text key={s.axisKey} as="p" variant="bodySm">
                        <strong>
                          {questions.find((q) => q.axisKey === s.axisKey)?.prompt ?? s.axisKey}:
                        </strong>{" "}
                        {s.summary}
                      </Text>
                    ))}
                  </BlockStack>
                )}
                <TextField
                  label="Generated logic (editable)"
                  multiline={12}
                  maxHeight={480}
                  value={review.guidanceText}
                  onChange={(v) => {
                    setSavedToDraft(false);
                    setReview((prev) => (prev ? { ...prev, guidanceText: v } : prev));
                  }}
                  autoComplete="off"
                  helpText="Tweak anything before saving. This exact text becomes the instructions your quiz's AI ranker follows."
                />
                <InlineStack gap="300" blockAlign="end">
                  <div style={{ minWidth: 280 }}>
                    <Select
                      label="Ranking mode"
                      options={[
                        { label: "AI: ranks your whole catalog from this logic", value: "ai" },
                        { label: "Rules + AI: advanced rules win when they match", value: "hybrid" },
                      ]}
                      value={mode}
                      onChange={(v) => {
                        setSavedToDraft(false);
                        setMode(v as "ai" | "hybrid");
                      }}
                    />
                  </div>
                  <Button
                    variant="primary"
                    loading={activateFetcher.state !== "idle"}
                    disabled={savedToDraft}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append("intent", "activate-guidance");
                      fd.append("guidanceText", review.guidanceText);
                      fd.append("mode", mode);
                      activateFetcher.submit(fd, { method: "POST", action: "/studio" });
                    }}
                  >
                    Save logic to draft
                  </Button>
                  <Button onClick={runGenerate} disabled={generating}>
                    Regenerate
                  </Button>
                  <Button onClick={() => setReview(null)} disabled={generating}>
                    Discard
                  </Button>
                </InlineStack>
                {activateFetcher.data && !activateFetcher.data.ok && activateFetcher.data.error && (
                  <Banner tone="critical">{activateFetcher.data.error}</Banner>
                )}
              </BlockStack>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

LogicStep.Rail = LogicRail;
