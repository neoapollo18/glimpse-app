// Check matches tab (Recommendation Logic Spec v2, wireframes S0-S3).
//
// Three columns on the Build skeleton (StudioShell), all new components so
// Build is untouched:
//   MatchesRail    — Overview first, then SCREENS with green/amber dots;
//                    Intro / Email capture / Results dimmed and inert.
//   MatchesCenter  — Overview (arrival) or one question's rule card.
//   MatchesChat    — Chat only, scoped to the selected question.
//
// Every answer shows ONE sentence; editing is available everywhere and
// required nowhere. Nothing on this tab ever disables Publish.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "@remix-run/react";
import { Button, Icon, Spinner } from "@shopify/polaris";
import { MergeIcon, MagicIcon } from "@shopify/polaris-icons";
import {
  appliesToLine,
  overviewCount,
  ruleKey,
  ruleNeedsLook,
  deriveMode,
  hasGlobalRules,
  type AnswerRule,
  type GlobalRules,
  type EmptyCombination,
} from "../../lib/answer-rules-shared";
import { StoreContextStrip, type CanvasTheme } from "./PreviewCanvas";

export interface MatchingData {
  rules: AnswerRule[];
  global: GlobalRules;
  needsDraft: boolean;
  stale: boolean;
  hasDisplayOnly: boolean;
  liveProductCount: number;
  emptyCombination: EmptyCombination | null;
  error: string | null;
}

export interface MatchQuestion {
  axisKey: string;
  prompt: string;
  options: Array<{ axisValueValue: string; label: string }>;
}

/** "overview" or a question's axisKey. */
export type MatchesSelection = string;

const FOCUS_CHAT_EVENT = "gleame:focus-matches-chat";

const linkButton: React.CSSProperties = {
  border: 0,
  background: "none",
  padding: 0,
  color: "#2C6ECB",
  fontWeight: 600,
  fontSize: "inherit",
  cursor: "pointer",
};

async function post(fields: Record<string, string>): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch("/app/api/answer-rules", { method: "POST", body: fd });
  return res.json().catch(() => ({ ok: false, error: "Something went wrong" }));
}

function fireEvent(event: string, properties: Record<string, unknown> = {}) {
  const fd = new FormData();
  fd.append("event", event);
  fd.append("properties", JSON.stringify(properties));
  void fetch("/app/api/overhaul-event", { method: "POST", body: fd }).catch(() => {});
}

// ---------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------

export function useMatchesState(matching: MatchingData | null, questions: MatchQuestion[]) {
  const revalidator = useRevalidator();
  const [rules, setRules] = useState<Map<string, AnswerRule & { resolving?: boolean }>>(new Map());
  const [global, setGlobal] = useState<GlobalRules>({ always: [], never: [] });
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const draftedOnce = useRef(false);
  const refreshedOnce = useRef(false);

  useEffect(() => {
    if (!matching) return;
    setRules(new Map(matching.rules.map((r) => [ruleKey(r.axisKey, r.axisValue), r])));
    setGlobal(matching.global);
  }, [matching]);

  // Gleame drafts every missing sentence itself (Spec 0.1). Never
  // overwrites: the server only fills answers without a row.
  useEffect(() => {
    if (!matching?.needsDraft || draftedOnce.current) return;
    draftedOnce.current = true;
    setDrafting(true);
    setDraftError(null);
    void post({ intent: "draft" }).then((d) => {
      setDrafting(false);
      if (!d?.ok) setDraftError(d?.error ?? "Couldn't write sentences");
      else revalidator.revalidate();
    });
  }, [matching?.needsDraft, revalidator]);

  // Catalog changed since sentences were resolved: re-resolve quietly.
  useEffect(() => {
    if (!matching?.stale || refreshedOnce.current) return;
    refreshedOnce.current = true;
    void post({ intent: "refresh" }).then((d) => {
      if (d?.ok && d.refreshed > 0) revalidator.revalidate();
    });
  }, [matching?.stale, revalidator]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const saveSentence = useCallback(
    async (axisKey: string, axisValue: string, sentence: string) => {
      const k = ruleKey(axisKey, axisValue);
      const prev = rules.get(k);
      if (prev && prev.sentence === sentence && prev.active) return;
      setRules((m) => {
        const next = new Map(m);
        next.set(k, {
          axisKey,
          axisValue,
          sentence,
          mode: deriveMode(sentence),
          resolved: prev?.resolved ?? null,
          status: prev?.status ?? "empty",
          source: "edited",
          active: true,
          updatedAt: null,
          resolving: true,
        });
        return next;
      });
      const d = await post({ intent: "save", axisKey, axisValue, sentence });
      if (d?.ok && d.rule) {
        setRules((m) => new Map(m).set(k, d.rule));
        revalidator.revalidate(); // re-runs the combination check
      } else {
        setRules((m) => {
          const next = new Map(m);
          if (prev) next.set(k, prev);
          else next.delete(k);
          return next;
        });
        setToast({ text: d?.error ?? "Couldn't save that sentence" });
      }
    },
    [rules, revalidator],
  );

  const setGlobalRules = useCallback(
    async (next: GlobalRules, label: string) => {
      const before = global;
      setGlobal(next);
      const d = await post({ intent: "set-global", global: JSON.stringify(next) });
      if (!d?.ok) {
        setGlobal(before);
        setToast({ text: d?.error ?? "Couldn't update that rule" });
        return;
      }
      revalidator.revalidate();
      setToast({
        text: label,
        undo: async () => {
          setGlobal(before);
          const u = await post({ intent: "set-global", global: JSON.stringify(before) });
          if (!u?.ok) {
            setGlobal(next);
            setToast({ text: u?.error ?? "Couldn't undo that change" });
          }
          revalidator.revalidate();
        },
      });
    },
    [global, revalidator],
  );

  const ruleFor = useCallback((axisKey: string, axisValue: string) => rules.get(ruleKey(axisKey, axisValue)), [rules]);

  const questionNeedsLook = useCallback(
    (q: MatchQuestion) =>
      q.options.some((o) => {
        const r = rules.get(ruleKey(q.axisKey, o.axisValueValue));
        return !r || ruleNeedsLook(r);
      }),
    [rules],
  );

  return {
    rules,
    global,
    drafting,
    draftError,
    toast,
    setToast,
    saveSentence,
    setGlobalRules,
    ruleFor,
    questionNeedsLook,
    revalidate: () => revalidator.revalidate(),
    questions,
  };
}

export type MatchesState = ReturnType<typeof useMatchesState>;

// ---------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------

function Dot({ amber }: { amber: boolean }) {
  return (
    <span
      aria-label={amber ? "Needs a look" : "Checked"}
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: amber ? "#E3A008" : "#1A8A4F",
        flexShrink: 0,
        marginLeft: "auto",
      }}
    />
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        background: "#F1F1F1",
        color: "#6D7175",
        fontSize: 11,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

const railHeader: React.CSSProperties = {
  padding: "10px 8px 4px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#8A8F98",
};

export function MatchesRail({
  state,
  selection,
  onSelect,
  onFlowMap,
}: {
  state: MatchesState;
  selection: MatchesSelection;
  onSelect: (s: MatchesSelection) => void;
  onFlowMap: () => void;
}) {
  const inert = (label: string) => (
    <div className="studio-tree-row" aria-disabled style={{ opacity: 0.45, cursor: "default", pointerEvents: "none" }}>
      <Chip>·</Chip>
      <span className="studio-rail-wide" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </div>
  );
  const item = (id: string, label: string, chip: React.ReactNode, dot?: boolean) => (
    <div
      key={id}
      role="button"
      tabIndex={0}
      className="studio-tree-row"
      data-selected={selection === id}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      {chip}
      <span className="studio-rail-wide" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {dot !== undefined && <Dot amber={dot} />}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: "8px 8px 8px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {item("overview", "Overview", <Chip>◎</Chip>)}
        <div className="studio-rail-wide" style={railHeader}>
          Screens
        </div>
        {inert("Intro")}
        {state.questions.map((q, i) =>
          item(q.axisKey, q.prompt || `Question ${i + 1}`, <Chip>{String(i + 1)}</Chip>, state.questionNeedsLook(q)),
        )}
        {inert("Email capture")}
        {inert("Results")}
      </div>
      <div style={{ borderTop: "1px solid #E1E3E5", padding: 8 }}>
        <div role="button" tabIndex={0} className="studio-tree-row" onClick={onFlowMap}>
          <span style={{ width: 14, height: 14, display: "inline-flex" }}>
            <Icon source={MergeIcon} tone="subdued" />
          </span>
          <span className="studio-rail-wide">Flow map</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sentence field (resting / editing / empty)
// ---------------------------------------------------------------------

function SentenceField({
  value,
  onCommit,
  compact,
  neutral,
}: {
  value: string;
  onCommit: (v: string) => void;
  compact?: boolean;
  neutral?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
  }, [editing]);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [draft, editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.replace(/\s+/g, " ").trim();
    if (v !== value.trim()) onCommit(v);
  };
  const base: React.CSSProperties = {
    width: "100%",
    borderRadius: 8,
    fontSize: compact ? 13 : 14,
    lineHeight: 1.5,
    fontFamily: "inherit",
    background: "#fff",
    boxSizing: "border-box",
    textAlign: "left",
  };
  if (editing) {
    return (
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        maxLength={160}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        style={{ ...base, border: "2px solid #1a1a1a", padding: compact ? "5px 9px" : "9px 12px", resize: "none", overflow: "hidden", outline: "none" }}
      />
    );
  }
  const empty = !value.trim();
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        ...base,
        border: compact ? "1px solid transparent" : "1px solid #D4D6DA",
        padding: compact ? "6px 10px" : "10px 13px",
        cursor: "text",
        color: empty ? "#9A9EA5" : neutral ? "#6D7175" : "#1F2328",
      }}
      onMouseEnter={(e) => compact && (e.currentTarget.style.borderColor = "#D4D6DA")}
      onMouseLeave={(e) => compact && (e.currentTarget.style.borderColor = "transparent")}
    >
      {empty ? 'No sentence yet — Gleame will treat this answer as "no preference."' : value}
    </button>
  );
}

function AppliesTo({ rule }: { rule: (AnswerRule & { resolving?: boolean }) | undefined }) {
  if (rule?.resolving) {
    return (
      <div style={{ fontSize: 11.5, color: "#6D7175", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <Spinner size="small" accessibilityLabel="" /> Resolving…
      </div>
    );
  }
  const line = appliesToLine(rule ?? { sentence: "", mode: "none", resolved: null, status: "empty" });
  return <div style={{ fontSize: 11.5, color: line.amber ? "#B7791F" : "#6D7175", marginTop: 6 }}>{line.text}</div>;
}

// ---------------------------------------------------------------------
// Center: Overview + rule card
// ---------------------------------------------------------------------

export function MatchesCenter({
  state,
  matching,
  selection,
  onSelect,
  theme,
  onPublish,
}: {
  state: MatchesState;
  matching: MatchingData | null;
  selection: MatchesSelection;
  onSelect: (s: MatchesSelection) => void;
  theme: CanvasTheme;
  onPublish: () => void;
}) {
  const q = state.questions.find((x) => x.axisKey === selection) ?? null;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#fff", display: "flex", flexDirection: "column" }}>
      <StoreContextStrip theme={theme} />
      <div style={{ flex: 1, padding: "36px 32px 60px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
        {q ? (
          <RuleCard state={state} question={q} index={state.questions.indexOf(q)} onSelect={onSelect} />
        ) : (
          <Overview state={state} matching={matching} onSelect={onSelect} onPublish={onPublish} />
        )}
      </div>
      {state.toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "#1a1a1a",
            color: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            display: "flex",
            gap: 14,
            alignItems: "center",
            zIndex: 60,
            boxShadow: "0 8px 24px rgba(0,0,0,.2)",
          }}
        >
          <span>{state.toast.text}</span>
          {state.toast.undo && (
            <button
              type="button"
              onClick={() => {
                const u = state.toast?.undo;
                state.setToast(null);
                void u?.();
              }}
              style={{ background: "none", border: 0, color: "#9AB8FF", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Overview({
  state,
  matching,
  onSelect,
  onPublish,
}: {
  state: MatchesState;
  matching: MatchingData | null;
  onSelect: (s: MatchesSelection) => void;
  onPublish: () => void;
}) {
  const viewed = useRef(false);
  const answerCount = state.questions.reduce((n, q) => n + q.options.length, 0);
  const needsLook = state.questions.flatMap((q) =>
    q.options
      .filter((o) => {
        const r = state.ruleFor(q.axisKey, o.axisValueValue);
        return !r || ruleNeedsLook(r);
      })
      .map(() => q.axisKey),
  );
  const combo = matching?.emptyCombination ?? null;
  useEffect(() => {
    if (viewed.current || !matching || state.drafting) return;
    viewed.current = true;
    fireEvent("overview_viewed", { amber_count: needsLook.length, empty_paths: combo ? 1 : 0 });
  }, [matching, state.drafting, needsLook.length, combo]);

  const amber = !state.drafting && (needsLook.length > 0 || combo !== null);
  let title = "Ready to publish";
  let sub: React.ReactNode = `Gleame checked ${answerCount} answer${answerCount === 1 ? "" : "s"} against your catalog. Nothing needs you.`;
  if (state.drafting) {
    title = "Writing your matching logic";
    sub = "Gleame is writing one sentence for every answer from your catalog. This takes a moment.";
  } else if (combo) {
    title = "One combination returns nothing";
    sub = (
      <>
        {combo.labels.join(" + ")} — two "only" sentences don't overlap.{" "}
        <button type="button" onClick={() => onSelect(combo.culpritAxisKey)} style={linkButton}>
          Loosen "only" on Q{combo.culpritIndex} →
        </button>{" "}
        You can still publish.
      </>
    );
  } else if (needsLook.length > 0) {
    title = `${needsLook.length} answer${needsLook.length === 1 ? " needs" : "s need"} a look`;
    sub = (
      <>
        Gleame couldn't match {needsLook.length === 1 ? "it" : "them"} to your catalog.{" "}
        <button type="button" onClick={() => onSelect(needsLook[0])} style={linkButton}>
          Take a look →
        </button>{" "}
        You can still publish.
      </>
    );
  }

  // Never items are keyed by (kind, id): a tag and a type can share a name.
  const removeGlobal = (list: "always" | "never", id: string, label: string, kind?: string) => {
    const sameItem = (x: { id: string; kind?: string }) => x.id === id && (x.kind ?? "product") === (kind ?? "product");
    const next: GlobalRules = {
      always: list === "always" ? state.global.always.filter((x) => x.id !== id) : state.global.always,
      never: list === "never" ? state.global.never.filter((x) => !sameItem(x)) : state.global.never,
    };
    void state.setGlobalRules(next, `Removed: ${list} show ${label}`);
  };

  return (
    <div style={{ width: "100%", maxWidth: 720 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          border: `1px solid ${amber ? "#F0DCA0" : state.drafting ? "#E1E3E5" : "#CFE9D9"}`,
          background: amber ? "#FFF6E0" : state.drafting ? "#FAFAFA" : "#F1FAF4",
          borderRadius: 10,
          marginBottom: 22,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 99,
            background: amber ? "#E3A21A" : state.drafting ? "transparent" : "#1A8A4F",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            flex: "none",
          }}
        >
          {state.drafting ? <Spinner size="small" accessibilityLabel="" /> : amber ? "!" : "✓"}
        </span>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontWeight: 600, fontSize: 14, display: "block" }}>{title}</b>
          <span style={{ fontSize: 12.5, color: "#6D7175" }}>{sub}</span>
        </div>
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <Button variant="primary" onClick={onPublish}>
            Publish
          </Button>
        </div>
      </div>

      {state.draftError && (
        <p style={{ fontSize: 12.5, color: "#B7791F", margin: "-10px 0 16px" }}>{state.draftError}</p>
      )}
      {matching?.error && (
        <p style={{ fontSize: 12.5, color: "#B7791F", margin: "-10px 0 16px" }}>Couldn't load matching: {matching.error}</p>
      )}
      {matching?.hasDisplayOnly && !state.drafting && (
        <p style={{ fontSize: 12.5, color: "#6D7175", margin: "-10px 0 16px" }}>
          Your quiz keeps its existing matching. These sentences describe it; one starts steering results once you edit it.
        </p>
      )}

      {hasGlobalRules(state.global) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            fontSize: 13,
            padding: "10px 14px",
            border: "1px solid #E1E3E5",
            borderRadius: 10,
            marginBottom: 18,
          }}
        >
          <span style={{ color: "#6D7175" }}>Every result ·</span>
          {state.global.always.length > 0 && <span style={{ fontWeight: 500 }}>Always:</span>}
          {state.global.always.map((a) => (
            <RuleChip key={`a-${a.id}`} label={a.label} onRemove={() => removeGlobal("always", a.id, a.label)} />
          ))}
          {state.global.never.length > 0 && <span style={{ fontWeight: 500, marginLeft: 6 }}>Never:</span>}
          {state.global.never.map((n) => (
            <RuleChip key={`n-${n.kind}-${n.id}`} label={n.label} onRemove={() => removeGlobal("never", n.id, n.label, n.kind)} />
          ))}
        </div>
      )}

      {state.questions.map((q, i) => {
        const culprit = combo?.culpritAxisKey === q.axisKey;
        return (
          <div
            key={q.axisKey}
            style={{ border: `1px solid ${culprit ? "#E3A21A" : "#E6E7EA"}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(q.axisKey)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(q.axisKey)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 14px",
                background: "#FAFAFA",
                borderBottom: "1px solid #E6E7EA",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 99,
                  background: "#EEF0F2",
                  color: "#6D7175",
                  fontSize: 10.5,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {i + 1}
              </span>
              {q.prompt}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#2C6ECB", fontWeight: 600 }}>Edit →</span>
            </div>
            {q.options.map((o, oi) => {
              const r = state.ruleFor(q.axisKey, o.axisValueValue);
              const count = r?.resolving
                ? { text: "Resolving…", amber: false }
                : overviewCount(r ?? { sentence: "", mode: "none", resolved: null, status: "empty" });
              return (
                <div
                  key={o.axisValueValue}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px minmax(0,1fr) 120px",
                    gap: 12,
                    padding: "5px 14px",
                    borderTop: oi === 0 ? "none" : "1px solid #E6E7EA",
                    fontSize: 13,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{o.label}</span>
                  {state.drafting && !r ? (
                    <span style={{ color: "#9A9EA5", padding: "6px 10px" }}>Writing…</span>
                  ) : (
                    <SentenceField
                      compact
                      value={r?.sentence ?? ""}
                      neutral={r?.mode === "none"}
                      onCommit={(v) => void state.saveSentence(q.axisKey, o.axisValueValue, v)}
                    />
                  )}
                  <span style={{ textAlign: "right", fontSize: 11.5, color: count.amber ? "#B7791F" : "#6D7175" }}>
                    {count.text}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function RuleChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid #D4D6DA",
        borderRadius: 99,
        padding: "3px 8px 3px 10px",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        style={{ border: 0, background: "none", color: "#9A9EA5", cursor: "pointer", fontSize: 13, padding: 0 }}
      >
        ✕
      </button>
    </span>
  );
}

function RuleCard({
  state,
  question,
  index,
  onSelect,
}: {
  state: MatchesState;
  question: MatchQuestion;
  index: number;
  onSelect: (s: MatchesSelection) => void;
}) {
  useEffect(() => {
    fireEvent("rule_viewed", { question_id: question.axisKey });
  }, [question.axisKey]);
  const total = state.questions.length;
  const next = state.questions[index + 1];
  return (
    <div style={{ width: "100%", maxWidth: 640 }}>
      <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 6 }}>
        Question {index + 1} of {total}
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", margin: "0 0 6px" }}>{question.prompt}</h2>
      <div style={{ fontSize: 13.5, color: "#6D7175", marginBottom: 18 }}>
        When a shopper picks an answer, here's what Gleame will do. Click a sentence to change it.
      </div>
      {question.options.map((o, oi) => {
        const r = state.ruleFor(question.axisKey, o.axisValueValue);
        return (
          <div
            key={o.axisValueValue}
            style={{
              display: "grid",
              gridTemplateColumns: "120px minmax(0,1fr)",
              gap: 16,
              alignItems: "start",
              padding: "16px 0",
              borderTop: "1px solid #E6E7EA",
              borderBottom: oi === question.options.length - 1 ? "1px solid #E6E7EA" : undefined,
            }}
          >
            <div style={{ fontWeight: 500, paddingTop: 10, fontSize: 14 }}>{o.label}</div>
            <div>
              {state.drafting && !r ? (
                <div style={{ fontSize: 14, color: "#9A9EA5", padding: "10px 13px", border: "1px solid #E6E7EA", borderRadius: 8 }}>
                  Writing…
                </div>
              ) : (
                <SentenceField
                  value={r?.sentence ?? ""}
                  neutral={r?.mode === "none"}
                  onCommit={(v) => void state.saveSentence(question.axisKey, o.axisValueValue, v)}
                />
              )}
              <AppliesTo rule={r} />
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22 }}>
        <Button onClick={() => onSelect("overview")}>← Overview</Button>
        <Button variant="primary" size="large" onClick={() => onSelect(next ? next.axisKey : "overview")}>
          Next →
        </Button>
        <span style={{ marginLeft: "auto" }}>
          <Button icon={MagicIcon} onClick={() => window.dispatchEvent(new Event(FOCUS_CHAT_EVENT))}>
            Tell Gleame what's wrong
          </Button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Chat (right rail)
// ---------------------------------------------------------------------

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  undos?: Array<{ label: string; run: () => Promise<void> }>;
  undone?: boolean;
}

export function MatchesChat({
  state,
  selection,
  aiConfigured,
}: {
  state: MatchesState;
  selection: MatchesSelection;
  aiConfigured: boolean;
}) {
  const scopeQuestion = state.questions.find((q) => q.axisKey === selection) ?? null;
  const scopeKey = scopeQuestion?.axisKey ?? "overview";
  const [threads, setThreads] = useState<Record<string, ChatMsg[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const thread = useMemo(() => threads[scopeKey] ?? [], [threads, scopeKey]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(FOCUS_CHAT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_CHAT_EVENT, focus);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.length]);

  const push = (key: string, msg: ChatMsg) => setThreads((t) => ({ ...t, [key]: [...(t[key] ?? []), msg] }));

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const key = scopeKey;
    setInput("");
    push(key, { role: "user", text });
    setBusy(true);
    const history = (threads[key] ?? []).map((m) => ({ role: m.role, text: m.text }));
    const d = await post({
      intent: "chat",
      message: text,
      scope: scopeQuestion?.axisKey ?? "",
      history: JSON.stringify(history),
    });
    setBusy(false);
    if (!d?.ok) {
      push(key, { role: "assistant", text: d?.error ?? "Something went wrong. Try again." });
      return;
    }
    const undos = (d.changes ?? []).map((c: any) => ({
      label: c.description as string,
      run: async () => {
        const r =
          c.undo?.kind === "rules"
            ? await post({ intent: "undo-rules", undo: JSON.stringify(c.undo.rules) })
            : c.undo?.kind === "global"
              ? await post({ intent: "set-global", global: JSON.stringify(c.undo.global) })
              : { ok: true };
        if (!r?.ok) throw new Error(r?.error ?? "Couldn't undo that change");
      },
    }));
    push(key, { role: "assistant", text: d.reply, undos });
    if (undos.length) {
      state.revalidate();
      state.setToast({ text: undos.map((u: { label: string }) => u.label).join(" · ") });
    }
  };

  const undoMessage = async (idx: number) => {
    const msg = thread[idx];
    if (!msg?.undos || msg.undone) return;
    // Undo newest-first so overlapping changes restore in order. A failed
    // step stops the undo and leaves the message undoable, never "Undone".
    try {
      for (const u of [...msg.undos].reverse()) await u.run();
    } catch (e) {
      state.setToast({ text: (e as Error).message });
      state.revalidate();
      return;
    }
    setThreads((t) => ({
      ...t,
      [scopeKey]: (t[scopeKey] ?? []).map((m, i) => (i === idx ? { ...m, undone: true } : m)),
    }));
    state.revalidate();
  };

  const placeholder = scopeQuestion ? "Describe what's wrong with these…" : 'Tell Gleame what to change — e.g. "always show Pasión"';

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="studio-panel-tabs">
        <button className="studio-panel-tab" data-active="true" type="button">
          Chat
        </button>
      </div>
      <div style={{ padding: "12px 16px", fontSize: 12.5, color: "#6D7175", borderBottom: "1px solid #E1E3E5" }}>
        Every change has an Undo. · Talking about{" "}
        <b style={{ color: "#202223", fontWeight: 600 }}>{scopeQuestion ? scopeQuestion.prompt : "the whole quiz"}</b>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {thread.length === 0 ? (
          <div style={{ margin: "auto", textAlign: "center", color: "#6D7175", fontSize: 13, lineHeight: 1.5, padding: 16 }}>
            <b style={{ display: "block", color: "#202223", fontSize: 14, marginBottom: 4 }}>
              {scopeQuestion ? "Fix a sentence" : "Anything off?"}
            </b>
            {scopeQuestion
              ? "Describe what's wrong and Gleame will rewrite the sentences for this question."
              : 'Tell Gleame what to change — a sentence, or a rule for every result like "never show gift cards."'}
          </div>
        ) : (
          thread.map((m, i) => (
            <div
              key={i}
              style={{
                maxWidth: "92%",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? "#1a1a1a" : "#F2F2F4",
                color: m.role === "user" ? "#fff" : "#202223",
                padding: "10px 13px",
                borderRadius: 12,
                fontSize: 13.5,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.text}
              {m.undos && m.undos.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {m.undone ? (
                    <span style={{ fontSize: 12, color: "#6D7175" }}>Undone</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void undoMessage(i)}
                      style={{ border: 0, background: "none", padding: 0, color: "#2C6ECB", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {busy && <div className="studio-thinking">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid #E1E3E5", display: "flex", gap: 8 }}>
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          disabled={!aiConfigured}
          placeholder={aiConfigured ? placeholder : "AI isn't configured for this store."}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          style={{
            flex: 1,
            border: "1px solid #D4D6DA",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: 13.5,
            fontFamily: "inherit",
            resize: "none",
          }}
        />
        <Button variant={input.trim() ? "primary" : "secondary"} onClick={() => void send()} loading={busy} disabled={!input.trim() || !aiConfigured}>
          Send
        </Button>
      </div>
    </div>
  );
}
