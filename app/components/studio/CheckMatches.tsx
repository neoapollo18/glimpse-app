// Check matches, v2 (V2-SPEC Part 6, wireframe s-matches). Left 55%: the
// ACTUAL quiz, playable, in the assigned template on the themed canvas.
// The merchant answers by clicking through the preview; the widget posts
// its answer path ({type:'gleame:path', criteria} in preview mode, a
// contract owned by the widget package). Right 45%: live results for the
// current path with Pin / Exclude / Boost writing the existing rules
// format, an Undo toast per action, a collapsed matching-notes editor
// (the AI-guidance flow, demanded of no one), and a footer drawer that
// only appears when products become unreachable AFTER a merchant edit.
// No dropdown answer-selection UI anywhere; if the widget bridge never
// reports a path, a compact answer-chip fallback appears instead.

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Badge, Banner, BlockStack, Button, InlineStack, Select, Text, TextField } from "@shopify/polaris";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { StudioFlow } from "./types";
import { answerLabel } from "./types";
import { StoreContextStrip, type CanvasTheme } from "./PreviewCanvas";
import { postStudioAction } from "./studio-data";
import { readSseStream } from "../../lib/sse-client";
import { GENERAL_GUIDANCE_KEY, GENERAL_FRAMING_PROMPT } from "../../lib/quiz-guidance-shared";

interface MatchRow {
  productId: string;
  name: string;
  variantTitle: string | null;
  imageUrl: string | null;
  price: number | null;
  why: string[];
  whyCriteria?: Record<string, string>;
  quantity: number;
}

interface UndoPayload {
  productId: string;
  rulesBefore: Array<Record<string, unknown>>;
  priorityHad: boolean;
}

export function CheckMatches({
  data,
  chatBusy,
  previewToken,
  theme,
  iframeRef,
}: {
  data: StudioLoaderData;
  chatBusy: boolean;
  previewToken: string | null;
  theme: CanvasTheme;
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
}) {
  const flow = (data.draft?.flow ?? { axes: [], questions: [], rules: [] }) as StudioFlow;
  const axisByKey = useMemo(
    () => new Map((flow.axes ?? []).map((a: any) => [a.key, a])),
    [flow.axes]
  );
  const questions = (flow.questions ?? []).filter((q: any) => (q.prompt ?? "").trim() !== "");

  const [criteria, setCriteria] = useState<Record<string, string>>({});
  // Once the widget's path bridge speaks, the chip fallback disappears for
  // the rest of the session (degrade-gracefully contract, spec Part 6).
  const [bridgeAlive, setBridgeAlive] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    mode: string | null;
    matches: MatchRow[];
    unmapped: Array<{ productId: string; name: string }>;
    unmappedTotal: number;
    priority: string[];
    error: string | null;
  }>({ loading: false, mode: null, matches: [], unmapped: [], unmappedTotal: 0, priority: [], error: null });
  const [toast, setToast] = useState<{ message: string; undo?: UndoPayload } | null>(null);
  const [edited, setEdited] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reqSeq = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- The widget's answer-path bridge ---------------------------------
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; criteria?: Record<string, unknown> } | null;
      if (!d || d.type !== "gleame:path") return;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.criteria ?? {})) {
        if (typeof v === "string" && v) next[k] = v;
      }
      setBridgeAlive(true);
      setCriteria(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // --- Live results (debounced <= 500ms per spec) -----------------------
  const refresh = useCallback(async (c: Record<string, string>) => {
    const seq = ++reqSeq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/app/api/match-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria: c }),
      });
      const body = await res.json();
      if (seq !== reqSeq.current) return;
      if (!body.ok) throw new Error(body.error ?? "Check failed");
      setState({
        loading: false,
        mode: body.mode,
        matches: body.matches,
        unmapped: body.unmapped,
        unmappedTotal: body.unmappedTotal,
        priority: body.priorityProductIds ?? [],
        error: null,
      });
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refresh(criteria), 400);
    return () => clearTimeout(t);
  }, [criteria, refresh]);

  const showToast = useCallback((message: string, undo?: UndoPayload) => {
    setToast({ message, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const act = useCallback(
    async (action: "pin" | "boost" | "exclude", productId: string, name: string) => {
      const res = await fetch("/app/api/match-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productId, criteria }),
      });
      const body = await res.json();
      if (body.ok) {
        setEdited(true);
        showToast(
          action === "pin"
            ? `Pinned ${name} for this path`
            : action === "boost"
              ? `Boosted ${name} everywhere`
              : `Removed ${name} for this path`,
          body.undo as UndoPayload | undefined
        );
        void refresh(criteria);
      } else {
        showToast(body.error ?? "That didn't save");
      }
    },
    [criteria, refresh, showToast]
  );

  const undoLast = useCallback(async () => {
    if (!toast?.undo) return;
    const res = await fetch("/app/api/match-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", productId: toast.undo.productId, undo: toast.undo }),
    });
    const body = await res.json();
    setToast(null);
    if (!body.ok) showToast(body.error ?? "Undo failed");
    void refresh(criteria);
  }, [toast, refresh, criteria, showToast]);

  const money = (n: number | null) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
  const whyLine = (m: MatchRow) => {
    const c = m.whyCriteria ?? {};
    const labels = Object.entries(c).map(([k, v]) => answerLabel(flow, k, v));
    return labels.length ? labels.join(", ") : m.why.join(", ");
  };
  const pathChips = Object.entries(criteria).map(([k, v]) => answerLabel(flow, k, v));

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "55% 45%", position: "relative" }}>
      {/* Left: the real quiz on the themed canvas, playable */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid #E1E3E5", background: theme.bg }}>
        <StoreContextStrip theme={theme} />
        {previewToken ? (
          <iframe
            ref={iframeRef}
            title="Play through your quiz"
            src={`/quiz-preview.html?token=${encodeURIComponent(previewToken)}`}
            style={{ flex: 1, width: "100%", border: 0, display: "block", background: theme.bg }}
          />
        ) : (
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#6D7175" }}>
            Preview unavailable
          </div>
        )}
      </div>

      {/* Right: live results for the current answer path */}
      <div style={{ overflowY: "auto", background: "#FCFCFD", padding: 18, minHeight: 0 }}>
        <BlockStack gap="200">
          <div>
            <Text as="h3" variant="headingSm">
              Play through. Do the matches look right?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Results update as you answer.
            </Text>
          </div>

          {questions.length === 0 && <Banner tone="info">No questions yet. Build the quiz first.</Banner>}

          {/* Current path as chips */}
          {pathChips.length > 0 && (
            <InlineStack gap="100" wrap>
              {pathChips.map((label, i) => (
                <span
                  key={`${label}-${i}`}
                  style={{
                    fontSize: 11.5,
                    background: "#ECEBFF",
                    color: "#4A3AFF",
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: "4px 11px",
                  }}
                >
                  {label}
                </span>
              ))}
            </InlineStack>
          )}

          {/* Fallback ONLY while the widget's path bridge stays silent:
              compact inline answer chips, never dropdowns. */}
          {!bridgeAlive && questions.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "#6D7175", padding: "2px 0" }}>
                Answers not registering from the preview? Pick a path here.
              </summary>
              <BlockStack gap="200">
                {questions.map((q: any) => {
                  const axis = axisByKey.get(q.axisKey) as any;
                  return (
                    <div key={q.axisKey}>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {q.prompt}
                      </Text>
                      <InlineStack gap="100" wrap>
                        {(axis?.values ?? []).map((v: any) => {
                          const on = criteria[q.axisKey] === v.value;
                          return (
                            <button
                              key={v.value}
                              type="button"
                              disabled={chatBusy}
                              onClick={() =>
                                setCriteria((prev) => {
                                  const next = { ...prev };
                                  if (on) delete next[q.axisKey];
                                  else next[q.axisKey] = v.value;
                                  return next;
                                })
                              }
                              style={{
                                border: on ? "1px solid #1a1a1a" : "1px solid #E1E3E5",
                                background: on ? "#F1F1F1" : "#fff",
                                borderRadius: 999,
                                padding: "3px 10px",
                                fontSize: 12,
                                fontWeight: on ? 600 : 400,
                                cursor: "pointer",
                                marginTop: 4,
                              }}
                            >
                              {v.label}
                            </button>
                          );
                        })}
                      </InlineStack>
                    </div>
                  );
                })}
              </BlockStack>
            </details>
          )}

          {state.error && <Banner tone="critical">{state.error}</Banner>}
          {state.mode === "ai" && state.matches.length === 0 && (
            <Banner tone="info">
              This quiz ranks with AI at serve time, so exact picks depend on the whole answer
              set. Curate here (Pin and Boost still apply) and spot-check end results on the
              store preview.
            </Banner>
          )}
          {!state.loading &&
            state.matches.length === 0 &&
            state.mode &&
            state.mode !== "ai" &&
            pathChips.length > 0 && (
              <Banner tone="warning">
                No rule fires for this path yet, so shoppers here get the fallback ordering.
              </Banner>
            )}

          {state.matches.map((m) => (
            <div
              key={m.productId}
              style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 13 }}
            >
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                {m.imageUrl ? (
                  <img
                    src={m.imageUrl}
                    alt=""
                    style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 46, height: 46, borderRadius: 8, background: "#f1f1f1", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {m.name}
                    {m.variantTitle ? ` · ${m.variantTitle}` : ""}
                    {m.quantity > 1 ? ` × ${m.quantity}` : ""}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {money(m.price)}
                    {state.priority.includes(m.productId) ? " · Boosted" : ""}
                  </Text>
                </div>
              </InlineStack>
              {whyLine(m) !== "" && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#4A4F56",
                    background: "#F6F6F8",
                    borderRadius: 8,
                    padding: "7px 10px",
                    margin: "9px 0 10px",
                  }}
                >
                  Why: matched <strong style={{ color: "#4A3AFF" }}>{whyLine(m)}</strong>
                </div>
              )}
              <InlineStack gap="150">
                <Button size="slim" onClick={() => act("pin", m.productId, m.name)} disabled={chatBusy || pathChips.length === 0}>
                  Pin
                </Button>
                <Button size="slim" onClick={() => act("exclude", m.productId, m.name)} disabled={chatBusy}>
                  Exclude
                </Button>
                <Button size="slim" onClick={() => act("boost", m.productId, m.name)} disabled={chatBusy}>
                  Boost
                </Button>
              </InlineStack>
            </div>
          ))}

          {/* Collapsed advanced matching notes (salvaged guidance flow) */}
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, color: "#6D7175", padding: "6px 0" }}>
              Advanced: edit matching notes
            </summary>
            <div style={{ marginTop: 10 }}>
              <MatchingNotes data={data} chatBusy={chatBusy} questions={questions} />
            </div>
          </details>

          {/* Post-edit orphan drawer ONLY (spec 5.4 prevents pre-edit
              orphans; anything surfacing here is the merchant's own edit) */}
          {edited && state.unmappedTotal > 0 && (
            <div
              style={{
                border: "1px dashed #D9B46A",
                background: "#FDF8EE",
                borderRadius: 10,
                padding: "11px 13px",
                fontSize: 12.5,
                color: "#7A5A12",
              }}
            >
              <InlineStack align="space-between" blockAlign="center">
                <span>
                  {state.unmappedTotal} {state.unmappedTotal === 1 ? "product" : "products"} unreached after
                  your edits
                </span>
                <Button variant="plain" size="slim" onClick={() => setDrawerOpen((o) => !o)}>
                  {drawerOpen ? "Hide" : "Attach to answer…"}
                </Button>
              </InlineStack>
              {drawerOpen && (
                <BlockStack gap="100">
                  {pathChips.length === 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Play to an answer path first, then attach products to it.
                    </Text>
                  )}
                  {state.unmapped.map((p) => (
                    <InlineStack key={p.productId} align="space-between" blockAlign="center">
                      <Text as="p" variant="bodySm">
                        {p.name}
                      </Text>
                      <Button
                        size="slim"
                        onClick={() => act("pin", p.productId, p.name)}
                        disabled={chatBusy || pathChips.length === 0}
                      >
                        Attach to this path
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </div>
          )}
        </BlockStack>
      </div>

      {toast && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            background: "#141519",
            color: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12.5,
            display: "flex",
            gap: 14,
            alignItems: "center",
            zIndex: 10,
            boxShadow: "0 8px 24px rgba(20,22,26,.2)",
          }}
        >
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={undoLast}
              style={{
                border: 0,
                background: "transparent",
                color: "#9AA4FF",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 12.5,
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Advanced: matching notes (minimal). One free-text note per question
// plus store-wide notes, saved through the existing save-notes intent;
// compiling runs the guidance SSE and activates via activate-guidance.
// ---------------------------------------------------------------------

type GenerateEvent =
  | { type: "progress"; phase: string; streamed?: number }
  | { type: "result"; guidanceText: string; warnings: string[] }
  | { type: "error"; error: string }
  | { type: "heartbeat" };

function MatchingNotes({
  data,
  chatBusy,
  questions,
}: {
  data: StudioLoaderData;
  chatBusy: boolean;
  questions: Array<{ axisKey: string; prompt: string }>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>(() => ({
    [GENERAL_GUIDANCE_KEY]: (data.notes as Record<string, string>)[GENERAL_GUIDANCE_KEY] ?? "",
    ...Object.fromEntries(
      questions.map((q) => [q.axisKey, (data.notes as Record<string, string>)[q.axisKey] ?? ""])
    ),
  }));
  const dirtyRef = useRef<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [genPhase, setGenPhase] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [mode, setMode] = useState<"ai" | "hybrid">(
    (data.draft?.flow.rules.length ?? 0) > 0 ? "hybrid" : "ai"
  );
  const [activated, setActivated] = useState(false);
  const [activating, setActivating] = useState(false);

  const setNote = (key: string, value: string) => {
    setNotes((prev) => ({ ...prev, [key]: value }));
    dirtyRef.current.add(key);
    setDirty(true);
    setSaved(false);
  };

  const saveNotes = async () => {
    setSaving(true);
    const fd = new FormData();
    fd.append("intent", "save-notes");
    for (const key of dirtyRef.current) fd.append(`notes:${key}`, notes[key] ?? "");
    try {
      const res = await postStudioAction(fd);
      const body = (await res.json().catch(() => null)) as StudioActionData | null;
      if (body?.ok) {
        dirtyRef.current.clear();
        setDirty(false);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (genPhase) return;
    setGenPhase("Starting…");
    setGenError(null);
    setActivated(false);
    const fd = new FormData();
    fd.append("source", "draft");
    for (const [key, value] of Object.entries(notes)) fd.append(`notes:${key}`, value);
    try {
      const res = await fetch("/app/api/guidance-generate", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      let terminal = false;
      await readSseStream<GenerateEvent>(res, (event) => {
        if (event.type === "progress") setGenPhase(event.phase);
        else if (event.type === "result") {
          terminal = true;
          setReview(event.guidanceText);
        } else if (event.type === "error") {
          terminal = true;
          setGenError(event.error);
        }
      });
      if (!terminal) setGenError("Generation was interrupted. Your notes were saved; try again.");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenPhase(null);
    }
  };

  const activate = async () => {
    if (!review) return;
    setActivating(true);
    try {
      const fd = new FormData();
      fd.append("intent", "activate-guidance");
      fd.append("guidanceText", review);
      fd.append("mode", mode);
      const res = await postStudioAction(fd);
      const body = (await res.json().catch(() => null)) as StudioActionData | null;
      if (body?.ok) setActivated(true);
      else setGenError(body?.error ?? "Saving the logic failed");
    } finally {
      setActivating(false);
    }
  };

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        A few words per question about what its answers mean for your
        catalog. Gleame compiles them into the ranking logic your quiz uses.
      </Text>
      {questions.map((q, i) => (
        <TextField
          key={q.axisKey}
          label={`Q${i + 1}: ${q.prompt}`}
          multiline={2}
          value={notes[q.axisKey] ?? ""}
          onChange={(v) => setNote(q.axisKey, v)}
          placeholder="Products, collections, or traits that fit each answer"
          disabled={chatBusy}
          autoComplete="off"
        />
      ))}
      <TextField
        label="Store-wide notes"
        multiline={3}
        value={notes[GENERAL_GUIDANCE_KEY] ?? ""}
        onChange={(v) => setNote(GENERAL_GUIDANCE_KEY, v)}
        placeholder={GENERAL_FRAMING_PROMPT}
        disabled={chatBusy}
        autoComplete="off"
      />
      <InlineStack gap="200" blockAlign="center">
        <Button onClick={saveNotes} loading={saving} disabled={!dirty || chatBusy}>
          Save notes
        </Button>
        <Button
          onClick={generate}
          loading={genPhase !== null}
          disabled={chatBusy || questions.length === 0 || !data.aiConfigured}
        >
          Compile into matching logic
        </Button>
        {saved && !dirty && <Badge tone="success">Notes saved</Badge>}
        {genPhase && (
          <Text as="span" variant="bodySm" tone="subdued">
            {genPhase}
          </Text>
        )}
      </InlineStack>
      {genError && (
        <Banner tone="critical" onDismiss={() => setGenError(null)}>
          {genError}
        </Banner>
      )}
      {review !== null && (
        <BlockStack gap="200">
          <TextField
            label="Compiled logic (editable)"
            multiline={8}
            maxHeight={320}
            value={review}
            onChange={(v) => {
              setActivated(false);
              setReview(v);
            }}
            autoComplete="off"
            helpText="This exact text becomes the instructions your quiz's AI ranker follows."
          />
          <InlineStack gap="200" blockAlign="end">
            <div style={{ minWidth: 240 }}>
              <Select
                label="Ranking mode"
                options={[
                  { label: "AI: ranks your whole catalog from this logic", value: "ai" },
                  { label: "Rules + AI: pins and rules win when they match", value: "hybrid" },
                ]}
                value={mode}
                onChange={(v) => {
                  setActivated(false);
                  setMode(v as "ai" | "hybrid");
                }}
              />
            </div>
            <Button variant="primary" onClick={activate} loading={activating} disabled={activated}>
              {activated ? "Saved" : "Save logic"}
            </Button>
          </InlineStack>
        </BlockStack>
      )}
    </BlockStack>
  );
}
