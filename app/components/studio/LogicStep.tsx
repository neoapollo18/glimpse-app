import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  Icon,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronRightIcon, MagicIcon } from "@shopify/polaris-icons";
import { readSseStream } from "../../lib/sse-client";
import {
  photoFramingPrompt,
  GENERAL_FRAMING_PROMPT,
  GENERAL_GUIDANCE_KEY,
} from "../../lib/quiz-guidance-shared";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { StudioFlow } from "./types";

// The Logic step: one collapsible card per question with a row per answer
// ("Party → glitter, chrome, bold reds"), an AI draft button that pre-fills
// the rows from the catalog, then generate → review → save TO THE DRAFT.
// Notes still save immediately (they're compiler inputs, not runtime config);
// the compiled logic goes live when the draft publishes.
//
// Storage stays one text blob per question: answer rows serialize to
// "Label: text" lines plus a free-text remainder, so the guidance compiler
// and pre-existing notes are untouched (legacy prose just lands in the
// "Anything else" box).

const NOTE_MAX_LEN = 4000;
const ROW_MAX_LEN = 300;
const EXPAND_EVENT = "gleame-logic-open";

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
    multiSelect: q.multiSelect ?? false,
    optionLabels: q.options.map((o) => o.label),
  }));
  const photoAxes = flow.axes
    .filter((a) => a.source === "photo")
    .map((a) => ({ axisKey: a.key, label: a.label, framing: photoFramingPrompt(a.label) }));
  return { flow, questions, photoAxes };
}

// ---- Per-answer row serialization ------------------------------------------

/** Split a note blob into per-answer texts (lines starting "Label:") plus the
 * free-text remainder. Longest labels match first so a label that prefixes
 * another can't steal its lines. */
function parseNote(note: string, labels: string[]) {
  const answers: Record<string, string> = {};
  const extra: string[] = [];
  const byLength = [...labels].sort((a, b) => b.length - a.length);
  for (const raw of note.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const hit = byLength.find((l) => line.toLowerCase().startsWith(l.trim().toLowerCase() + ":"));
    if (hit) {
      const text = line.slice(line.indexOf(":") + 1).trim();
      answers[hit] = answers[hit] ? `${answers[hit]} ${text}` : text;
    } else {
      extra.push(line);
    }
  }
  return { answers, extra: extra.join("\n") };
}

function composeNote(labels: string[], answers: Record<string, string>, extra: string) {
  const lines = labels
    .filter((l) => (answers[l] ?? "").trim() !== "")
    .map((l) => `${l.trim()}: ${answers[l].trim()}`);
  if (extra.trim()) lines.push(extra.trim());
  return lines.join("\n").slice(0, NOTE_MAX_LEN);
}

// ---- Rail ------------------------------------------------------------------

function LogicRail({ data }: { data: StudioLoaderData }) {
  const { questions, photoAxes } = useLogicModel(data);
  const notes = data.notes as Record<string, string>;
  const open = (id: string) => window.dispatchEvent(new CustomEvent(EXPAND_EVENT, { detail: id }));

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
      {questions.map((q) => (
        <button key={q.axisKey} className="studio-tree-row" onClick={() => open(q.axisKey)}>
          <span className="studio-rail-wide" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {q.position}. {q.prompt.trim() || "Untitled question"}
          </span>
          <Badge tone={(notes[q.axisKey] ?? "").trim() ? "success" : "attention"} size="small">
            {(notes[q.axisKey] ?? "").trim() ? "Described" : "Not filled in"}
          </Badge>
        </button>
      ))}
      {photoAxes.map((a) => (
        <button key={a.axisKey} className="studio-tree-row" onClick={() => open(a.axisKey)}>
          <span className="studio-rail-wide" style={{ flex: 1 }}>{a.label}</span>
          <Badge size="small">Photo</Badge>
        </button>
      ))}
      <button className="studio-tree-row" onClick={() => open("general")}>
        <span className="studio-rail-wide">Store-wide notes</span>
      </button>
    </div>
  );
}

// ---- Collapsible card shell ------------------------------------------------

function LogicCard({
  id,
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: React.ReactNode;
  badge: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div id={`logic-${id}`}>
      <Card padding="0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "14px 16px",
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ width: 16, height: 16, display: "inline-flex", flexShrink: 0 }}>
            <Icon source={expanded ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <Text as="span" variant="headingSm">{title}</Text>
          </span>
          {badge}
        </button>
        <Collapsible open={expanded} id={`logic-body-${id}`} transition={{ duration: "150ms", timingFunction: "ease-in-out" }}>
          <div style={{ padding: "0 16px 16px 40px" }}>{children}</div>
        </Collapsible>
      </Card>
    </div>
  );
}

// ---- Main step -------------------------------------------------------------

export function LogicStep({ data, chatBusy }: { data: StudioLoaderData; chatBusy: boolean }) {
  const { questions, photoAxes } = useLogicModel(data);
  const notesFetcher = useFetcher<StudioActionData>();
  const activateFetcher = useFetcher<StudioActionData>();
  const draftFetcher = useFetcher<StudioActionData>();

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

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Rail clicks: expand the card, then scroll to it once it has height.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setExpanded((prev) => new Set(prev).add(id));
      requestAnimationFrame(() =>
        document.getElementById(`logic-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    };
    window.addEventListener(EXPAND_EVENT, onOpen);
    return () => window.removeEventListener(EXPAND_EVENT, onOpen);
  }, []);

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

  // ---- AI note drafting ----
  const [draftedBanner, setDraftedBanner] = useState<string | null>(null);
  const requestDraft = (axisKeys?: string[]) => {
    if (draftFetcher.state !== "idle") return;
    setDraftedBanner(null);
    const fd = new FormData();
    fd.append("intent", "draft-notes");
    if (axisKeys) fd.append("axisKeys", JSON.stringify(axisKeys));
    draftFetcher.submit(fd, { method: "POST", action: "/studio" });
  };
  // Which draft request is in flight: "all" or a single axisKey.
  const draftingKeys = draftFetcher.state !== "idle"
    ? (draftFetcher.formData?.get("axisKeys") as string | null)
    : undefined; // undefined = not drafting; null = drafting all

  const draftProcessedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (draftFetcher.state !== "idle" || !draftFetcher.data) return;
    if (draftProcessedRef.current === draftFetcher.data) return;
    draftProcessedRef.current = draftFetcher.data;
    const result = draftFetcher.data;
    if (!result.ok || !result.notesDraft) return;
    // Merge non-destructively: only empty rows get the drafted text; typed
    // rows and existing free text always win.
    let touched = 0;
    let firstTouched: string | null = null;
    for (const dq of result.notesDraft.questions) {
      const q = questions.find((x) => x.axisKey === dq.axisKey);
      if (!q) continue;
      const cur = parseNote(notesRef.current[q.axisKey] ?? "", q.optionLabels);
      let changed = false;
      for (const ans of dq.answers) {
        const label = q.optionLabels.find(
          (l) => l.trim().toLowerCase() === ans.label.trim().toLowerCase(),
        );
        if (!label) continue;
        if ((cur.answers[label] ?? "").trim() === "" && ans.note.trim() !== "") {
          cur.answers[label] = ans.note.trim().slice(0, ROW_MAX_LEN);
          changed = true;
        }
      }
      if (q.multiSelect && dq.combos.trim() && cur.extra.trim() === "") {
        cur.extra = dq.combos.trim();
        changed = true;
      }
      if (changed) {
        setNote(q.axisKey, composeNote(q.optionLabels, cur.answers, cur.extra));
        touched += 1;
        if (!firstTouched) firstTouched = q.axisKey;
      }
    }
    if (touched > 0) {
      setDraftedBanner(
        `AI drafted notes for ${touched} ${touched === 1 ? "question" : "questions"} from your catalog. Review and edit anything, then generate.`,
      );
      if (firstTouched) setExpanded((prev) => new Set(prev).add(firstTouched));
    } else {
      setDraftedBanner("Nothing to draft: every answer already has notes.");
    }
  }, [draftFetcher.state, draftFetcher.data, questions]);

  const filledCount = questions.filter((q) => (notes[q.axisKey] ?? "").trim() !== "").length;
  const generateBlocked =
    questions.length === 0 || !data.aiConfigured || data.catalog.productCount === 0;
  const generating = genPhase !== null;
  const draftBlocked = generateBlocked || chatBusy || draftFetcher.state !== "idle";

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
      <div style={{ maxWidth: 680, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card>
          <InlineStack gap="400" blockAlign="center" wrap={false}>
            <div style={{ flex: 1 }}>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Tell the AI what each answer means</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Open a question, fill in a few words per answer (or let AI draft
                  them from your catalog), then generate. Nothing goes live until
                  you publish.
                </Text>
              </BlockStack>
            </div>
            {data.aiConfigured && (
              <Button
                icon={MagicIcon}
                onClick={() => requestDraft()}
                loading={draftingKeys === null}
                disabled={draftBlocked && draftingKeys !== null}
              >
                Draft all notes with AI
              </Button>
            )}
          </InlineStack>
        </Card>

        {draftedBanner && (
          <Banner tone="success" onDismiss={() => setDraftedBanner(null)}>
            {draftedBanner}
          </Banner>
        )}
        {draftFetcher.data && !draftFetcher.data.ok && draftFetcher.data.intent === "draft-notes" && (
          <Banner tone="critical">{draftFetcher.data.error}</Banner>
        )}

        {currentGuidance !== "" && !review && (
          <Banner tone="success" title="Your draft already has recommendation logic">
            Refine your notes and regenerate any time. Generating replaces the
            draft's logic after you review it.
          </Banner>
        )}

        {questions.map((q) => {
          const parsed = parseNote(notes[q.axisKey] ?? "", q.optionLabels);
          const setRow = (label: string, value: string) => {
            const next = { ...parsed.answers, [label]: value };
            setNote(q.axisKey, composeNote(q.optionLabels, next, parsed.extra));
          };
          const filled = (notes[q.axisKey] ?? "").trim() !== "";
          return (
            <LogicCard
              key={q.axisKey}
              id={q.axisKey}
              title={`Q${q.position}: ${q.prompt.trim() || "Untitled question"}`}
              badge={
                filled ? <Badge tone="success">Described</Badge> : <Badge tone="attention">Not filled in</Badge>
              }
              expanded={expanded.has(q.axisKey)}
              onToggle={() => toggle(q.axisKey)}
            >
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodySm" tone="subdued">
                    For each answer: which products, collections, or traits fit.
                  </Text>
                  {data.aiConfigured && (
                    <Button
                      size="slim"
                      variant="tertiary"
                      icon={MagicIcon}
                      onClick={() => requestDraft([q.axisKey])}
                      loading={draftingKeys === JSON.stringify([q.axisKey])}
                      disabled={draftBlocked && draftingKeys !== JSON.stringify([q.axisKey])}
                    >
                      Draft with AI
                    </Button>
                  )}
                </InlineStack>
                {q.optionLabels.map((label) => (
                  <InlineStack key={label} gap="300" blockAlign="center" wrap={false}>
                    <div style={{ width: 160, flexShrink: 0 }}>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {label}
                      </Text>
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label={`Note for answer ${label}`}
                        labelHidden
                        maxLength={ROW_MAX_LEN}
                        value={parsed.answers[label] ?? ""}
                        onChange={(v) => setRow(label, v)}
                        placeholder="Products, collections, or traits that fit"
                        disabled={chatBusy}
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>
                ))}
                <TextField
                  label="Anything else (optional)"
                  multiline={2}
                  maxLength={NOTE_MAX_LEN}
                  value={parsed.extra}
                  onChange={(v) => setNote(q.axisKey, composeNote(q.optionLabels, parsed.answers, v))}
                  placeholder={
                    q.multiSelect
                      ? "e.g. how combined picks interact, what to avoid"
                      : "e.g. what to avoid, bestsellers to favor"
                  }
                  disabled={chatBusy}
                  autoComplete="off"
                />
              </BlockStack>
            </LogicCard>
          );
        })}

        {photoAxes.map((a) => (
          <LogicCard
            key={a.axisKey}
            id={a.axisKey}
            title={a.label}
            badge={<Badge>From the shopper's photo</Badge>}
            expanded={expanded.has(a.axisKey)}
            onToggle={() => toggle(a.axisKey)}
          >
            <BlockStack gap="300">
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
          </LogicCard>
        ))}

        <LogicCard
          id="general"
          title="Store-wide notes"
          badge={
            (notes[GENERAL_GUIDANCE_KEY] ?? "").trim() !== "" ? (
              <Badge tone="success">Described</Badge>
            ) : (
              <Badge>Optional</Badge>
            )
          }
          expanded={expanded.has("general")}
          onToggle={() => toggle("general")}
        >
          <BlockStack gap="300">
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
        </LogicCard>

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
