import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  ActionList,
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
import { DragHandleIcon, MagicIcon, XSmallIcon } from "@shopify/polaris-icons";
import type { StudioLoaderData, StudioTab, StudioActionData } from "../../routes/studio";
import { IntroEditor, LeadEditor, PhotoEditor, ResultsEditor, ThemeEditor } from "./SettingsEditors";
import { BundleEditor, CrossSellEditor, type OfferCatalogItem } from "./OffersEditors";
import { IntegrationsEditor } from "./IntegrationsEditor";
import { TextLabelsEditor } from "./TextLabelsEditor";
import { ProductWhyEditor, type WhyProduct } from "./ProductWhyEditor";
import { CameraHintField, MatchSettingsEditor, type MatchProduct, type MatchSettings } from "./MatchSettingsEditor";
import { ColumnarMatchingCard } from "./ColumnarMatchingCard";
import type { ColumnarStudioView } from "../../lib/columnar/engine.server";
import type { QuizOffers } from "../../lib/quiz-offers.server";
import type { IntegrationStatus } from "../../lib/integrations.server";
import type { StudioFlow, StudioQuestion, StudioOption } from "./types";
import { answerLabel } from "./types";
import { slideIdForQuestion } from "./SlideTree";
import { postStudioAction } from "./studio-data";
import { defaultEmailPlacement } from "../../lib/quiz-templates";

// Right panel: Edit | Build with AI tabs. Edit renders the contextual editor
// for the selected slide; every manual edit goes through the SAME appliers the AI
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
  { label: "Nail swatches (color families)", value: "nails" },
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
  onOpenGallery,
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
  onOpenGallery?: () => void;
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
          <MagicIcon aria-hidden />
          Build with AI
        </button>
      </div>
      {/* studio-ai-pane[data-active] lets the shell tint the right panel
          while Build with AI is showing (StudioShell CSS). */}
      <div
        className="studio-ai-pane"
        data-active={activeTab === "chat"}
        style={{ flex: 1, minHeight: 0, display: activeTab === "chat" ? "flex" : "none", flexDirection: "column" }}
      >
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
            onOpenGallery={onOpenGallery}
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
  onOpenGallery,
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
  onOpenGallery?: () => void;
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
      <LeadEditor
        key={`lead:${chatEpoch}`}
        settings={settings}
        chatBusy={chatBusy}
        onPreviewUpdate={onPreviewUpdate}
        template={data.studio.template}
        emailPlacementDefault={data.studio.template ? defaultEmailPlacement(data.studio.template) : null}
      />
    );
  }
  if (selectedSlide === "photo") {
    const match = (data.matchSettings ?? null) as MatchSettings | null;
    return (
      <BlockStack gap="400">
        <PhotoEditor key={`photo:${chatEpoch}`} settings={settings} chatBusy={chatBusy} onPreviewUpdate={onPreviewUpdate} />
        {match && <CameraHintField key={`camera-hint:${chatEpoch}`} initial={match.photoFrameHint} disabled={chatBusy} />}
      </BlockStack>
    );
  }
  if (selectedSlide === "matching") {
    const match = (data.matchSettings ?? null) as MatchSettings | null;
    const products = (data.matchProducts ?? null) as MatchProduct[] | null;
    if (!match && products) {
      return (
        <Banner tone="critical">
          We couldn&rsquo;t load your matching settings, so they can&rsquo;t be edited right now. Reload Studio to try again.
        </Banner>
      );
    }
    if (!match || !products) {
      return (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span" tone="subdued">
            Loading…
          </Text>
        </InlineStack>
      );
    }
    // Columnar matching card: only for a shop with a columnar spec.
    const columnar = (data.columnar ?? null) as ColumnarStudioView | null;
    return (
      <BlockStack gap="500">
        <MatchSettingsEditor
          key={`matching:${chatEpoch}`}
          initial={match}
          products={products}
          chatBusy={chatBusy}
          onPreviewReload={onPreviewReload}
        />
        {columnar && (
          <ColumnarMatchingCard
            key={`columnar:${chatEpoch}`}
            initial={columnar}
            chatBusy={chatBusy}
            onPreviewReload={onPreviewReload}
          />
        )}
      </BlockStack>
    );
  }
  if (selectedSlide === "results") {
    const whyProducts = (data.whyProducts ?? null) as WhyProduct[] | null;
    return (
      <ResultsEditor
        key={`results:${chatEpoch}`}
        settings={settings}
        chatBusy={chatBusy}
        onPreviewUpdate={onPreviewUpdate}
        onOpenText={() => onSelectSlide("text")}
      >
        {/* Loaded with the slide (?slide=results); remount when it lands. */}
        {whyProducts ? (
          <ProductWhyEditor
            key={`why:${chatEpoch}`}
            products={whyProducts}
            initial={settings.quiz_product_why}
            chatBusy={chatBusy}
            onPreviewUpdate={onPreviewUpdate}
          />
        ) : (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text as="span" tone="subdued">
              Loading products…
            </Text>
          </InlineStack>
        )}
      </ResultsEditor>
    );
  }
  if (selectedSlide === "text") {
    // Pool (columnar) quizzes list their own strings too. Read loosely:
    // the spec sits in recommendation_tuning.columnar (contract 1).
    const tuning = ((data.matchSettings ?? null) as MatchSettings | null)?.tuning as unknown as
      | { columnar?: { enabled?: unknown } | null }
      | undefined;
    return (
      <TextLabelsEditor
        key={`text:${chatEpoch}:${data.studio.template ?? "classic"}`}
        settings={settings}
        template={data.studio.template}
        pool={tuning?.columnar?.enabled === true}
        chatBusy={chatBusy}
        onPreviewUpdate={onPreviewUpdate}
      />
    );
  }
  if (selectedSlide === "theme") {
    return (
      <ThemeEditor
        key={`theme:${chatEpoch}`}
        settings={settings}
        chatBusy={chatBusy}
        onPreviewUpdate={onPreviewUpdate}
        template={data.studio.template}
        colorSources={data.studio.colorSources}
        onOpenGallery={onOpenGallery}
      />
    );
  }
  // Sell more (migration 086). The loader fetches these only while the
  // slide is open; the editors remount per load so they start from it.
  // Until that load lands the previous loader data has nothing for them.
  const sellMoreLoading =
    ((selectedSlide === "offers-bundle" || selectedSlide === "offers-crosssell") && !data.offers) ||
    (selectedSlide === "offers-crosssell" && !data.offerCatalog) ||
    (selectedSlide === "integrations" && !data.klaviyo);
  if (sellMoreLoading) {
    return (
      <InlineStack gap="200" blockAlign="center">
        <Spinner size="small" />
        <Text as="span" tone="subdued">
          Loading…
        </Text>
      </InlineStack>
    );
  }
  if (selectedSlide === "offers-bundle") {
    return (
      <BundleEditor
        key={`bundle:${chatEpoch}:${data.offers ? "loaded" : "none"}`}
        settings={settings}
        offers={(data.offers ?? null) as QuizOffers | null}
        chatBusy={chatBusy}
        onPreviewUpdate={onPreviewUpdate}
        onPreviewReload={onPreviewReload}
      />
    );
  }
  if (selectedSlide === "offers-crosssell") {
    return (
      <CrossSellEditor
        key={`crosssell:${data.offers ? "loaded" : "none"}`}
        offers={(data.offers ?? null) as QuizOffers | null}
        catalog={(data.offerCatalog ?? null) as OfferCatalogItem[] | null}
        flow={flow}
        chatBusy={chatBusy}
        onPreviewReload={onPreviewReload}
      />
    );
  }
  if (selectedSlide === "integrations") {
    return (
      <IntegrationsEditor
        key={`integrations:${data.klaviyo ? "loaded" : "none"}`}
        status={(data.klaviyo ?? null) as IntegrationStatus | null}
        leadEnabled={settings.quiz_lead_enabled === true}
        collectPhone={settings.quiz_lead_collect_phone === true}
        onOpenLead={() => onSelectSlide("lead")}
      />
    );
  }
  if (selectedSlide === "images") {
    return (
      <Text as="p" tone="subdued">
        Every image this template uses is listed in the Images rail on the
        left, unresolved first. Choose or Change a slot to pick from your
        brand library, or click any dashed image on the canvas.
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

// uid is a client-only row identity: an "Open to anything" answer often
// shares its axis value with a sibling, so the value can't key the rows
// (duplicate keys scrambled them on reorder). Never sent: buildCalls lists
// the saved fields explicitly.
interface LocalOption extends StudioOption {
  uid: string;
}

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
  const uidRef = useRef(0);
  const nextUid = () => `answer-${uidRef.current++}`;
  const [options, setOptions] = useState<LocalOption[]>(() =>
    question.options.map((o) => ({ ...o, uid: nextUid() })),
  );
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

  // A reorder is the same full options write as any answer edit: the
  // applier renumbers positions from array order and keeps every field, so
  // undo/version history and the preview hot-swap behave like any other
  // edit. Never delete + re-add (that drops images, branches and reasons).
  const moveAnswer = (from: number, to: number) => {
    const current = stateRef.current.options;
    const next = moveItem(current, from, to);
    if (next === current) return;
    setOptions(next);
    scheduleSave("options");
  };
  // The storefront pulls only the FIRST select-all answer out and draws it
  // last; any later one renders in place.
  const catchAllIndex = options.findIndex((o) => o.selectAll);

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
                { label: "", axisValueValue: slugify(`option ${options.length + 1}`, taken), uid: nextUid() },
              ];
              setOptions(next);
              scheduleSave("options");
            }}
          >
            + Add answer
          </Button>
        </InlineStack>
        <ReorderList
          items={options}
          itemKey={(opt) => opt.uid}
          itemLabel={(opt, i) => opt.label.trim() || `Answer ${i + 1}`}
          disabled={disabled}
          onMove={moveAnswer}
          renderItem={(opt, i, handle) => (
            <AnswerRow
              flow={flow}
              question={question}
              option={opt}
              optionStyle={optionStyle}
              index={i}
              catchAllNote={i === catchAllIndex && i !== options.length - 1}
              dragHandle={handle}
              later={later}
              disabled={disabled}
              canRemove={options.length > 2}
              // By uid, not index: an image upload finishing after a
              // reorder (or a delete) still lands on the answer that
              // started it, not whichever answer now sits at its old index.
              onChange={(patch) => {
                setOptions((prev) => prev.map((o) => (o.uid === opt.uid ? { ...o, ...patch } : o)));
                scheduleSave("options");
              }}
              onRemove={() => {
                setOptions((prev) => prev.filter((o) => o.uid !== opt.uid));
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
          )}
        />
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
  catchAllNote,
  dragHandle,
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
  catchAllNote: boolean;
  dragHandle: React.ReactNode;
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
        ([k, v]) => k !== "sublabel" && k !== "texture" && v != null && v !== "",
      ),
  );
  // Finish preview (migration 086): drawn on rich/boxed cards only.
  const texture = typeof option.displayMeta?.texture === "string" ? option.displayMeta.texture : "";
  const showTexture = optionStyle === "rich" || optionStyle === "boxed" || optionStyle === "nails" || Boolean(texture);
  const setTexture = (v: string) => {
    const meta: Record<string, unknown> = { ...(option.displayMeta ?? {}) };
    if (!v) delete meta.texture;
    else meta.texture = v;
    onChange({ displayMeta: Object.keys(meta).length > 0 ? meta : null });
  };
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
          {dragHandle}
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

        {/* Every storefront renderer draws the (first) select-all answer
            after the others, so say so when the list here puts it elsewhere. */}
        {catchAllNote && (
          <Text as="p" variant="bodySm" tone="subdued">
            Catch-all answer: the quiz shows it last.
          </Text>
        )}

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
            {showTexture && (
              <Select
                label="Finish preview"
                options={[
                  { label: "None", value: "" },
                  { label: "Creme (flat color)", value: "creme" },
                  { label: "Matte", value: "matte" },
                  { label: "Shimmer (pearl glow)", value: "shimmer" },
                  { label: "Sparkle (glitter)", value: "sparkle" },
                  { label: "Chrome / metallic", value: "chrome" },
                  { label: "Sheer / jelly", value: "sheer" },
                  { label: "Rainbow (multicolor)", value: "rainbow" },
                  { label: "French tip", value: "french" },
                  { label: "Glossy (high shine)", value: "glossy" },
                  { label: "Glazed (pearl glaze)", value: "glazed" },
                  { label: "Velvet / cat eye", value: "velvet" },
                ]}
                value={texture}
                onChange={setTexture}
                helpText="A small swatch on the card so shoppers can see the finish. Works with Rich, Boxed and Nail swatch styles."
                disabled={disabled}
              />
            )}
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

// ---------------------------------------------------------------------
// Answer reordering
// ---------------------------------------------------------------------

/** `list` with the item at `from` moved to index `to` (clamped). Returns the
 * SAME array when nothing moves, so callers can skip the save. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || target === from) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Drop gap under the pointer: how many row midpoints sit above `y`. Gap g
 * is the slot before row g; gap n is after the last row. */
export function gapAt(midpoints: number[], y: number): number {
  return midpoints.filter((m) => y > m).length;
}

/** Final index of the dragged row for a drop into `gap`. Both gaps beside
 * the row itself leave it where it is. */
export function indexForGap(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

// Studio is server-rendered: a plain useLayoutEffect warns there.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const DRAG_THRESHOLD = 4;
// Ghost card height / 2: keeps the pointer on the ghost's handle.
const GHOST_GRAB = 18;
const AUTOSCROLL_EDGE = 48;

const REORDER_CSS = `
  .studio-reorder-handle { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 32px; margin-left: -4px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--p-color-icon-secondary, #8A8A8A); cursor: grab; touch-action: none; }
  .studio-reorder-handle svg { width: 20px; height: 20px; fill: currentColor; }
  .studio-reorder-handle:hover:not(:disabled), .studio-reorder-handle[aria-expanded="true"] { background: var(--p-color-bg-fill-transparent-hover, rgba(0, 0, 0, 0.05)); color: var(--p-color-icon, #4A4A4A); }
  .studio-reorder-handle:focus-visible { outline: 2px solid var(--p-color-border-focus, #005BD3); outline-offset: 1px; }
  .studio-reorder-handle:disabled { cursor: default; opacity: 0.4; }
  .studio-reorder-row[data-dragging="true"] { opacity: 0.4; }
  .studio-reorder-row[data-dragging="true"] .studio-reorder-handle { cursor: grabbing; }
  .studio-reorder-line { position: absolute; left: 4px; right: 0; height: 2px; border-radius: 1px; background: var(--p-color-border-focus, #005BD3); pointer-events: none; z-index: 1; }
  .studio-reorder-line::before { content: ""; position: absolute; left: -4px; top: -3px; width: 8px; height: 8px; box-sizing: border-box; border: 2px solid var(--p-color-border-focus, #005BD3); border-radius: 50%; background: #fff; }
  .studio-reorder-ghost { position: fixed; top: 0; z-index: 600; display: flex; align-items: center; gap: 6px; height: 36px; box-sizing: border-box; padding: 0 12px 0 4px; border: 1px solid var(--p-color-border, #E3E3E3); border-radius: 8px; background: #fff; box-shadow: var(--p-shadow-400, 0 4px 12px rgba(0, 0, 0, 0.15)); font-size: 13px; font-weight: 550; color: #303030; pointer-events: none; cursor: grabbing; }
  .studio-reorder-ghost svg { flex: none; width: 20px; height: 20px; fill: #4A4A4A; }
  .studio-reorder-ghost span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

interface DragState {
  key: string;
  from: number;
  gap: number;
  label: string;
  left: number;
  width: number;
}

// Drag-to-reorder for the answers list. Pointer drags start ONLY from a
// row's handle (the rows hold text fields, so a draggable row would steal
// text selection), using pointer events so mouse, pen and touch share one
// path. Keyboard: Arrow Up/Down (Home/End) on the focused handle move the
// row; Enter/click opens Move up/down/top/bottom, the single-pointer
// alternative to dragging. Every outcome is announced to screen readers.
function ReorderList<T>({
  items,
  itemKey,
  itemLabel,
  disabled,
  onMove,
  renderItem,
}: {
  items: T[];
  itemKey: (item: T) => string;
  itemLabel: (item: T, index: number) => string;
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number, handle: React.ReactNode) => React.ReactNode;
}) {
  const count = items.length;
  const canReorder = !disabled && count > 1;
  const hintId = useId();
  const [drag, setDragState] = useState<DragState | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const handleEls = useRef(new Map<string, HTMLButtonElement>());
  const ghostEl = useRef<HTMLDivElement | null>(null);
  // Drag bookkeeping lives in refs: pointermove fires far more often than
  // the gap changes, so only a gap change re-renders the list.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dragRef = useRef<DragState | null>(null);
  const pressRef = useRef<{ key: string; from: number; startY: number } | null>(null);
  const pointerY = useRef(0);
  const suppressClick = useRef(false);
  const focusKey = useRef<string | null>(null);
  const scroller = useRef<{
    el: HTMLElement | null;
    raf: number | null;
    onScroll: (() => void) | null;
    body: { cursor: string; userSelect: string } | null;
  }>({ el: null, raf: null, onScroll: null, body: null });

  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  // A live region stays quiet when its text doesn't change (Arrow Up twice
  // while already first), so every other message ends in a no-break space.
  const flip = useRef(false);
  const announce = (text: string) => {
    flip.current = !flip.current;
    setMessage(flip.current ? text : `${text} `);
  };
  const where = (index: number) => `position ${index + 1} of ${count}`;

  // Keyboard and menu moves put focus back on the moved row's handle:
  // React re-inserts a row moved down, which blurs it.
  useIsoLayoutEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    const handle = handleEls.current.get(key);
    if (handle && document.activeElement !== handle) handle.focus();
  });

  const commit = (from: number, to: number, label: string, opts: { refocus: boolean; unchanged: string }) => {
    const target = Math.max(0, Math.min(count - 1, to));
    if (target === from) {
      announce(opts.unchanged);
      return;
    }
    if (opts.refocus) focusKey.current = itemKey(items[from]);
    onMove(from, target);
    announce(`${label} moved to ${where(target)}.`);
  };

  const measureGap = (y: number) =>
    gapAt(
      itemsRef.current.map((item) => {
        const r = rowEls.current.get(itemKey(item))?.getBoundingClientRect();
        return r ? r.top + r.height / 2 : 0;
      }),
      y,
    );

  const placeGhost = () => {
    if (ghostEl.current) ghostEl.current.style.transform = `translateY(${pointerY.current - GHOST_GRAB}px)`;
  };

  const track = (y: number) => {
    pointerY.current = y;
    placeGhost();
    const d = dragRef.current;
    if (!d) return;
    const gap = measureGap(y);
    if (gap === d.gap) return;
    setDrag({ ...d, gap });
    const to = indexForGap(d.from, gap);
    announce(to === d.from ? `${d.label}, back at ${where(d.from)}.` : `${d.label}, over ${where(to)}.`);
  };

  // Long lists outgrow the panel: holding the ghost near the scroll area's
  // top or bottom edge scrolls it, faster the closer the pointer gets.
  const autoScroll = () => {
    const s = scroller.current;
    s.raf = null;
    if (!dragRef.current || !s.el) return;
    const r = s.el.getBoundingClientRect();
    const y = pointerY.current;
    const over = y < r.top + AUTOSCROLL_EDGE ? y - (r.top + AUTOSCROLL_EDGE) : y > r.bottom - AUTOSCROLL_EDGE ? y - (r.bottom - AUTOSCROLL_EDGE) : 0;
    if (over !== 0) s.el.scrollTop += Math.max(-16, Math.min(16, Math.round(over / 3) || Math.sign(over)));
    s.raf = requestAnimationFrame(autoScroll);
  };

  const startDrag = (press: { key: string; from: number }, y: number) => {
    const row = rowEls.current.get(press.key);
    const rect = row?.getBoundingClientRect();
    const label = itemLabel(items[press.from], press.from);
    pointerY.current = y;
    setMenuKey(null);
    setDrag({ key: press.key, from: press.from, gap: press.from, label, left: rect?.left ?? 0, width: rect?.width ?? 0 });
    announce(`Picked up ${label}, ${where(press.from)}. Press Escape to cancel.`);
    const s = scroller.current;
    s.body = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    s.el = null;
    for (let n = row?.parentElement ?? null; n; n = n.parentElement) {
      const overflow = getComputedStyle(n).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && n.scrollHeight > n.clientHeight) {
        s.el = n;
        break;
      }
    }
    // Rows move under a still pointer while the panel scrolls (wheel or
    // auto-scroll); re-measure the gap on every scroll.
    s.onScroll = () => track(pointerY.current);
    s.el?.addEventListener("scroll", s.onScroll);
    if (s.el && typeof requestAnimationFrame === "function") s.raf = requestAnimationFrame(autoScroll);
  };

  const endDrag = () => {
    const s = scroller.current;
    if (s.raf !== null) cancelAnimationFrame(s.raf);
    s.raf = null;
    if (s.onScroll) s.el?.removeEventListener("scroll", s.onScroll);
    s.el = null;
    s.onScroll = null;
    if (s.body) {
      document.body.style.cursor = s.body.cursor;
      document.body.style.userSelect = s.body.userSelect;
      s.body = null;
    }
    pressRef.current = null;
    setDrag(null);
  };

  const cancelDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    // The release that follows still clicks the handle; don't open the menu.
    suppressClick.current = true;
    endDrag();
    announce(`Move cancelled. ${d.label} stays at ${where(d.from)}.`);
  };

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.key]);

  // Editing locked mid-drag (Build with AI started): a disabled handle may
  // never see the release, so drop the drag now.
  useEffect(() => {
    if (!canReorder && dragRef.current) cancelDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReorder]);

  // Unmounting mid-drag (slide switch) must not leave the page stuck with a
  // grabbing cursor and text selection off.
  useEffect(
    () => () => {
      if (dragRef.current) endDrag();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const showLine = drag !== null && indexForGap(drag.from, drag.gap) !== drag.from;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <style dangerouslySetInnerHTML={{ __html: REORDER_CSS }} />
      {items.map((item, i) => {
        const key = itemKey(item);
        const label = itemLabel(item, i);
        const move = (to: number) => {
          setMenuKey(null);
          commit(i, to, label, { refocus: true, unchanged: `${label} is already at ${where(i)}.` });
        };
        const handle = (
          <Popover
            active={menuKey === key}
            onClose={() => setMenuKey(null)}
            preferredAlignment="left"
            activator={
              <button
                type="button"
                ref={(el) => {
                  if (el) handleEls.current.set(key, el);
                  else handleEls.current.delete(key);
                }}
                className="studio-reorder-handle"
                aria-label={`Reorder ${label}`}
                aria-describedby={hintId}
                aria-haspopup="menu"
                aria-expanded={menuKey === key}
                disabled={!canReorder}
                onPointerDown={(e) => {
                  if (!canReorder || e.button !== 0) return;
                  suppressClick.current = false;
                  pressRef.current = { key, from: i, startY: e.clientY };
                  try {
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                  } catch {
                    // Pointer already gone; the drag simply won't start.
                  }
                }}
                onPointerMove={(e) => {
                  const press = pressRef.current;
                  if (!press) return;
                  if (!dragRef.current) {
                    if (Math.abs(e.clientY - press.startY) < DRAG_THRESHOLD) return;
                    startDrag(press, e.clientY);
                  }
                  track(e.clientY);
                }}
                onPointerUp={() => {
                  const d = dragRef.current;
                  pressRef.current = null;
                  if (!d) return; // a plain click: onClick opens the menu
                  suppressClick.current = true;
                  endDrag();
                  commit(d.from, indexForGap(d.from, d.gap), d.label, {
                    refocus: false,
                    unchanged: `${d.label} returned to ${where(d.from)}.`,
                  });
                }}
                onPointerCancel={() => {
                  pressRef.current = null;
                  cancelDrag();
                }}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (canReorder) setMenuKey((k) => (k === key ? null : key));
                }}
                onKeyDown={(e) => {
                  // A touch drag ends with no click to consume the flag; the
                  // next Enter/Space must still open the menu.
                  if (e.key === "Enter" || e.key === " ") suppressClick.current = false;
                  if (!canReorder || e.altKey || e.ctrlKey || e.metaKey) return;
                  const to =
                    e.key === "ArrowUp" ? i - 1
                    : e.key === "ArrowDown" ? i + 1
                    : e.key === "Home" ? 0
                    : e.key === "End" ? count - 1
                    : null;
                  if (to === null) return;
                  e.preventDefault();
                  const edge = to < i || (to === i && i === 0) ? "first" : "last";
                  commit(i, to, label, { refocus: true, unchanged: `${label} is already ${edge}.` });
                }}
              >
                <DragHandleIcon aria-hidden focusable="false" />
              </button>
            }
          >
            <ActionList
              actionRole="menuitem"
              items={[
                { content: "Move up", disabled: i === 0, onAction: () => move(i - 1) },
                { content: "Move down", disabled: i === count - 1, onAction: () => move(i + 1) },
                { content: "Move to top", disabled: i === 0, onAction: () => move(0) },
                { content: "Move to bottom", disabled: i === count - 1, onAction: () => move(count - 1) },
              ]}
            />
          </Popover>
        );
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) rowEls.current.set(key, el);
              else rowEls.current.delete(key);
            }}
            className="studio-reorder-row"
            data-dragging={drag?.key === key}
            style={{ position: "relative" }}
          >
            {showLine && drag!.gap === i && <div className="studio-reorder-line" style={{ top: -5 }} aria-hidden />}
            {renderItem(item, i, handle)}
            {showLine && drag!.gap === count && i === count - 1 && (
              <div className="studio-reorder-line" style={{ bottom: -5 }} aria-hidden />
            )}
          </div>
        );
      })}
      {drag && (
        <div
          ref={ghostEl}
          className="studio-reorder-ghost"
          aria-hidden
          style={{ left: drag.left, width: drag.width, transform: `translateY(${pointerY.current - GHOST_GRAB}px)` }}
        >
          <DragHandleIcon aria-hidden focusable="false" />
          <span>{drag.label}</span>
        </div>
      )}
      <span id={hintId} hidden>
        Press Arrow Up or Arrow Down to move this answer, Home or End to move it to the top or bottom, or Enter for
        move options.
      </span>
      <div role="status" aria-live="assertive" aria-atomic="true" style={SR_ONLY}>
        {message}
      </div>
    </div>
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
