import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Select,
  Button,
  Badge,
  Banner,
  Collapsible,
  Popover,
  Box,
  Spinner,
  Divider,
} from "@shopify/polaris";
import { XSmallIcon } from "@shopify/polaris-icons";
import type { StudioLoaderData, StudioTab, StudioActionData } from "../../routes/studio";
import { IntroEditor, LeadEditor, PhotoEditor, ResultsEditor, ThemeEditor } from "./SettingsEditors";
import type { StudioFlow, StudioQuestion, StudioOption } from "./types";
import { answerLabel } from "./types";
import { slideIdForQuestion } from "./SlideTree";
import { postStudioAction } from "./studio-data";

// Right panel: Edit | Chat tabs. Edit renders the contextual editor for the
// selected slide; every manual edit goes through the SAME appliers the AI
// copilot uses (apply-tool intent), so validation is shared and the preview
// hot-swaps via gleame-preview-update without an iframe reload.

const OPTION_STYLE_CHOICES = [
  { label: "Auto: match the options' content (default)", value: "" },
  { label: "Pill chips", value: "chips" },
  { label: "Boxed cards", value: "boxed" },
  { label: "List rows", value: "list" },
  { label: "Image cards", value: "visual" },
  { label: "Rich cards", value: "rich" },
  { label: "Two-tone swatch cards", value: "vibe" },
];

function slugify(text: string, taken: Set<string>): string {
  let base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (!base) base = "option";
  else if (/^[0-9]/.test(base)) base = `o_${base}`;
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

export function EditPanel({
  data,
  step,
  selectedSlide,
  chatEpoch,
  chatBusy,
  onSelectSlide,
  onDeleteQuestion,
  onPreviewUpdate,
  onPreviewReload,
  registerFlush,
  flushEditor,
  onSaveError,
  onOpenTemplateOverlay,
  chat,
}: {
  data: StudioLoaderData;
  step: StudioTab;
  selectedSlide: string;
  chatEpoch: number;
  chatBusy: boolean;
  onSelectSlide: (slideId: string) => void;
  onDeleteQuestion?: (axisKey: string, fallbackSlide: string) => void;
  onPreviewUpdate: (payload: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
  registerFlush?: (fn: (() => void) | null) => void;
  flushEditor?: () => void;
  onSaveError?: (message: string) => void;
  onOpenTemplateOverlay?: () => void;
  chat: React.ReactNode;
}) {
  const editHidden = step !== "build";
  const [tab, setTab] = useState<"edit" | "chat">("edit");
  const activeTab = editHidden ? "chat" : tab;

  return (
    <>
      <div className="studio-panel-tabs">
        {!editHidden && (
          <button className="studio-panel-tab" data-active={activeTab === "edit"} onClick={() => setTab("edit")}>
            Edit
          </button>
        )}
        <button
          className="studio-panel-tab"
          data-active={activeTab === "chat"}
          onClick={() => {
            // Deliver pending debounced edits BEFORE unmounting the editor;
            // the flush revalidates on success so the save is never reverted
            // by a later stale autosave.
            if (activeTab === "edit") flushEditor?.();
            setTab("chat");
          }}
          style={editHidden ? { flex: "unset", width: "100%" } : undefined}
        >
          Chat
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: activeTab === "chat" ? "flex" : "none", flexDirection: "column" }}>
        {chat}
      </div>
      {activeTab === "edit" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
          <EditBody
            data={data}
            selectedSlide={selectedSlide}
            chatEpoch={chatEpoch}
            chatBusy={chatBusy}
            onSelectSlide={onSelectSlide}
            onDeleteQuestion={onDeleteQuestion}
            onPreviewUpdate={onPreviewUpdate}
            onPreviewReload={onPreviewReload}
            registerFlush={registerFlush}
            onSaveError={onSaveError}
            onOpenTemplateOverlay={onOpenTemplateOverlay}
          />
        </div>
      )}
    </>
  );
}

function EditBody({
  data,
  selectedSlide,
  chatEpoch,
  chatBusy,
  onSelectSlide,
  onDeleteQuestion,
  onPreviewUpdate,
  onPreviewReload,
  registerFlush,
  onSaveError,
  onOpenTemplateOverlay,
}: {
  data: StudioLoaderData;
  selectedSlide: string;
  chatEpoch: number;
  chatBusy: boolean;
  onSelectSlide: (slideId: string) => void;
  onDeleteQuestion?: (axisKey: string, fallbackSlide: string) => void;
  onPreviewUpdate: (payload: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
  registerFlush?: (fn: (() => void) | null) => void;
  onSaveError?: (message: string) => void;
  onOpenTemplateOverlay?: () => void;
}) {
  const flow = data.draft?.flow as StudioFlow | undefined;
  if (!flow) {
    return (
      <Text as="p" tone="subdued">
        No draft loaded.
      </Text>
    );
  }
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  if (selectedSlide === "intro") {
    return (
      <IntroEditor key={`intro:${chatEpoch}`} settings={settings} chatBusy={chatBusy} onPreviewUpdate={onPreviewUpdate} />
    );
  }
  if (selectedSlide === "lead") {
    return (
      <LeadEditor key={`lead:${chatEpoch}`} settings={settings} chatBusy={chatBusy} onPreviewUpdate={onPreviewUpdate} />
    );
  }
  if (selectedSlide === "photo") {
    return (
      <PhotoEditor key={`photo:${chatEpoch}`} settings={settings} chatBusy={chatBusy} onPreviewUpdate={onPreviewUpdate} />
    );
  }
  if (selectedSlide === "results") {
    return (
      <ResultsEditor key={`results:${chatEpoch}`} settings={settings} chatBusy={chatBusy} onPreviewUpdate={onPreviewUpdate} />
    );
  }
  if (selectedSlide === "theme") {
    return (
      <ThemeEditor
        key={`theme:${chatEpoch}`}
        settings={settings}
        chatBusy={chatBusy}
        onPreviewUpdate={onPreviewUpdate}
        onOpenTemplateOverlay={onOpenTemplateOverlay}
      />
    );
  }
  if (selectedSlide === "images") {
    return (
      <Text as="p" tone="subdued">
        Every image slot the current template uses is listed in the Images
        rail on the left. Pick Change on a slot to swap it from your brand
        library.
      </Text>
    );
  }
  const question = flow.questions.find((q) => slideIdForQuestion(q.axisKey) === selectedSlide);
  if (!question) {
    return (
      <Text as="p" tone="subdued">
        Pick a slide to edit.
      </Text>
    );
  }
  return (
    <QuestionEditor
      key={`${question.axisKey}:${chatEpoch}`}
      flow={flow}
      question={question}
      chatBusy={chatBusy}
      onSelectSlide={onSelectSlide}
      onDeleteQuestion={onDeleteQuestion}
      onPreviewUpdate={onPreviewUpdate}
      onPreviewReload={onPreviewReload}
      registerFlush={registerFlush}
      onSaveError={onSaveError}
    />
  );
}

// ---------------------------------------------------------------------
// Question editor
// ---------------------------------------------------------------------

interface LocalOption extends StudioOption {}

function QuestionEditor({
  flow,
  question,
  chatBusy,
  onSelectSlide,
  onDeleteQuestion,
  onPreviewUpdate,
  onPreviewReload,
  registerFlush,
  onSaveError,
}: {
  flow: StudioFlow;
  question: StudioQuestion;
  chatBusy: boolean;
  onSelectSlide: (slideId: string) => void;
  onDeleteQuestion?: (axisKey: string, fallbackSlide: string) => void;
  onPreviewUpdate: (payload: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
  registerFlush?: (fn: (() => void) | null) => void;
  onSaveError?: (message: string) => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const branchFetcher = useFetcher<StudioActionData>();
  const revalidator = useRevalidator();

  const [prompt, setPrompt] = useState(question.prompt);
  const [helper, setHelper] = useState(question.helperText ?? "");
  const [multiSelect, setMultiSelect] = useState(question.multiSelect ?? false);
  const [maxPicks, setMaxPicks] = useState(question.maxSelections != null ? String(question.maxSelections) : "");
  const [optionStyle, setOptionStyle] = useState(question.optionStyle ?? "");
  const [screenGroup, setScreenGroup] = useState(question.screenGroup ?? "");
  const [options, setOptions] = useState<LocalOption[]>(question.options.map((o) => ({ ...o })));
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(Boolean(question.showIf));
  const [showIf, setShowIf] = useState(question.showIf ?? null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  // Debounced autosave. Two tool payloads: question patch + options list.
  const dirtyRef = useRef<{ question: boolean; options: boolean }>({ question: false, options: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ prompt, helper, multiSelect, maxPicks, optionStyle, screenGroup, showIf, options });
  stateRef.current = { prompt, helper, multiSelect, maxPicks, optionStyle, screenGroup, showIf, options };

  const buildCalls = (): Array<{ tool: string; input: unknown }> => {
    const s = stateRef.current;
    const dirty = dirtyRef.current;
    const calls: Array<{ tool: string; input: unknown }> = [];
    const max = s.maxPicks.trim() === "" ? null : Number(s.maxPicks);
    if (dirty.question) {
      calls.push({
        tool: "update_question",
        input: {
          axisKey: question.axisKey,
          patch: {
            prompt: s.prompt,
            helperText: s.helper.trim() === "" ? null : s.helper,
            multiSelect: s.multiSelect,
            maxSelections: s.multiSelect && Number.isFinite(max as number) ? max : null,
            optionStyle: s.optionStyle || null,
            screenGroup: s.screenGroup.trim() === "" ? null : s.screenGroup.trim(),
            showIf: s.showIf,
          },
        },
      });
    }
    if (dirty.options) {
      calls.push({
        tool: "update_question_options",
        input: {
          axisKey: question.axisKey,
          options: s.options.map((o) => ({
            label: o.label,
            axisValueValue: o.axisValueValue,
            // Keeps auto-declared axis values labeled like their answer.
            valueLabel: o.label,
            reasonText: o.reasonText ?? null,
            imageUrl: o.imageUrl ?? null,
            showIf: o.showIf ?? null,
            selectAll: o.selectAll ?? false,
            displayMeta: o.displayMeta ?? null,
          })),
        },
      });
    }
    return calls;
  };

  const flush = () => {
    // Never resubmit a busy fetcher: the resubmit aborts the in-flight
    // request and its payload (already cleared from dirtyRef) is silently
    // dropped while the UI shows "Saved". Leave the dirty flags set; the
    // idle effect below drains them once the fetcher settles.
    if (fetcher.state !== "idle") return; // drained on idle effect below
    const calls = buildCalls();
    if (calls.length === 0) return;
    dirtyRef.current = { question: false, options: false };
    // ONE submission per flush: two back-to-back fetcher.submit calls abort
    // the first request and silently dropped the question patch.
    const fd = new FormData();
    fd.append("intent", "apply-tools");
    fd.append("calls", JSON.stringify(calls));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
  };

  // Delivery path for flushes that may outlive this component: slide/step
  // switches unmount the editor before its fetcher could report back, and
  // the router swallows unmounted fetchers' errors, so a rejected save was
  // silently reverted with no feedback. Raw fetch instead: the response is
  // parsed regardless of mount state, rejections surface through the
  // studio-owned onSaveError banner, and a successful save revalidates so
  // the next mount reads the saved draft (not a stale loader snapshot that
  // a later autosave would flush back over it).
  const deliverCalls = (calls: Array<{ tool: string; input: unknown }>) => {
    const fd = new FormData();
    fd.append("intent", "apply-tools");
    fd.append("calls", JSON.stringify(calls));
    postStudioAction(fd)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as StudioActionData | null;
        if (body?.ok) {
          if (body.previewFlow || body.previewConfig) {
            onPreviewUpdate({ flow: body.previewFlow, config: body.previewConfig });
          }
          setSaveState("saved");
          revalidator.revalidate();
        } else {
          setSaveState("idle");
          onSaveError?.(body?.error ?? "Couldn't save your last change. Please try again.");
        }
      })
      .catch(() => {
        setSaveState("idle");
        onSaveError?.("Couldn't save your last change. Check your connection and try again.");
      });
  };

  // Slide/step switches call this through the studio registry so pending
  // debounced edits are delivered BEFORE unmount (the unmount effect below
  // stays as a backstop for modal close).
  useEffect(() => {
    registerFlush?.(() => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const calls = buildCalls();
      if (calls.length === 0) return;
      dirtyRef.current = { question: false, options: false };
      deliverCalls(calls);
    });
    return () => registerFlush?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerFlush]);

  const scheduleSave = (kind: "question" | "options") => {
    dirtyRef.current[kind] = true;
    setSaveState("saving");
    setError(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  };
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      // Deliver anything still pending: unmounting inside the debounce
      // window (or with edits queued behind an in-flight submit) must not
      // silently drop edits. The fetcher is gone with the component, so
      // this rides the raw-fetch path, which also reports rejections.
      const calls = buildCalls();
      if (calls.length > 0) {
        dirtyRef.current = { question: false, options: false };
        deliverCalls(calls);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const processedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (fetcher.data.ok) {
      if (fetcher.data.previewFlow || fetcher.data.previewConfig) {
        onPreviewUpdate({ flow: fetcher.data.previewFlow, config: fetcher.data.previewConfig });
      }
    } else if (fetcher.data.error) {
      setError(fetcher.data.error);
    }
    // Drain edits that went dirty while this submit was in flight (flush
    // refuses to resubmit a busy fetcher).
    if (dirtyRef.current.question || dirtyRef.current.options) {
      flush();
    } else {
      setSaveState(fetcher.data.ok ? "saved" : "idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, onPreviewUpdate]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  // Delete is handled by the studio route (onDeleteQuestion): the
  // revalidation after a successful delete unmounts this editor, so a
  // local fetcher effect could never reliably run its completion.

  // Branch popover writes to OTHER questions and needs a full refresh.
  const branchProcessedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (branchFetcher.state !== "idle" || !branchFetcher.data) return;
    if (branchProcessedRef.current === branchFetcher.data) return;
    branchProcessedRef.current = branchFetcher.data;
    if (branchFetcher.data.ok && (branchFetcher.data.previewFlow || branchFetcher.data.previewConfig)) {
      onPreviewUpdate({ flow: branchFetcher.data.previewFlow, config: branchFetcher.data.previewConfig });
    } else if (branchFetcher.data.error) {
      setError(branchFetcher.data.error);
    }
  }, [branchFetcher.state, branchFetcher.data, onPreviewUpdate]);

  const earlier = useMemo(() => {
    const idx = flow.questions.findIndex((q) => q.axisKey === question.axisKey);
    return flow.questions.slice(0, idx);
  }, [flow.questions, question.axisKey]);
  const later = useMemo(() => {
    const idx = flow.questions.findIndex((q) => q.axisKey === question.axisKey);
    return flow.questions.slice(idx + 1);
  }, [flow.questions, question.axisKey]);

  const disabled = chatBusy;
  const qIndex = flow.questions.findIndex((q) => q.axisKey === question.axisKey);

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h3" variant="headingMd">
          Question {qIndex + 1}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          {saveState === "saving" && (
            <InlineStack gap="100" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                Saving…
              </Text>
            </InlineStack>
          )}
          {saveState === "saved" && (
            <Text as="span" variant="bodySm" tone="subdued">
              Saved
            </Text>
          )}
          <Button
            variant="tertiary"
            tone="critical"
            size="micro"
            disabled={disabled || confirmingDelete}
            onClick={() => setConfirmingDelete(true)}
            accessibilityLabel="Delete question"
          >
            Delete
          </Button>
        </InlineStack>
      </InlineStack>

      {chatBusy && (
        <Banner tone="info">Gleame is making changes. Editing unlocks when it finishes.</Banner>
      )}
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {confirmingDelete && (
        <Banner tone="warning" title="Delete this question and its answers?">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              Shoppers will no longer be asked this question. This can't be
              undone.
            </Text>
            <InlineStack gap="200">
              <Button
                tone="critical"
                onClick={() => {
                  onDeleteQuestion?.(
                    question.axisKey,
                    qIndex > 0 ? slideIdForQuestion(flow.questions[qIndex - 1].axisKey) : "intro",
                  );
                  setConfirmingDelete(false);
                }}
              >
                Delete question
              </Button>
              <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}
      <TextField
        label="Question"
        value={prompt}
        onChange={(v) => {
          setPrompt(v);
          scheduleSave("question");
        }}
        placeholder="e.g. What's the occasion?"
        multiline={2}
        disabled={disabled}
        autoComplete="off"
        autoFocus={!question.prompt.trim()}
      />
      <TextField
        label="Helper text"
        value={helper}
        onChange={(v) => {
          setHelper(v);
          scheduleSave("question");
        }}
        placeholder="Optional line shown under the question"
        disabled={disabled}
        autoComplete="off"
      />

      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h4" variant="headingSm">
            Answers
          </Text>
          <Button
            variant="plain"
            size="micro"
            disabled={disabled}
            onClick={() => {
              const taken = new Set(
                flow.axes.find((a) => a.key === question.axisKey)?.values.map((v) => v.value) ??
                  options.map((o) => o.axisValueValue),
              );
              options.forEach((o) => taken.add(o.axisValueValue));
              const next = [
                ...options,
                { label: "", axisValueValue: slugify(`option ${options.length + 1}`, taken) },
              ];
              setOptions(next);
              scheduleSave("options");
            }}
          >
            + Add answer
          </Button>
        </InlineStack>
        {options.map((opt, i) => (
          <AnswerRow
            key={opt.axisValueValue}
            flow={flow}
            question={question}
            option={opt}
            optionStyle={optionStyle}
            index={i}
            later={later}
            disabled={disabled}
            canRemove={options.length > 2}
            onChange={(patch) => {
              setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));
              scheduleSave("options");
            }}
            onRemove={() => {
              setOptions((prev) => prev.filter((_, j) => j !== i));
              scheduleSave("options");
            }}
            onSelectSlide={onSelectSlide}
            onBranchToggle={(targetAxisKey, on) => {
              submitTool(branchFetcher, "update_question", {
                axisKey: targetAxisKey,
                patch: {
                  showIf: on
                    ? { axis_key: question.axisKey, axis_value: opt.axisValueValue }
                    : null,
                },
              });
            }}
          />
        ))}
      </BlockStack>

      <Divider />

      <button
        onClick={() => setBehaviorOpen((v) => !v)}
        style={disclosureStyle}
      >
        <span style={{ fontWeight: 600 }}>Format</span>
        <span style={{ color: "#6D7175", fontSize: 12 }}>
          {[multiSelect ? `Multi-select${maxPicks ? ` · max ${maxPicks}` : ""}` : null, optionStyle ? OPTION_STYLE_CHOICES.find((c) => c.value === optionStyle)?.label.split(":")[0] : null]
            .filter(Boolean)
            .join(" · ") || "Defaults"}
        </span>
      </button>
      <Collapsible id={`behavior-${question.axisKey}`} open={behaviorOpen}>
        <BlockStack gap="300">
          <Checkbox
            label="Shoppers can pick more than one answer"
            checked={multiSelect}
            disabled={disabled}
            onChange={(v) => {
              setMultiSelect(v);
              scheduleSave("question");
            }}
          />
          {multiSelect && (
            <TextField
              label="Max picks"
              type="number"
              value={maxPicks}
              onChange={(v) => {
                setMaxPicks(v);
                scheduleSave("question");
              }}
              placeholder="Unlimited"
              disabled={disabled}
              autoComplete="off"
            />
          )}
          <Select
            label="Answer style"
            options={OPTION_STYLE_CHOICES}
            value={optionStyle}
            disabled={disabled}
            onChange={(v) => {
              setOptionStyle(v);
              scheduleSave("question");
            }}
            helpText="How answer buttons render on the quiz."
          />
          <TextField
            label="Screen group (optional)"
            value={screenGroup}
            onChange={(v) => {
              setScreenGroup(v);
              scheduleSave("question");
            }}
            disabled={disabled}
            helpText="Consecutive questions with the same group render together on one quiz screen."
            autoComplete="off"
          />
        </BlockStack>
      </Collapsible>

      <Divider />

      <button onClick={() => setVisibilityOpen((v) => !v)} style={disclosureStyle}>
        <span style={{ fontWeight: 600 }}>Branching</span>
        <span style={{ color: "#6D7175", fontSize: 12 }}>
          {showIf
            ? `Only when "${answerLabel(flow, showIf.axis_key, showIf.axis_value)}" is picked`
            : "Always shown"}
        </span>
      </button>
      <Collapsible id={`visibility-${question.axisKey}`} open={visibilityOpen}>
        <VisibilityEditor
          flow={flow}
          earlier={earlier}
          showIf={showIf}
          disabled={disabled}
          onChange={(next) => {
            setShowIf(next);
            scheduleSave("question");
          }}
        />
      </Collapsible>
    </BlockStack>
  );
}

const disclosureStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  border: 0,
  background: "transparent",
  padding: "4px 0",
  cursor: "pointer",
  fontSize: 13,
  color: "#202223",
};

function submitTool(
  fetcher: ReturnType<typeof useFetcher<StudioActionData>>,
  tool: string,
  input: unknown,
) {
  const fd = new FormData();
  fd.append("intent", "apply-tool");
  fd.append("tool", tool);
  fd.append("input", JSON.stringify(input));
  fetcher.submit(fd, { method: "POST", action: "/studio" });
}

// ---------------------------------------------------------------------
// Answer row
// ---------------------------------------------------------------------

function AnswerRow({
  flow,
  question,
  option,
  optionStyle,
  index,
  later,
  disabled,
  canRemove,
  onChange,
  onRemove,
  onSelectSlide,
  onBranchToggle,
}: {
  flow: StudioFlow;
  question: StudioQuestion;
  option: StudioOption;
  optionStyle: string;
  index: number;
  later: StudioQuestion[];
  disabled?: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<StudioOption>) => void;
  onRemove: () => void;
  onSelectSlide: (slideId: string) => void;
  onBranchToggle: (targetAxisKey: string, on: boolean) => void;
}) {
  const sublabel =
    typeof option.displayMeta?.sublabel === "string" ? option.displayMeta.sublabel : "";
  const [detailsOpen, setDetailsOpen] = useState(
    Boolean(option.reasonText || sublabel || (option.imageUrl && optionStyle !== "visual")),
  );
  const [branchesOpen, setBranchesOpen] = useState(false);

  const reveals = later
    .map((q, j) => ({ q, number: flow.questions.indexOf(q) + 1 }))
    .filter(
      ({ q }) =>
        q.showIf?.axis_key === question.axisKey && q.showIf.axis_value === option.axisValueValue,
    );
  // Subtitle and image now have their own visible fields, so the badge only
  // flags settings this editor still can't show (branch condition, select-all,
  // tag/meter/swatch metadata).
  const metaBeyondSublabel = Boolean(
    option.displayMeta &&
      Object.entries(option.displayMeta).some(
        ([k, v]) => k !== "sublabel" && v != null && v !== "",
      ),
  );
  const hasAdvanced = Boolean(option.showIf || metaBeyondSublabel || option.selectAll);
  // "Image cards" style shows the uploader inline on every row; other styles
  // keep it inside Details (any style can carry an image, and auto style
  // switches to image cards once one is set).
  const showImageInline = optionStyle === "visual";

  const setSublabel = (v: string) => {
    const meta: Record<string, unknown> = { ...(option.displayMeta ?? {}) };
    if (v.trim() === "") delete meta.sublabel;
    else meta.sublabel = v;
    onChange({ displayMeta: Object.keys(meta).length > 0 ? meta : null });
  };

  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="200">
      <BlockStack gap="150">
        <InlineStack gap="150" blockAlign="center" wrap={false}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField
              label={`Answer ${index + 1}`}
              labelHidden
              value={option.label}
              onChange={(v) => onChange({ label: v })}
              placeholder={`Answer ${index + 1}`}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <Button
            variant="tertiary"
            size="micro"
            disabled={disabled}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            Details
          </Button>
          <Button
            variant="tertiary"
            tone="critical"
            size="micro"
            disabled={!canRemove || disabled}
            onClick={onRemove}
            accessibilityLabel="Remove answer"
            icon={XSmallIcon}
          />
        </InlineStack>

        {showImageInline && (
          <OptionImageUpload option={option} disabled={disabled} onChange={onChange} />
        )}

        {detailsOpen && (
          <BlockStack gap="200">
            <TextField
              label="Subtitle"
              value={sublabel}
              onChange={setSublabel}
              placeholder="Optional second line under this answer"
              helpText="Shown beneath the answer on the quiz."
              disabled={disabled}
              autoComplete="off"
            />
            <TextField
              label="Reason"
              value={option.reasonText ?? ""}
              onChange={(v) => onChange({ reasonText: v || null })}
              placeholder='"Why we picked this" (optional)'
              helpText="Shown on result cards, not on the question."
              disabled={disabled}
              autoComplete="off"
            />
            {!showImageInline && (
              <OptionImageUpload option={option} disabled={disabled} onChange={onChange} />
            )}
          </BlockStack>
        )}

        <InlineStack gap="150" blockAlign="center" wrap>
          {hasAdvanced && <Badge size="small">Has advanced settings</Badge>}
          {reveals.length > 0 && (
            <InlineStack gap="100" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                Reveals
              </Text>
              {reveals.map(({ q, number }) => (
                <button
                  key={q.axisKey}
                  onClick={() => onSelectSlide(slideIdForQuestion(q.axisKey))}
                  title={q.prompt}
                  style={{
                    border: "1px solid #E1E3E5",
                    borderRadius: 999,
                    background: "#fff",
                    padding: "1px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Q{number}
                </button>
              ))}
            </InlineStack>
          )}
          {later.length > 0 && (
            <Popover
              active={branchesOpen}
              onClose={() => setBranchesOpen(false)}
              activator={
                <Button variant="plain" size="micro" disabled={disabled} onClick={() => setBranchesOpen((v) => !v)}>
                  Branches
                </Button>
              }
            >
              <Box padding="300" width="300px">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    When "{option.label || `Answer ${index + 1}`}" is picked, also ask:
                  </Text>
                  {later.map((q) => {
                    const number = flow.questions.indexOf(q) + 1;
                    const mine =
                      q.showIf?.axis_key === question.axisKey &&
                      q.showIf.axis_value === option.axisValueValue;
                    const other = q.showIf && !mine;
                    return (
                      <Checkbox
                        key={q.axisKey}
                        label={`Q${number} · ${(q.prompt.trim() || "Untitled question").slice(0, 36)}`}
                        checked={mine}
                        disabled={Boolean(other) || disabled}
                        helpText={
                          other
                            ? `shown when "${answerLabel(flow, q.showIf!.axis_key, q.showIf!.axis_value)}"`
                            : undefined
                        }
                        onChange={(on) => onBranchToggle(q.axisKey, on)}
                      />
                    );
                  })}
                  <Text as="p" variant="bodySm" tone="subdued">
                    Each question can depend on one answer. Change it from the
                    question's Visibility section.
                  </Text>
                </BlockStack>
              </Box>
            </Popover>
          )}
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

// Per-answer image for the "Image cards" style. Rides the same upload
// endpoint as the before/after images; the URL lands on option.imageUrl,
// which the options autosave now carries explicitly.
function OptionImageUpload({
  option,
  disabled,
  onChange,
}: {
  option: StudioOption;
  disabled?: boolean;
  onChange: (patch: Partial<StudioOption>) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload-avatar", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as
        | { avatarUrl?: string; error?: string }
        | null;
      if (data?.avatarUrl) onChange({ imageUrl: data.avatarUrl });
      else setUploadError(data?.error ?? "Upload failed. Try a smaller JPG or PNG.");
    } catch {
      setUploadError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <BlockStack gap="100">
      <InlineStack gap="200" blockAlign="center">
        {option.imageUrl ? (
          <img
            src={option.imageUrl}
            alt=""
            style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid #E1E3E5" }}
          />
        ) : (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: "1px dashed #C9CCCF",
              background: "#fff",
            }}
          />
        )}
        <Button size="slim" loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>
          {option.imageUrl ? "Replace image" : "Upload image"}
        </Button>
        {option.imageUrl && (
          <Button
            size="slim"
            variant="plain"
            tone="critical"
            disabled={disabled}
            onClick={() => onChange({ imageUrl: null })}
          >
            Remove
          </Button>
        )}
      </InlineStack>
      {uploadError && (
        <Text as="span" variant="bodySm" tone="critical">
          {uploadError}
        </Text>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
    </BlockStack>
  );
}

// ---------------------------------------------------------------------
// Visibility editor (the showIf source of truth)
// ---------------------------------------------------------------------

function VisibilityEditor({
  flow,
  earlier,
  showIf,
  disabled,
  onChange,
}: {
  flow: StudioFlow;
  earlier: StudioQuestion[];
  showIf: { axis_key: string; axis_value: string } | null;
  disabled?: boolean;
  onChange: (next: { axis_key: string; axis_value: string } | null) => void;
}) {
  const conditional = showIf !== null;
  const sourceOptions = earlier.map((q, i) => ({
    label: `Q${flow.questions.indexOf(q) + 1} · ${(q.prompt.trim() || "Untitled question").slice(0, 40)}`,
    value: q.axisKey,
  }));
  const broken = showIf && !earlier.some((q) => q.axisKey === showIf.axis_key);
  if (broken && showIf) {
    sourceOptions.push({ label: `⚠ ${showIf.axis_key} (unavailable)`, value: showIf.axis_key });
  }
  const sourceQ = earlier.find((q) => q.axisKey === showIf?.axis_key);
  const valueOptions = (sourceQ?.options ?? []).map((o) => ({
    label: o.label || o.axisValueValue,
    value: o.axisValueValue,
  }));
  if (showIf && sourceQ && !sourceQ.options.some((o) => o.axisValueValue === showIf.axis_value)) {
    valueOptions.push({ label: `⚠ ${showIf.axis_value} (unavailable)`, value: showIf.axis_value });
  }

  return (
    <BlockStack gap="300">
      <Checkbox
        label="Always shown"
        checked={!conditional}
        disabled={disabled}
        onChange={(v) => {
          if (v) onChange(null);
        }}
      />
      <Checkbox
        label="Only when an earlier answer is picked"
        checked={conditional}
        disabled={disabled || earlier.length === 0}
        helpText={earlier.length === 0 ? "Available once this question has earlier questions." : undefined}
        onChange={(v) => {
          if (v && earlier.length > 0) {
            const first = earlier[0];
            onChange({
              axis_key: first.axisKey,
              axis_value: first.options[0]?.axisValueValue ?? "",
            });
          } else if (!v) {
            onChange(null);
          }
        }}
      />
      {conditional && showIf && (
        <InlineStack gap="200">
          <div style={{ flex: 1, minWidth: 120 }}>
            <Select
              label="Question"
              options={sourceOptions}
              value={showIf.axis_key}
              disabled={disabled}
              onChange={(axisKey) => {
                const q = earlier.find((x) => x.axisKey === axisKey);
                onChange({ axis_key: axisKey, axis_value: q?.options[0]?.axisValueValue ?? "" });
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Select
              label="Answer"
              options={valueOptions}
              value={showIf.axis_value}
              disabled={disabled}
              onChange={(axis_value) => onChange({ axis_key: showIf.axis_key, axis_value })}
            />
          </div>
        </InlineStack>
      )}
      <Text as="p" variant="bodySm" tone="subdued">
        The quiz skips this question unless the shopper gave that answer.
      </Text>
    </BlockStack>
  );
}
