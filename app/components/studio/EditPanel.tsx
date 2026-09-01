import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
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
import type { StudioLoaderData, StudioStep, StudioActionData } from "../../routes/studio";
import type { StudioFlow, StudioQuestion, StudioOption } from "./types";
import { answerLabel } from "./types";
import { slideIdForQuestion } from "./SlideTree";

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
  onPreviewUpdate,
  onPreviewReload,
  chat,
}: {
  data: StudioLoaderData;
  step: StudioStep;
  selectedSlide: string;
  chatEpoch: number;
  chatBusy: boolean;
  onSelectSlide: (slideId: string) => void;
  onPreviewUpdate: (payload: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
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
          onClick={() => setTab("chat")}
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
            onPreviewUpdate={onPreviewUpdate}
            onPreviewReload={onPreviewReload}
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
  onPreviewUpdate,
  onPreviewReload,
}: {
  data: StudioLoaderData;
  selectedSlide: string;
  chatEpoch: number;
  chatBusy: boolean;
  onSelectSlide: (slideId: string) => void;
  onPreviewUpdate: (payload: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
}) {
  const flow = data.draft?.flow as StudioFlow | undefined;
  if (!flow) {
    return (
      <Text as="p" tone="subdued">
        No draft loaded.
      </Text>
    );
  }
  if (selectedSlide === "intro") {
    return (
      <FixedSlideNotice
        title="Intro slide"
        body="The intro headline, buttons, and design live on the Copy & design page. You can also just tell Gleame in Chat, for example: change the headline to..."
        actions={[{ content: "Open Copy & design", url: "/app/assistant/quiz" }]}
      />
    );
  }
  if (selectedSlide === "photo") {
    return (
      <FixedSlideNotice
        title="Photo step"
        body="The photo step's copy is on the Copy & design page. Photo detection traits live in the advanced rules editor."
        actions={[
          { content: "Open Copy & design", url: "/app/assistant/quiz" },
          { content: "Advanced rules editor", url: "/app/assistant/recommendations" },
        ]}
      />
    );
  }
  if (selectedSlide === "results") {
    return (
      <FixedSlideNotice
        title="Results slide"
        body="Results card copy and layout live on the Copy & design page. What gets recommended is set up in the Logic step."
        actions={[{ content: "Open Copy & design", url: "/app/assistant/quiz" }]}
      />
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
      onPreviewUpdate={onPreviewUpdate}
      onPreviewReload={onPreviewReload}
    />
  );
}

function FixedSlideNotice({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: Array<{ content: string; url: string }>;
}) {
  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingMd">
        {title}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {body}
      </Text>
      <InlineStack gap="200">
        {actions.map((a) => (
          <Button key={a.url} url={a.url} size="slim">
            {a.content}
          </Button>
        ))}
      </InlineStack>
    </BlockStack>
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
  onPreviewUpdate,
  onPreviewReload,
}: {
  flow: StudioFlow;
  question: StudioQuestion;
  chatBusy: boolean;
  onSelectSlide: (slideId: string) => void;
  onPreviewUpdate: (payload: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const branchFetcher = useFetcher<StudioActionData>();
  const deleteFetcher = useFetcher<StudioActionData>();

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

  const flush = () => {
    const s = stateRef.current;
    const dirty = dirtyRef.current;
    if (!dirty.question && !dirty.options) return;
    const max = s.maxPicks.trim() === "" ? null : Number(s.maxPicks);
    if (dirty.question) {
      const patch: Record<string, unknown> = {
        prompt: s.prompt,
        helperText: s.helper.trim() === "" ? null : s.helper,
        multiSelect: s.multiSelect,
        maxSelections: s.multiSelect && Number.isFinite(max as number) ? max : null,
        optionStyle: s.optionStyle || null,
        screenGroup: s.screenGroup.trim() === "" ? null : s.screenGroup.trim(),
        showIf: s.showIf,
      };
      submitTool(fetcher, "update_question", { axisKey: question.axisKey, patch });
    }
    if (dirty.options) {
      submitTool(fetcher, "update_question_options", {
        axisKey: question.axisKey,
        options: s.options.map((o) => ({
          label: o.label,
          axisValueValue: o.axisValueValue,
          reasonText: o.reasonText ?? null,
          showIf: o.showIf ?? null,
          selectAll: o.selectAll ?? false,
          displayMeta: o.displayMeta ?? null,
        })),
      });
    }
    dirtyRef.current = { question: false, options: false };
  };

  const scheduleSave = (kind: "question" | "options") => {
    dirtyRef.current[kind] = true;
    setSaveState("saving");
    setError(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
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
      setSaveState("saved");
      const t = setTimeout(() => setSaveState("idle"), 2000);
      return () => clearTimeout(t);
    }
    if (fetcher.data.error) {
      setSaveState("idle");
      setError(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, onPreviewUpdate]);

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
                loading={deleteFetcher.state !== "idle"}
                onClick={() => {
                  submitTool(deleteFetcher, "remove_question", {
                    axisKey: question.axisKey,
                    removeAxis: true,
                  });
                  setConfirmingDelete(false);
                  onSelectSlide(
                    qIndex > 0 ? slideIdForQuestion(flow.questions[qIndex - 1].axisKey) : "intro",
                  );
                  onPreviewReload();
                }}
              >
                Delete question
              </Button>
              <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}
      {deleteFetcher.data && !deleteFetcher.data.ok && deleteFetcher.data.error && (
        <Banner tone="critical">{deleteFetcher.data.error}</Banner>
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
            index={i}
            later={later}
            disabled={disabled}
            canRemove={options.length > 1}
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
        <span style={{ fontWeight: 600 }}>Behavior</span>
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
        <span style={{ fontWeight: 600 }}>Visibility</span>
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
  index: number;
  later: StudioQuestion[];
  disabled?: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<StudioOption>) => void;
  onRemove: () => void;
  onSelectSlide: (slideId: string) => void;
  onBranchToggle: (targetAxisKey: string, on: boolean) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(Boolean(option.reasonText));
  const [branchesOpen, setBranchesOpen] = useState(false);

  const reveals = later
    .map((q, j) => ({ q, number: flow.questions.indexOf(q) + 1 }))
    .filter(
      ({ q }) =>
        q.showIf?.axis_key === question.axisKey && q.showIf.axis_value === option.axisValueValue,
    );
  const hasAdvanced = Boolean(option.showIf || option.displayMeta || option.selectAll || option.imageUrl);

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
          >
            ✕
          </Button>
        </InlineStack>

        {detailsOpen && (
          <TextField
            label={`Reason for answer ${index + 1}, shown on result cards`}
            labelHidden
            value={option.reasonText ?? ""}
            onChange={(v) => onChange({ reasonText: v || null })}
            placeholder='"Why we picked this" on results (optional)'
            disabled={disabled}
            autoComplete="off"
          />
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
