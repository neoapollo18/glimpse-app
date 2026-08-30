// Axis-free question editing for the self-serve quiz pages.
//
// Merchants only ever see questions and answer options; each question's axis
// (and each option's axis value) is derived once at creation and then hidden.
// Keys are STABLE after creation — renames only change labels — so
// recommendation rules, showIf conditions, and quiz_question_guidance rows
// never orphan when a merchant rewords a question.
//
// Saves are PATCHES applied server-side against a fresh captureLiveConfig()
// snapshot (never a full client-built payload), so a stale admin tab can only
// affect the one question it edited — the wipe-and-rewrite RPC gets a payload
// that is byte-identical to live everywhere else.

import type { SaveRecommendationConfigInput } from "./quiz-draft.server";
import { normalizeFlowOrder } from "./quiz-config-schema.server";

type FlowQuestion = SaveRecommendationConfigInput["questions"][number];

// Same cast quiz-draft.server.ts uses at its normalizeFlowOrder call site —
// the draft schema's flow type and the save-input type are structurally
// interchangeable for ordering purposes.
function normalizeOrder(flow: SaveRecommendationConfigInput): SaveRecommendationConfigInput {
  return normalizeFlowOrder(
    flow as Parameters<typeof normalizeFlowOrder>[0],
  ) as SaveRecommendationConfigInput;
}

// ---------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------

/**
 * Derive a stable snake_case identifier from display text, unique against
 * `taken`. Matches the save RPC's ID constraint (^[a-z_][a-z0-9_]*$) and
 * never emits a leading underscore, so the reserved '__general' guidance
 * key can't collide.
 */
export function slugifyKey(text: string, taken: Set<string>): string {
  let base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (!base) base = "question";
  else if (/^[0-9]/.test(base)) base = `q_${base}`.slice(0, 40);
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

// ---------------------------------------------------------------------
// Merchant-facing shapes
// ---------------------------------------------------------------------

/** What the simple questions page edits. Hidden identity fields carry the
 * derived keys; null identity = "create". */
export interface SimpleQuestionInput {
  axisKey: string | null;
  prompt: string;
  helperText: string | null;
  multiSelect: boolean;
  maxSelections: number | null;
  options: Array<{
    axisValueValue: string | null;
    label: string;
    reasonText: string | null;
  }>;
}

export type QuestionPatch =
  | { kind: "upsert"; question: SimpleQuestionInput }
  | { kind: "delete"; axisKey: string; confirmRuleDrop: boolean }
  | { kind: "reorder"; axisKeys: string[] };

export type PatchResult =
  | { ok: true; flow: SaveRecommendationConfigInput; droppedRuleCount: number }
  | { ok: false; error: string; needsConfirm?: boolean; droppedRuleCount?: number };

/** Flow → merchant shape for the questions page loader. */
export function toSimpleQuestions(flow: SaveRecommendationConfigInput) {
  return flow.questions.map((q) => ({
    axisKey: q.axisKey,
    prompt: q.prompt,
    helperText: q.helperText ?? null,
    multiSelect: q.multiSelect ?? false,
    maxSelections: q.maxSelections ?? null,
    // Fields the simple page can't edit but should disclose (link to the
    // advanced editor instead of silently dropping them).
    hasAdvanced: Boolean(q.showIf || q.screenGroup || q.optionStyle),
    options: q.options.map((o) => ({
      axisValueValue: o.axisValueValue,
      label: o.label,
      reasonText: o.reasonText ?? null,
      hasAdvanced: Boolean(o.showIf || o.imageUrl || o.displayMeta || o.selectAll),
    })),
  }));
}

// ---------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------

function rulesReferencing(
  rules: SaveRecommendationConfigInput["rules"],
  axisKey: string,
  value?: string,
): number {
  return rules.filter((r) => {
    const v = r.criteria?.[axisKey];
    if (v === undefined) return false;
    return value === undefined || v === value;
  }).length;
}

function showIfReferences(
  flow: SaveRecommendationConfigInput,
  axisKey: string,
  value?: string,
): boolean {
  const hits = (cond: { axis_key: string; axis_value: string } | null | undefined) =>
    Boolean(cond && cond.axis_key === axisKey && (value === undefined || cond.axis_value === value));
  return flow.questions.some(
    (q) => hits(q.showIf) || q.options.some((o) => hits(o.showIf)),
  );
}

/**
 * Apply a patch to a live-config snapshot. Pure — returns a new flow (with
 * axis positions renormalized) or a friendly error. Everything the patch
 * doesn't mention is passed through untouched.
 */
export function applyQuestionPatch(
  flow: SaveRecommendationConfigInput,
  patch: QuestionPatch,
): PatchResult {
  if (patch.kind === "upsert") return applyUpsert(flow, patch.question);
  if (patch.kind === "delete") return applyDelete(flow, patch.axisKey, patch.confirmRuleDrop);
  return applyReorder(flow, patch.axisKeys);
}

function applyUpsert(
  flow: SaveRecommendationConfigInput,
  input: SimpleQuestionInput,
): PatchResult {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "The question needs a prompt." };
  const cleanOptions = input.options
    .map((o) => ({ ...o, label: o.label.trim() }))
    .filter((o) => o.label !== "" || o.axisValueValue !== null);
  if (cleanOptions.length === 0) {
    return { ok: false, error: "Add at least one answer option." };
  }
  if (cleanOptions.some((o) => !o.label)) {
    return { ok: false, error: "Every answer option needs a label." };
  }
  if (
    input.maxSelections != null &&
    !(Number.isInteger(input.maxSelections) && input.maxSelections > 0)
  ) {
    return { ok: false, error: "Max selections must be a positive whole number, or empty for unlimited." };
  }

  const axes = flow.axes.map((a) => ({ ...a, values: a.values.map((v) => ({ ...v })) }));
  const questions = flow.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) }));

  if (input.axisKey === null) {
    // -- Create --
    const takenKeys = new Set(axes.map((a) => a.key));
    const axisKey = slugifyKey(prompt, takenKeys);
    const takenValues = new Set<string>();
    const values = cleanOptions.map((o, j) => {
      const value = slugifyKey(o.label, takenValues);
      takenValues.add(value);
      return { value, label: o.label, position: j };
    });
    axes.push({
      key: axisKey,
      label: prompt,
      source: "user_question",
      position: axes.length,
      values,
    });
    questions.push({
      axisKey,
      prompt,
      helperText: input.helperText || null,
      multiSelect: input.multiSelect,
      maxSelections: input.multiSelect ? input.maxSelections : null,
      screenGroup: null,
      showIf: null,
      optionStyle: null,
      options: cleanOptions.map((o, j) => ({
        label: o.label,
        axisValueValue: values[j].value,
        botResponse: null,
        reasonText: o.reasonText || null,
        imageUrl: null,
        showIf: null,
        selectAll: false,
        displayMeta: null,
        position: j,
      })),
    });
    return { ok: true, flow: normalizeOrder({ ...flow, axes, questions }), droppedRuleCount: 0 };
  }

  // -- Update --
  const axis = axes.find((a) => a.key === input.axisKey);
  const question = questions.find((q) => q.axisKey === input.axisKey);
  if (!axis || !question) {
    return { ok: false, error: "That question no longer exists. Reload the page." };
  }

  // Hand-built configs can have several options recording the same answer
  // value (e.g. conditional variants of one option). The simple editor
  // identifies options BY value, so editing such a question here would
  // silently collapse those variants — hard-stop instead.
  const seenValues = new Set<string>();
  for (const o of question.options) {
    if (seenValues.has(o.axisValueValue)) {
      return {
        ok: false,
        error:
          "This question has multiple answer variants sharing one value. Edit it in the advanced rules editor to keep them intact.",
      };
    }
    seenValues.add(o.axisValueValue);
  }

  // Removed options: existing values no longer present in the patch. Block
  // removal when a rule or a showIf condition references the value — silent
  // cascade would change recommendations behind the merchant's back.
  const keptValues = new Set(
    cleanOptions.map((o) => o.axisValueValue).filter((v): v is string => v !== null),
  );
  for (const existing of question.options) {
    if (keptValues.has(existing.axisValueValue)) continue;
    const ruleHits = rulesReferencing(flow.rules, input.axisKey, existing.axisValueValue);
    if (ruleHits > 0) {
      return {
        ok: false,
        error: `Can't remove "${existing.label}": ${ruleHits} recommendation rule${ruleHits === 1 ? "" : "s"} in the advanced editor use${ruleHits === 1 ? "s" : ""} it. Remove those rules first.`,
      };
    }
    if (showIfReferences(flow, input.axisKey, existing.axisValueValue)) {
      return {
        ok: false,
        error: `Can't remove "${existing.label}": another question is shown conditionally based on it. Update that condition in the advanced editor first.`,
      };
    }
  }

  axis.label = prompt;
  question.prompt = prompt;
  question.helperText = input.helperText || null;
  question.multiSelect = input.multiSelect;
  question.maxSelections = input.multiSelect ? input.maxSelections : null;

  const valueByKey = new Map(axis.values.map((v) => [v.value, v]));
  const optionByValue = new Map(question.options.map((o) => [o.axisValueValue, o]));
  const takenValues = new Set(axis.values.map((v) => v.value));

  const newOptions: FlowQuestion["options"] = [];
  const newValueOrder: string[] = [];
  for (let j = 0; j < cleanOptions.length; j++) {
    const o = cleanOptions[j];
    if (o.axisValueValue !== null) {
      const existing = optionByValue.get(o.axisValueValue);
      const value = valueByKey.get(o.axisValueValue);
      if (!existing || !value) {
        return { ok: false, error: "An answer option no longer exists. Reload the page." };
      }
      // Preserve everything the simple page doesn't edit.
      newOptions.push({ ...existing, label: o.label, reasonText: o.reasonText || null, position: j });
      value.label = o.label;
      newValueOrder.push(value.value);
    } else {
      const valueKey = slugifyKey(o.label, takenValues);
      takenValues.add(valueKey);
      valueByKey.set(valueKey, { value: valueKey, label: o.label, position: 0 });
      newOptions.push({
        label: o.label,
        axisValueValue: valueKey,
        botResponse: null,
        reasonText: o.reasonText || null,
        imageUrl: null,
        showIf: null,
        selectAll: false,
        displayMeta: null,
        position: j,
      });
      newValueOrder.push(valueKey);
    }
  }
  question.options = newOptions;
  axis.values = newValueOrder.map((key, j) => {
    const v = valueByKey.get(key)!;
    return { ...v, position: j };
  });

  return { ok: true, flow: normalizeOrder({ ...flow, axes, questions }), droppedRuleCount: 0 };
}

function applyDelete(
  flow: SaveRecommendationConfigInput,
  axisKey: string,
  confirmRuleDrop: boolean,
): PatchResult {
  const axis = flow.axes.find((a) => a.key === axisKey);
  if (!axis) return { ok: false, error: "That question no longer exists. Reload the page." };
  if (axis.source === "photo") {
    return { ok: false, error: "Photo-detected traits can't be deleted here. Use the advanced rules editor." };
  }

  const droppedRuleCount = rulesReferencing(flow.rules, axisKey);
  if (droppedRuleCount > 0 && !confirmRuleDrop) {
    return {
      ok: false,
      needsConfirm: true,
      droppedRuleCount,
      error: `Deleting this question also deletes ${droppedRuleCount} recommendation rule${droppedRuleCount === 1 ? "" : "s"} that depend on it.`,
    };
  }

  const axes = flow.axes.filter((a) => a.key !== axisKey);
  // Null out conditions that referenced the deleted question — a dangling
  // showIf would fail save validation or hide questions forever.
  const questions = flow.questions
    .filter((q) => q.axisKey !== axisKey)
    .map((q) => ({
      ...q,
      showIf: q.showIf?.axis_key === axisKey ? null : q.showIf,
      options: q.options.map((o) => ({
        ...o,
        showIf: o.showIf?.axis_key === axisKey ? null : o.showIf,
      })),
    }));
  const rules = flow.rules.filter((r) => r.criteria?.[axisKey] === undefined);

  return {
    ok: true,
    flow: normalizeOrder({ ...flow, axes, questions, rules }),
    droppedRuleCount,
  };
}

function applyReorder(
  flow: SaveRecommendationConfigInput,
  axisKeys: string[],
): PatchResult {
  const byKey = new Map(flow.questions.map((q) => [q.axisKey, q]));
  if (
    axisKeys.length !== flow.questions.length ||
    new Set(axisKeys).size !== flow.questions.length ||
    axisKeys.some((k) => !byKey.has(k))
  ) {
    return { ok: false, error: "The question list changed. Reload the page and try again." };
  }
  const questions = axisKeys.map((k) => byKey.get(k)!);
  return { ok: true, flow: normalizeOrder({ ...flow, questions }), droppedRuleCount: 0 };
}

// Per-shop save serialization moved to shop-save-lock.server.ts so the
// draft publish and the advanced rules editor can share it without import
// cycles. Re-exported for existing importers.
export { withShopSaveLock } from "./shop-save-lock.server";

// Framing prompts live in quiz-guidance-shared.ts (client-safe — the logic
// page renders them in the browser).
