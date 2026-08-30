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
  Checkbox,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { findShopByDomain, saveRecommendationConfig } from "../lib/supabase.server";
import { captureLiveConfig, hasQuizDraft } from "../lib/quiz-draft.server";
import {
  applyQuestionPatch,
  toSimpleQuestions,
  withShopSaveLock,
  type QuestionPatch,
  type SimpleQuestionInput,
} from "../lib/question-axis.server";

// ---------------------------------------------------------------------
// Simple questions editor — the merchant-facing view of the quiz flow with
// the axes concept fully hidden. Each question silently owns an axis (and
// each option an axis value) derived once at creation; see
// question-axis.server.ts for the derivation and patch semantics.
//
// Saves are per-question PATCHES merged server-side into a fresh
// captureLiveConfig() snapshot, serialized per shop by withShopSaveLock, so
// this page can never clobber fields it doesn't edit (ORLY/L&M styled
// questions keep their displayMeta, showIf, images, screen groups, option
// styles bit-for-bit).
// ---------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await findShopByDomain(shopDomain);
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [live, draftExists] = await Promise.all([
    captureLiveConfig(shop.id),
    hasQuizDraft(shop.id),
  ]);
  return json({
    questions: toSimpleQuestions(live.flow),
    photoAxes: live.flow.axes
      .filter((a) => a.source === "photo")
      .map((a) => ({ key: a.key, label: a.label, valueCount: a.values.length })),
    ruleCount: live.flow.rules.length,
    draftExists,
  });
};

// Loader reads throw loudly on fetch errors (a blank-looking editor gating a
// destructive save is worse than an error page); catch them with app chrome
// instead of Remix's bare error screen.
export function ErrorBoundary() {
  return (
    <Page title="Quiz questions" backAction={{ content: "Quiz", url: "/app/quiz" }}>
      <Banner tone="critical" title="Something went wrong loading your questions">
        Reload the page to try again. Your saved configuration is untouched.
      </Banner>
    </Page>
  );
}

type ActionResponse = {
  success?: boolean;
  error?: string;
  needsConfirm?: boolean;
  droppedRuleCount?: number;
};

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
  const shop = await findShopByDomain(session.shop);
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  let patch: QuestionPatch;
  if (intent === "upsert-question") {
    let question: SimpleQuestionInput;
    try {
      question = JSON.parse(formData.get("question") as string);
    } catch {
      return json({ error: "Malformed request" }, { status: 400 });
    }
    patch = { kind: "upsert", question };
  } else if (intent === "delete-question") {
    patch = {
      kind: "delete",
      axisKey: formData.get("axisKey") as string,
      confirmRuleDrop: formData.get("confirmRuleDrop") === "true",
    };
  } else if (intent === "reorder-questions") {
    let axisKeys: string[];
    try {
      axisKeys = JSON.parse(formData.get("axisKeys") as string);
    } catch {
      return json({ error: "Malformed request" }, { status: 400 });
    }
    patch = { kind: "reorder", axisKeys };
  } else {
    return json({ error: "Unknown intent" }, { status: 400 });
  }

  // Fresh snapshot every save, taken INSIDE the per-shop lock: the patch is
  // merged into what's live right now, and concurrent saves (two cards, a
  // reorder mid-save) queue instead of racing the wipe-and-rewrite RPC.
  let result;
  try {
    result = await withShopSaveLock(shop.id, async () => {
      const live = await captureLiveConfig(shop.id);
      const patched = applyQuestionPatch(live.flow, patch);
      if (!patched.ok) return patched;
      const saved = await saveRecommendationConfig(shop.id, patched.flow);
      if (!saved.ok) {
        return { ok: false as const, error: saved.error ?? "Save failed" };
      }
      return patched;
    });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : "Failed to load current config",
    }, { status: 500 });
  }
  if (!result.ok) {
    return json(
      {
        error: result.error,
        needsConfirm: result.needsConfirm,
        droppedRuleCount: result.droppedRuleCount,
      },
      { status: result.needsConfirm ? 409 : 400 },
    );
  }
  return json({ success: true });
};

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

type LoadedQuestion = ReturnType<typeof useLoaderData<typeof loader>>["questions"][number];

interface OptionDraft {
  axisValueValue: string | null;
  label: string;
  reasonText: string;
  hasAdvanced: boolean;
}

interface QuestionDraft {
  axisKey: string | null;
  prompt: string;
  helperText: string;
  multiSelect: boolean;
  maxSelections: string;
  hasAdvanced: boolean;
  options: OptionDraft[];
}

function toDraft(q: LoadedQuestion): QuestionDraft {
  return {
    axisKey: q.axisKey,
    prompt: q.prompt,
    helperText: q.helperText ?? "",
    multiSelect: q.multiSelect,
    maxSelections: q.maxSelections != null ? String(q.maxSelections) : "",
    hasAdvanced: q.hasAdvanced,
    options: q.options.map((o) => ({
      axisValueValue: o.axisValueValue,
      label: o.label,
      reasonText: o.reasonText ?? "",
      hasAdvanced: o.hasAdvanced,
    })),
  };
}

function emptyDraft(): QuestionDraft {
  return {
    axisKey: null,
    prompt: "",
    helperText: "",
    multiSelect: false,
    maxSelections: "",
    hasAdvanced: false,
    options: [
      { axisValueValue: null, label: "", reasonText: "", hasAdvanced: false },
      { axisValueValue: null, label: "", reasonText: "", hasAdvanced: false },
    ],
  };
}

function draftToInput(d: QuestionDraft): SimpleQuestionInput {
  const max = d.maxSelections.trim() === "" ? null : Number(d.maxSelections);
  return {
    axisKey: d.axisKey,
    prompt: d.prompt,
    helperText: d.helperText.trim() === "" ? null : d.helperText,
    multiSelect: d.multiSelect,
    maxSelections: Number.isFinite(max as number) ? (max as number | null) : null,
    options: d.options.map((o) => ({
      axisValueValue: o.axisValueValue,
      label: o.label,
      reasonText: o.reasonText.trim() === "" ? null : o.reasonText,
    })),
  };
}

function QuestionCard({
  draft,
  index,
  total,
  reordering,
  onDiscardNew,
  onMove,
}: {
  draft: QuestionDraft;
  index: number;
  total: number;
  reordering: boolean;
  onDiscardNew?: () => void;
  onMove?: (from: number, to: number) => void;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [local, setLocal] = useState(draft);
  const [dirty, setDirty] = useState(draft.axisKey === null);
  // Delete confirm is a two-stage state: null = not confirming; "generic" =
  // pre-submit "are you sure"; a number = the server said N rules depend on
  // this question (409 needsConfirm).
  const [confirmingDelete, setConfirmingDelete] = useState<null | "generic" | number>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "critical"; message: string } | null>(null);
  const [maxError, setMaxError] = useState<string | null>(null);
  // What the in-flight save submitted. If the merchant keeps typing while
  // the request runs, `local` diverges from this and the success handler
  // must NOT mark the card clean (their newest keystrokes are unsaved).
  const submittedRef = useRef<QuestionDraft | null>(null);
  const processedRef = useRef<ActionResponse | null>(null);

  // Resync from the loader after a successful save elsewhere, but never
  // while the merchant has unsaved edits in this card.
  useEffect(() => {
    if (!dirty) setLocal(draft);
  }, [draft, dirty]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    const data = fetcher.data;
    if (data.needsConfirm) {
      setConfirmingDelete(data.droppedRuleCount ?? 0);
      return;
    }
    if (data.success) {
      if (draft.axisKey === null) {
        // A saved brand-new card is replaced by its loader-backed twin.
        onDiscardNew?.();
        return;
      }
      if (submittedRef.current === local) {
        setDirty(false);
        setBanner({ tone: "success", message: "Question saved." });
      } else {
        // Edits landed mid-save; stay dirty so they can be saved too.
        setBanner({ tone: "success", message: "Question saved. You have newer unsaved edits." });
      }
      return;
    }
    if (data.error) setBanner({ tone: "critical", message: data.error });
  }, [fetcher.state, fetcher.data, draft.axisKey, local, onDiscardNew]);

  const update = (patch: Partial<QuestionDraft>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const updateOption = (i: number, patch: Partial<OptionDraft>) => {
    setLocal((prev) => ({
      ...prev,
      options: prev.options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    }));
    setDirty(true);
  };

  const save = () => {
    if (local.multiSelect && local.maxSelections.trim() !== "" && !/^[1-9][0-9]*$/.test(local.maxSelections.trim())) {
      setMaxError("Max picks must be a whole number above zero, or empty for unlimited.");
      return;
    }
    setMaxError(null);
    setBanner(null);
    setConfirmingDelete(null);
    submittedRef.current = local;
    const fd = new FormData();
    fd.append("intent", "upsert-question");
    fd.append("question", JSON.stringify(draftToInput(local)));
    fetcher.submit(fd, { method: "POST" });
  };

  const remove = (confirmed: boolean) => {
    if (!local.axisKey) return;
    setBanner(null);
    const fd = new FormData();
    fd.append("intent", "delete-question");
    fd.append("axisKey", local.axisKey);
    fd.append("confirmRuleDrop", confirmed ? "true" : "false");
    fetcher.submit(fd, { method: "POST" });
  };

  const saving = fetcher.state !== "idle";
  const isNew = draft.axisKey === null;
  // A brand-new card is replaced wholesale by its loader-backed twin after
  // save, so keystrokes typed mid-save would be silently lost — lock the
  // fields instead. Existing cards keep their divergence protection.
  const lockInputs = saving && isNew;

  // Keyboard/SR users: activating Delete disables the button they were on,
  // which would strand focus on <body>; move it to the confirm banner.
  const confirmRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (confirmingDelete !== null) confirmRef.current?.focus();
  }, [confirmingDelete]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {isNew ? "New question" : `Question ${index + 1}`}
          </Text>
          <InlineStack gap="200">
            {local.hasAdvanced && (
              <Badge tone="info">Has advanced settings</Badge>
            )}
            {!isNew && onMove && (
              <>
                <Button
                  variant="tertiary"
                  disabled={index === 0 || saving || reordering}
                  onClick={() => onMove(index, index - 1)}
                  accessibilityLabel="Move up"
                >
                  ↑
                </Button>
                <Button
                  variant="tertiary"
                  disabled={index === total - 1 || saving || reordering}
                  onClick={() => onMove(index, index + 1)}
                  accessibilityLabel="Move down"
                >
                  ↓
                </Button>
              </>
            )}
          </InlineStack>
        </InlineStack>

        {banner && confirmingDelete === null && (
          <Banner
            tone={banner.tone}
            onDismiss={() => setBanner(null)}
          >
            {banner.message}
          </Banner>
        )}
        {confirmingDelete !== null && (
          <div ref={confirmRef} tabIndex={-1} style={{ outline: "none" }}>
          <Banner
            tone="warning"
            title={
              typeof confirmingDelete === "number" && confirmingDelete > 0
                ? `Deleting this question also deletes ${confirmingDelete} recommendation ${confirmingDelete === 1 ? "rule" : "rules"}`
                : "Delete this question and its answers?"
            }
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {typeof confirmingDelete === "number" && confirmingDelete > 0
                  ? "Those rules were created in the advanced rules editor and depend on this question's answers. This can't be undone."
                  : "Shoppers will no longer be asked this question. This can't be undone."}
              </Text>
              <InlineStack gap="200">
                <Button
                  tone="critical"
                  loading={saving}
                  onClick={() => {
                    // First confirm submits unconfirmed; if rules depend on
                    // the question the server 409s back with the count and
                    // this banner upgrades to the rules variant.
                    const rulesKnown = typeof confirmingDelete === "number" && confirmingDelete > 0;
                    if (!rulesKnown) setConfirmingDelete(null);
                    remove(rulesKnown);
                  }}
                >
                  {typeof confirmingDelete === "number" && confirmingDelete > 0
                    ? "Delete question and rules"
                    : "Delete question"}
                </Button>
                <Button onClick={() => setConfirmingDelete(null)} disabled={saving}>
                  Cancel
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
          </div>
        )}

        <TextField
          label="Question"
          value={local.prompt}
          onChange={(v) => update({ prompt: v })}
          placeholder="e.g. What's the occasion?"
          disabled={lockInputs}
          autoComplete="off"
        />
        <TextField
          label="Helper text"
          value={local.helperText}
          onChange={(v) => update({ helperText: v })}
          placeholder="Optional line shown under the question"
          disabled={lockInputs}
          autoComplete="off"
        />
        <InlineStack gap="400" blockAlign="start">
          <Checkbox
            label="Shoppers can pick more than one answer"
            checked={local.multiSelect}
            onChange={(v) => update({ multiSelect: v })}
            disabled={lockInputs}
          />
          {local.multiSelect && (
            <div style={{ maxWidth: 200 }}>
              <TextField
                label="Max picks"
                type="number"
                value={local.maxSelections}
                onChange={(v) => {
                  setMaxError(null);
                  update({ maxSelections: v });
                }}
                placeholder="Unlimited"
                error={maxError ?? undefined}
                disabled={lockInputs}
                autoComplete="off"
              />
            </div>
          )}
        </InlineStack>

        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Answers
          </Text>
          <InlineStack gap="200">
            <div style={{ flex: 1 }}>
              <Text as="span" variant="bodySm" tone="subdued">
                Answer shown to shoppers
              </Text>
            </div>
            <div style={{ flex: 1 }}>
              <Text as="span" variant="bodySm" tone="subdued">
                "Why we picked this" on results (optional)
              </Text>
            </div>
            <div style={{ width: 32 }} />
          </InlineStack>
          {local.options.map((opt, i) => (
            <InlineStack key={`${opt.axisValueValue ?? "new"}-${i}`} gap="200" blockAlign="start">
              <div style={{ flex: 1, minWidth: 140 }}>
                <TextField
                  label={`Answer ${i + 1}`}
                  labelHidden
                  value={opt.label}
                  onChange={(v) => updateOption(i, { label: v })}
                  placeholder={`Answer ${i + 1}`}
                  disabled={lockInputs}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <TextField
                  label={`Reason for answer ${i + 1}, shown on result cards`}
                  labelHidden
                  value={opt.reasonText}
                  onChange={(v) => updateOption(i, { reasonText: v })}
                  placeholder="e.g. Great for everyday wear"
                  disabled={lockInputs}
                  autoComplete="off"
                />
              </div>
              <Button
                variant="tertiary"
                tone="critical"
                disabled={local.options.length <= 1 || lockInputs}
                onClick={() => {
                  setLocal((prev) => ({
                    ...prev,
                    options: prev.options.filter((_, j) => j !== i),
                  }));
                  setDirty(true);
                }}
                accessibilityLabel="Remove answer"
              >
                ✕
              </Button>
            </InlineStack>
          ))}
          <InlineStack>
            <Button
              variant="plain"
              disabled={lockInputs}
              onClick={() => {
                setLocal((prev) => ({
                  ...prev,
                  options: [
                    ...prev.options,
                    { axisValueValue: null, label: "", reasonText: "", hasAdvanced: false },
                  ],
                }));
                setDirty(true);
              }}
            >
              + Add answer
            </Button>
          </InlineStack>
        </BlockStack>

        <InlineStack gap="200">
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            {isNew ? "Create question" : "Save question"}
          </Button>
          {isNew ? (
            <Button onClick={onDiscardNew} disabled={saving}>
              Discard
            </Button>
          ) : (
            <Button
              tone="critical"
              variant="secondary"
              onClick={() => setConfirmingDelete("generic")}
              disabled={saving || confirmingDelete !== null}
            >
              Delete
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function QuizQuestions() {
  const { questions, photoAxes, ruleCount, draftExists } = useLoaderData<typeof loader>();
  const reorderFetcher = useFetcher<ActionResponse>();
  const [newDrafts, setNewDrafts] = useState<number[]>([]);
  const [nextNewId, setNextNewId] = useState(1);

  const reordering = reorderFetcher.state !== "idle";
  const move = (from: number, to: number) => {
    if (reordering) return;
    const keys = questions.map((q) => q.axisKey);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    const fd = new FormData();
    fd.append("intent", "reorder-questions");
    fd.append("axisKeys", JSON.stringify(keys));
    reorderFetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page
      title="Quiz questions"
      backAction={{ content: "Quiz", url: "/app/quiz" }}
      primaryAction={{
        content: "Add question",
        onAction: () => {
          setNewDrafts((prev) => [...prev, nextNewId]);
          setNextNewId((n) => n + 1);
        },
      }}
    >
      <TitleBar title="Quiz questions" />
      <BlockStack gap="500">
        <Banner
          tone="info"
          title="First: write your questions and answers"
          action={{ content: "Next: recommendation logic", url: "/app/quiz/logic" }}
        >
          Once your questions are set, describe what each answer should mean
          for recommendations on the Recommendation logic page. Conditional
          questions, images, and answer styling live in the advanced rules
          editor.
        </Banner>
        {draftExists && (
          <Banner tone="warning" title="You have an unpublished draft in the Quiz Builder">
            Changes you save here go live immediately. Publishing that draft
            later will replace them (the previous version is archived in
            version history).
          </Banner>
        )}
        {reorderFetcher.data?.error && (
          <Banner tone="critical">{reorderFetcher.data.error}</Banner>
        )}
        {reordering && (
          <Text as="p" variant="bodySm" tone="subdued">
            Reordering…
          </Text>
        )}

        {photoAxes.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Detected from the shopper's photo
                </Text>
                <Badge>Automatic</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {photoAxes.map((a) => a.label).join(", ")}: these aren't quiz
                questions. Gleame detects them from the selfie. Manage them in
                the advanced rules editor.
              </Text>
            </BlockStack>
          </Card>
        )}

        {questions.map((q, i) => (
          <QuestionCard
            key={q.axisKey}
            draft={toDraft(q)}
            index={i}
            total={questions.length}
            reordering={reordering}
            onMove={move}
          />
        ))}

        {newDrafts.map((id) => (
          <QuestionCard
            key={`new-${id}`}
            draft={emptyDraft()}
            index={questions.length}
            total={questions.length + 1}
            reordering={reordering}
            onDiscardNew={() => setNewDrafts((prev) => prev.filter((n) => n !== id))}
          />
        ))}

        {questions.length === 0 && newDrafts.length === 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                No questions yet
              </Text>
              <Text as="p" tone="subdued">
                Add your first question above, or let the Quiz Builder draft a
                full quiz from your catalog in one click.
              </Text>
              <InlineStack>
                <Button url="/app/quiz-builder">Open Quiz Builder</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {ruleCount > 0 && (
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">
              This shop also has {ruleCount} recommendation{" "}
              {ruleCount === 1 ? "rule" : "rules"} in the advanced rules
              editor. Deleting questions or answers they reference will warn
              you first.
            </Text>
            <Button variant="plain" url="/app/assistant/recommendations">
              Advanced rules editor
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
