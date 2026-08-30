import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  TextField,
  Select,
  Collapsible,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import {
  findShopByDomain,
  saveChatAssistantConfig,
  upsertQuestionGuidance,
  deleteQuestionGuidance,
  getQuestionGuidance,
  countShopProducts,
} from "../lib/supabase.server";
import { captureLiveConfig, hasQuizDraft } from "../lib/quiz-draft.server";
import { isClaudeConfigured } from "../lib/claude.server";
import {
  framingPrompt,
  photoFramingPrompt,
  GENERAL_FRAMING_PROMPT,
  GENERAL_GUIDANCE_KEY,
} from "../lib/quiz-guidance-shared";
import { readSseStream } from "../lib/sse-client";

// ---------------------------------------------------------------------
// Recommendation logic page — the self-serve replacement for hand-writing
// ai_guidance (or building a rules matrix). One card per quiz question with
// an auto-generated framing prompt and a notes box; "Generate my
// recommendation logic" compiles all notes + the catalog into an ORLY-style
// ranking rulebook via Claude, which the merchant reviews and applies to
// chat_assistant_config.ai_guidance.
//
// Applying writes ONLY ai_guidance + recommendation_mode. The advanced
// rules editor stays available for hand-tuned shops.
// ---------------------------------------------------------------------

const NOTE_KEY_RE = /^[a-z_][a-z0-9_]*$/;
const NOTE_MAX_LEN = 4000;

const MODE_LABELS: Record<string, string> = {
  matrix: "Rules only",
  ai: "AI",
  hybrid: "Rules + AI",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await findShopByDomain(session.shop);
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [live, notes, productCount, draftExists] = await Promise.all([
    captureLiveConfig(shop.id),
    getQuestionGuidance(shop.id),
    countShopProducts(shop.id),
    hasQuizDraft(shop.id),
  ]);

  const questions = live.flow.questions.map((q, i) => ({
    axisKey: q.axisKey,
    prompt: q.prompt,
    position: i + 1,
    framing: framingPrompt({
      prompt: q.prompt,
      multiSelect: q.multiSelect ?? false,
      optionLabels: q.options.map((o) => o.label),
    }),
    notes: notes[q.axisKey] ?? "",
  }));
  const photoAxes = live.flow.axes
    .filter((a) => a.source === "photo")
    .map((a) => ({
      axisKey: a.key,
      label: a.label,
      framing: photoFramingPrompt(a.label),
      notes: notes[a.key] ?? "",
    }));

  const knownKeys = new Set(live.flow.axes.map((a) => a.key));
  const orphans = Object.entries(notes)
    .filter(([k]) => k !== GENERAL_GUIDANCE_KEY && !knownKeys.has(k))
    .map(([key, value]) => ({ key, excerpt: value.slice(0, 80) }));

  const settings = live.settings as Record<string, unknown>;
  return json({
    questions,
    photoAxes,
    generalNotes: notes[GENERAL_GUIDANCE_KEY] ?? "",
    orphans,
    currentGuidance: String(settings.ai_guidance ?? ""),
    recommendationMode: String(settings.recommendation_mode ?? "matrix"),
    ruleCount: live.flow.rules.length,
    aiConfigured: isClaudeConfigured(),
    // null = count unavailable (never block the page on a counting hiccup)
    productCount,
    draftExists,
  });
};

// Loader reads throw loudly on fetch errors (a blank notes page would read
// as "nothing configured" and invite a destructive regenerate); catch them
// with app chrome instead of Remix's bare error screen.
export function ErrorBoundary() {
  return (
    <Page title="Recommendation logic" backAction={{ content: "Quiz", url: "/app/quiz" }}>
      <Banner tone="critical" title="Something went wrong loading your notes">
        Reload the page to try again. Your saved configuration is untouched.
      </Banner>
    </Page>
  );
}

type ActionResponse = { success?: boolean; error?: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return json({ error: "Session expired. Please reload." }, { status: 401 });
    }
    throw err;
  }
  const shopDomain = session.shop;
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-notes") {
    // Presence-guarded: only keys this form submitted are written (the
    // client sends only edited keys), so untouched notes can't be
    // overwritten with stale values from an old tab.
    for (const [field, value] of formData.entries()) {
      if (!field.startsWith("notes:") || typeof value !== "string") continue;
      const axisKey = field.slice("notes:".length);
      if (!NOTE_KEY_RE.test(axisKey)) continue;
      const saved = await upsertQuestionGuidance(shop.id, axisKey, value.slice(0, NOTE_MAX_LEN));
      if (!saved.ok) return json({ error: saved.error ?? "Save failed" }, { status: 500 });
    }
    return json({ success: true });
  }

  if (intent === "apply-guidance") {
    const guidanceText = String(formData.get("guidanceText") ?? "").trim();
    const mode = formData.get("mode");
    if (!guidanceText) return json({ error: "Guidance is empty" }, { status: 400 });
    if (guidanceText.length > 50_000) return json({ error: "Guidance is too long" }, { status: 400 });
    if (mode !== "ai" && mode !== "hybrid") {
      return json({ error: "Invalid ranking mode" }, { status: 400 });
    }
    try {
      // ONLY these two keys — every other chat_assistant_config field is
      // outside this page's blast radius by construction.
      await saveChatAssistantConfig(shopDomain, {
        ai_guidance: guidanceText,
        recommendation_mode: mode,
      });
    } catch (err) {
      return json({
        error: err instanceof Error ? err.message : "Failed to save",
      }, { status: 500 });
    }
    return json({ success: true });
  }

  if (intent === "delete-orphan-note") {
    const axisKey = String(formData.get("axisKey") ?? "");
    if (!NOTE_KEY_RE.test(axisKey) || axisKey === GENERAL_GUIDANCE_KEY) {
      return json({ error: "Invalid key" }, { status: 400 });
    }
    const deleted = await deleteQuestionGuidance(shop.id, axisKey);
    if (!deleted.ok) return json({ error: deleted.error ?? "Delete failed" }, { status: 500 });
    return json({ success: true });
  }

  if (intent === "delete-all-orphan-notes") {
    // Recompute orphans server-side; never trust a client-provided list for
    // a bulk delete.
    const [live, notes] = await Promise.all([
      captureLiveConfig(shop.id),
      getQuestionGuidance(shop.id),
    ]);
    const knownKeys = new Set(live.flow.axes.map((a) => a.key));
    for (const key of Object.keys(notes)) {
      if (key === GENERAL_GUIDANCE_KEY || knownKeys.has(key)) continue;
      const deleted = await deleteQuestionGuidance(shop.id, key);
      if (!deleted.ok) return json({ error: deleted.error ?? "Delete failed" }, { status: 500 });
    }
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

type GenerateEvent =
  | { type: "progress"; phase: string }
  | {
      type: "result";
      guidanceText: string;
      perQuestionSummary: Array<{ axisKey: string; summary: string }>;
      warnings: string[];
    }
  | { type: "error"; error: string; warnings?: string[] }
  | { type: "heartbeat" };

interface ReviewState {
  guidanceText: string;
  perQuestionSummary: Array<{ axisKey: string; summary: string }>;
  warnings: string[];
}

function OrphanNoteRow({ orphan }: { orphan: { key: string; excerpt: string } }) {
  const fetcher = useFetcher<ActionResponse>();
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <Badge tone="warning">Unused</Badge>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text as="span" variant="bodySm" tone="subdued" truncate>
          {orphan.excerpt || orphan.key}
        </Text>
      </div>
      <Button
        variant="plain"
        tone="critical"
        loading={fetcher.state !== "idle"}
        onClick={() => {
          const fd = new FormData();
          fd.append("intent", "delete-orphan-note");
          fd.append("axisKey", orphan.key);
          fetcher.submit(fd, { method: "POST" });
        }}
      >
        Delete
      </Button>
    </InlineStack>
  );
}

export default function QuizLogic() {
  const data = useLoaderData<typeof loader>();
  const notesFetcher = useFetcher<ActionResponse>();
  const applyFetcher = useFetcher<ActionResponse>();
  const orphanBulkFetcher = useFetcher<ActionResponse>();

  // notes keyed by axisKey (plus __general).
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { [GENERAL_GUIDANCE_KEY]: data.generalNotes };
    for (const q of data.questions) initial[q.axisKey] = q.notes;
    for (const a of data.photoAxes) initial[a.axisKey] = a.notes;
    return initial;
  });
  // Mirror for comparisons outside React updaters (post-generate dirty check).
  const notesRef = useRef(notes);
  // Only keys the merchant actually touched are submitted by Save notes, so
  // a stale tab can't overwrite notes edited elsewhere in the meantime.
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [genPhase, setGenPhase] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [mode, setMode] = useState<"ai" | "hybrid">(data.ruleCount > 0 ? "hybrid" : "ai");
  const [showCurrent, setShowCurrent] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const generateSnapshotRef = useRef<Record<string, string> | null>(null);
  const generateRunningRef = useRef(false);
  const processedNotesRef = useRef<ActionResponse | null>(null);
  const processedApplyRef = useRef<ActionResponse | null>(null);
  // Where generation feedback (error banner / review card) lands; focused
  // and scrolled into view when a run finishes so the result is never lost
  // below 15 question cards.
  const feedbackRef = useRef<HTMLDivElement | null>(null);

  const setNote = (axisKey: string, value: string) => {
    setNotes((prev) => {
      const next = { ...prev, [axisKey]: value };
      notesRef.current = next;
      return next;
    });
    dirtyKeysRef.current.add(axisKey);
    setNotesDirty(true);
    setNotesSaved(false);
  };

  const allNotesFormData = () => {
    const fd = new FormData();
    for (const [key, value] of Object.entries(notesRef.current)) fd.append(`notes:${key}`, value);
    return fd;
  };

  const saveNotes = () => {
    setGenError(null);
    setNotesError(null);
    setNotesSaved(false);
    const fd = new FormData();
    fd.append("intent", "save-notes");
    for (const key of dirtyKeysRef.current) {
      fd.append(`notes:${key}`, notesRef.current[key] ?? "");
    }
    notesFetcher.submit(fd, { method: "POST" });
  };
  useEffect(() => {
    if (notesFetcher.state !== "idle" || !notesFetcher.data) return;
    if (processedNotesRef.current === notesFetcher.data) return;
    processedNotesRef.current = notesFetcher.data;
    if (notesFetcher.data.success) {
      dirtyKeysRef.current.clear();
      setNotesDirty(false);
      setNotesSaved(true);
    } else if (notesFetcher.data.error) {
      setNotesError(notesFetcher.data.error);
    }
  }, [notesFetcher.state, notesFetcher.data]);

  const generating = genPhase !== null;
  const savingNotes = notesFetcher.state !== "idle";
  const generateBlocked =
    data.questions.length === 0 || !data.aiConfigured || data.productCount === 0;

  const focusFeedback = () => {
    // Post-paint so the review card / error banner exists before we jump.
    requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      feedbackRef.current?.focus({ preventScroll: true });
    });
  };

  const runGenerate = async () => {
    if (generateRunningRef.current || generateBlocked) return;
    generateRunningRef.current = true;
    setGenPhase("Starting…");
    setGenError(null);
    setNotesError(null);
    setApplied(false);
    setApplyError(null);
    setNotesSaved(false);
    // ALL notes ride along and are saved server-side before compiling, so
    // the output always reflects what's on screen at this moment.
    generateSnapshotRef.current = { ...notesRef.current };
    const fd = allNotesFormData();
    let gotTerminal = false;
    try {
      // App Bridge patches global fetch with the session token in embedded
      // apps; EventSource can't POST, so we read the SSE body manually.
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
          // Only mark clean if nothing changed while the model was working.
          const snap = generateSnapshotRef.current;
          const current = notesRef.current;
          const unchanged =
            snap !== null &&
            Object.keys({ ...snap, ...current }).every((k) => (snap[k] ?? "") === (current[k] ?? ""));
          if (unchanged) {
            dirtyKeysRef.current.clear();
            setNotesDirty(false);
          }
          focusFeedback();
        } else if (event.type === "error") {
          gotTerminal = true;
          setGenError(event.error);
          focusFeedback();
        }
      });
      if (!gotTerminal) {
        // Stream cut cleanly (deploy, proxy) without a result or error
        // frame — without this the button just stops spinning in silence.
        setGenError("Generation was interrupted. Your notes were saved; hit Generate again.");
        focusFeedback();
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
      focusFeedback();
    } finally {
      // A severed stream must not leave the button spinning forever.
      setGenPhase(null);
      generateRunningRef.current = false;
    }
  };

  const applyGuidance = () => {
    if (!review) return;
    setApplyError(null);
    const fd = new FormData();
    fd.append("intent", "apply-guidance");
    fd.append("guidanceText", review.guidanceText);
    fd.append("mode", mode);
    applyFetcher.submit(fd, { method: "POST" });
  };
  useEffect(() => {
    if (applyFetcher.state !== "idle" || !applyFetcher.data) return;
    if (processedApplyRef.current === applyFetcher.data) return;
    processedApplyRef.current = applyFetcher.data;
    if (applyFetcher.data.success) setApplied(true);
    else if (applyFetcher.data.error) setApplyError(applyFetcher.data.error);
  }, [applyFetcher.state, applyFetcher.data]);

  const questionByKey = new Map(data.questions.map((q) => [q.axisKey, q]));
  const filledCount = data.questions.filter((q) => (notes[q.axisKey] ?? "").trim() !== "").length;
  const hasActiveLogic = data.currentGuidance.trim() !== "" && data.recommendationMode !== "matrix";
  const hasInactiveLogic = data.currentGuidance.trim() !== "" && data.recommendationMode === "matrix";

  const currentGuidanceCard = data.currentGuidance.trim() !== "" && (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            {hasInactiveLogic ? "Saved logic (not currently in use)" : "Currently active logic"}
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Badge>{MODE_LABELS[data.recommendationMode] ?? data.recommendationMode}</Badge>
            <Button variant="plain" onClick={() => setShowCurrent((s) => !s)}>
              {showCurrent ? "Hide" : "Show"}
            </Button>
          </InlineStack>
        </InlineStack>
        {hasInactiveLogic && (
          <Text as="p" variant="bodySm" tone="subdued">
            Your ranking mode is Rules only, so this saved logic isn't used.
            Generate and activate below to switch it on.
          </Text>
        )}
        <Collapsible id="current-guidance" open={showCurrent}>
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <pre
              style={{
                whiteSpace: "pre-wrap",
                margin: 0,
                fontSize: 12,
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {data.currentGuidance}
            </pre>
          </Box>
        </Collapsible>
      </BlockStack>
    </Card>
  );

  return (
    <Page
      title="Recommendation logic"
      backAction={{ content: "Quiz", url: "/app/quiz" }}
      primaryAction={{
        content: "Generate my recommendation logic",
        onAction: runGenerate,
        loading: generating,
        disabled: generateBlocked || savingNotes,
      }}
    >
      <TitleBar title="Recommendation logic" />
      <BlockStack gap="500">
        <Banner
          tone="info"
          title="Describe your logic in plain words. The AI writes the rules."
          action={{ content: "Edit questions", url: "/app/quiz/questions" }}
        >
          Under each question, tell us what its answers should mean for
          recommendations: which products fit, what to avoid, what matters
          most. Then hit Generate. Gleame compiles your notes and your catalog
          into the recommendation logic your quiz uses, and nothing goes live
          until you review and activate it.
        </Banner>

        {!data.aiConfigured && (
          <Banner tone="warning" title="AI generation isn't available">
            This installation isn't set up for AI generation yet. Contact
            Gleame support. Your notes below still save normally.
          </Banner>
        )}
        {data.productCount === 0 && (
          <Banner
            tone="warning"
            title="Your product catalog isn't synced yet"
            action={{ content: "Sync in the Quiz Builder", url: "/app/quiz-builder" }}
          >
            Recommendation logic is built from your real products. Sync your
            catalog first, then come back here.
          </Banner>
        )}
        {data.draftExists && (
          <Banner
            tone="warning"
            title="You have an unpublished draft in the Quiz Builder"
          >
            Changes you activate here go live immediately. Publishing that
            draft later will replace them (the previous version is archived in
            version history).
          </Banner>
        )}

        {hasActiveLogic && (
          <Banner
            tone="success"
            title={`Your quiz already has active recommendation logic (${MODE_LABELS[data.recommendationMode] ?? data.recommendationMode} mode)`}
          >
            You're all set. Use the notes below to refine how answers map to
            products, then Generate to rewrite the logic. Generating replaces
            the current logic after you review and activate.
          </Banner>
        )}
        {!hasActiveLogic && data.recommendationMode === "matrix" && data.ruleCount > 0 && (
          <Banner tone="info" title={`Your quiz currently ranks with your ${data.ruleCount} advanced ${data.ruleCount === 1 ? "rule" : "rules"} (Rules only mode)`}>
            This page is optional for you. Activating generated logic switches
            your quiz to Rules + AI (your rules still win when they match) or
            AI mode. Your rules themselves are never changed here.
          </Banner>
        )}
        {data.currentGuidance.trim() === "" &&
          filledCount > 0 &&
          data.questions.length > 0 && (
            <Banner tone="warning" title="Your notes are saved, but no logic is active yet">
              Hit Generate, review the result, and activate it to finish.
            </Banner>
          )}

        {hasActiveLogic && currentGuidanceCard}

        {data.questions.length === 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Set up your questions first
              </Text>
              <Text as="p" tone="subdued">
                Once your quiz has questions, this page lets you describe what
                each answer should mean for recommendations.
              </Text>
              <InlineStack gap="200">
                <Button variant="primary" url="/app/quiz/questions">
                  Edit questions
                </Button>
                <Button url="/app/quiz-builder">Open Quiz Builder</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {data.questions.length > 0 && (
          <Text as="h2" variant="headingMd">
            Step 1: describe what each answer means
          </Text>
        )}

        {data.questions.map((q) => (
          <Card key={q.axisKey}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Q{q.position}: {q.prompt}
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
                showCharacterCount={(notes[q.axisKey] ?? "").length > NOTE_MAX_LEN * 0.7}
                value={notes[q.axisKey] ?? ""}
                onChange={(v) => setNote(q.axisKey, v)}
                placeholder="e.g. Everyday: the breathable line and sheer nudes. Party: glitter, chrome, bold reds. Wedding: soft pinks and classic french."
                autoComplete="off"
              />
            </BlockStack>
          </Card>
        ))}

        {data.photoAxes.map((a) => (
          <Card key={a.axisKey}>
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
                placeholder="e.g. Fair skin tones suit sheer pinks; deep skin tones pop with high-contrast brights"
                autoComplete="off"
              />
            </BlockStack>
          </Card>
        ))}

        {data.questions.length > 0 && (
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
                showCharacterCount={(notes[GENERAL_GUIDANCE_KEY] ?? "").length > NOTE_MAX_LEN * 0.7}
                value={notes[GENERAL_GUIDANCE_KEY] ?? ""}
                onChange={(v) => setNote(GENERAL_GUIDANCE_KEY, v)}
                placeholder="e.g. Our bestsellers are the Silk Set and Coral Crush. Feature them when they fit. Never push clearance items."
                autoComplete="off"
              />
            </BlockStack>
          </Card>
        )}

        {data.orphans.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Notes from deleted questions
                </Text>
                {data.orphans.length > 1 && (
                  <Button
                    variant="plain"
                    tone="critical"
                    loading={orphanBulkFetcher.state !== "idle"}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append("intent", "delete-all-orphan-notes");
                      orphanBulkFetcher.submit(fd, { method: "POST" });
                    }}
                  >
                    Delete all
                  </Button>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                These notes belonged to questions that no longer exist. They
                aren't used when generating.
              </Text>
              {data.orphans.map((orphan) => (
                <OrphanNoteRow key={orphan.key} orphan={orphan} />
              ))}
            </BlockStack>
          </Card>
        )}

        {notesSaved && !notesDirty && (
          <Banner tone="success" onDismiss={() => setNotesSaved(false)}>
            Notes saved.
          </Banner>
        )}

        {data.questions.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Step 2: generate
              </Text>
              <InlineStack gap="300" blockAlign="center">
                <Button
                  variant="primary"
                  onClick={runGenerate}
                  loading={generating}
                  disabled={generateBlocked || savingNotes}
                >
                  Generate my recommendation logic
                </Button>
                <Button onClick={saveNotes} loading={savingNotes} disabled={!notesDirty || generating}>
                  Save notes
                </Button>
                <div role="status">
                  {genPhase ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {genPhase}
                    </Text>
                  ) : (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {filledCount} of {data.questions.length}{" "}
                      {data.questions.length === 1 ? "question" : "questions"} described
                    </Text>
                  )}
                </div>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Generate saves your notes, then compiles them with your catalog
                into the recommendation logic. You review the result before
                anything goes live. Takes about a minute.
              </Text>
            </BlockStack>
          </Card>
        )}

        <div ref={feedbackRef} tabIndex={-1} style={{ outline: "none" }}>
          <BlockStack gap="500">
            {(notesError || genError) && (
              <Banner
                tone="critical"
                onDismiss={() => {
                  setGenError(null);
                  setNotesError(null);
                }}
                action={
                  genError?.includes("Quiz Builder")
                    ? { content: "Open Quiz Builder", url: "/app/quiz-builder" }
                    : undefined
                }
              >
                {genError ?? notesError}
              </Banner>
            )}

            {review && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      Step 3: review and activate
                    </Text>
                    {applied && <Badge tone="success">Live</Badge>}
                  </InlineStack>

                  {applied && (
                    <Banner
                      tone="success"
                      title="Your recommendation logic is live"
                      action={{ content: "Back to quiz setup", url: "/app/quiz" }}
                    >
                      Shoppers get recommendations from this logic on their next
                      quiz. Refine your notes and regenerate any time.
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
                          <strong>{questionByKey.get(s.axisKey)?.prompt ?? s.axisKey}:</strong>{" "}
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
                      setApplied(false);
                      setReview((prev) => (prev ? { ...prev, guidanceText: v } : prev));
                    }}
                    autoComplete="off"
                    helpText="Tweak anything before activating. This exact text becomes the instructions your quiz's AI ranker follows."
                  />

                  <InlineStack gap="300" blockAlign="end">
                    <div style={{ minWidth: 300 }}>
                      <Select
                        label="Ranking mode"
                        options={[
                          { label: "AI: ranks your whole catalog from this logic", value: "ai" },
                          {
                            label: "Rules + AI: your advanced rules win when they match, AI otherwise",
                            value: "hybrid",
                          },
                        ]}
                        value={mode}
                        onChange={(v) => {
                          setApplied(false);
                          setMode(v as "ai" | "hybrid");
                        }}
                      />
                    </div>
                    <Button
                      variant="primary"
                      onClick={applyGuidance}
                      loading={applyFetcher.state !== "idle"}
                      disabled={applied}
                    >
                      {data.currentGuidance.trim() !== ""
                        ? "Replace current logic & activate"
                        : "Save & activate"}
                    </Button>
                    <Button onClick={runGenerate} disabled={generating}>
                      Regenerate
                    </Button>
                    <Button onClick={() => setReview(null)} disabled={generating}>
                      Discard
                    </Button>
                  </InlineStack>
                  {applyError && <Banner tone="critical">{applyError}</Banner>}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </div>

        {!hasActiveLogic && currentGuidanceCard}

        <InlineStack>
          <Button variant="plain" url="/app/assistant/recommendations">
            Advanced rules editor
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
