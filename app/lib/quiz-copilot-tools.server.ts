// Copilot patch tools (Phase 7).
//
// Each tool is a TARGETED patch against the draft — never a full-config
// regeneration — so every accepted call maps to one "Applied to X" change
// card with its own undo snapshot. Appliers are pure functions
// (draft, input, catalog) -> { ok, draft', summary } | { ok: false, error },
// unit-testable without any API calls.
//
// After every patch the ENTIRE flow is re-validated via the generation
// validator (converted back to its input shape), so a patch can never leave
// the draft in a state the publish path would reject.

import type Anthropic from "@anthropic-ai/sdk";
import {
  validateGeneratedConfig,
  QUESTION_OPTION_STYLES,
  GENERATED_COPY_KEYS,
  GENERATED_DESIGN_KEYS,
  HEX_RE,
  type CatalogProduct,
  type GeneratedQuizConfig,
  type NormalizedDraft,
} from "./quiz-config-schema.server";

export type DraftShape = NormalizedDraft;

export interface ChangeSummary {
  tool: string;
  target: string; // "Q2" | "Copy" | "Design" | "Rules" | "Guidance" | "Flow"
  description: string;
}

export type ApplyResult =
  | { ok: true; draft: DraftShape; summary: ChangeSummary; readOnly?: boolean; data?: unknown }
  | { ok: false; error: string };

// ---------------------------------------------------------------------
// Re-validation helper: draft flow -> generator schema shape -> validator
// ---------------------------------------------------------------------

function draftToGenerated(draft: DraftShape): GeneratedQuizConfig {
  return {
    axes: draft.flow.axes.map((a) => ({
      key: a.key,
      label: a.label,
      source: a.source,
      values: a.values.map((v) => ({ value: v.value, label: v.label, swatchColor: v.swatchColor ?? null })),
    })),
    questions: draft.flow.questions.map((q) => ({
      axisKey: q.axisKey,
      prompt: q.prompt,
      helperText: q.helperText ?? null,
      multiSelect: q.multiSelect ?? false,
      maxSelections: q.maxSelections ?? null,
      screenGroup: q.screenGroup ?? null,
      showIf: q.showIf ?? null,
      optionStyle: (q.optionStyle as (typeof QUESTION_OPTION_STYLES)[number] | null) ?? null,
      options: q.options.map((o) => ({
        label: o.label,
        axisValueValue: o.axisValueValue,
        reasonText: o.reasonText ?? null,
        showIf: o.showIf ?? null,
        selectAll: o.selectAll ?? false,
        displayMeta: o.displayMeta ?? null,
      })),
    })),
    rules: draft.flow.rules.map((r) => ({
      criteria: Object.entries(r.criteria).map(([axisKey, axisValue]) => ({ axisKey, axisValue })),
      productId: r.productId ?? null,
      variantId: r.variantId ?? null,
      rank: r.rank,
      quantity: r.quantity ?? 1,
    })),
    recommendationMode:
      (draft.settings.recommendation_mode as "matrix" | "ai" | "hybrid") ?? "matrix",
    aiGuidance: (draft.settings.ai_guidance as string | null) ?? null,
  };
}

/**
 * Re-validate the whole flow after a patch. On success the flow from the
 * validator is DISCARDED (the patch already produced the exact draft we
 * want, including fields like imageUrl that the generated schema drops) —
 * we only use the validator as a gate.
 */
function revalidate(draft: DraftShape, catalog: CatalogProduct[]): string | null {
  const result = validateGeneratedConfig(draftToGenerated(draft), catalog);
  if (!result.ok) return result.errors.slice(0, 5).join("; ");
  return null;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function questionIndex(draft: DraftShape, axisKey: string): number {
  return draft.flow.questions.findIndex((q) => q.axisKey === axisKey);
}

const qLabel = (idx: number) => `Q${idx + 1}`;

// ---------------------------------------------------------------------
// Appliers
// ---------------------------------------------------------------------

export function applyUpdateQuestion(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  const idx = questionIndex(draft, input.axisKey);
  if (idx === -1) return { ok: false, error: `No question for axis "${input.axisKey}"` };
  const next = clone(draft);
  const q = next.flow.questions[idx];
  const patch = input.patch ?? {};
  if (typeof patch.prompt === "string") q.prompt = patch.prompt;
  if ("helperText" in patch) q.helperText = patch.helperText ?? null;
  if ("multiSelect" in patch) q.multiSelect = Boolean(patch.multiSelect);
  if ("maxSelections" in patch) {
    const n = patch.maxSelections;
    q.maxSelections = Number.isInteger(n) && n >= 1 ? n : null;
  }
  if ("screenGroup" in patch) q.screenGroup = patch.screenGroup ?? null;
  if ("showIf" in patch) q.showIf = patch.showIf ?? null;
  if ("optionStyle" in patch) q.optionStyle = patch.optionStyle ?? null;
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_question", target: qLabel(idx), description: `Updated the ${qLabel(idx)} question` },
  };
}

export function applyUpdateQuestionOptions(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  const idx = questionIndex(draft, input.axisKey);
  if (idx === -1) return { ok: false, error: `No question for axis "${input.axisKey}"` };
  if (!Array.isArray(input.options) || input.options.length === 0) {
    return { ok: false, error: "options must be a non-empty array (full replacement)" };
  }
  const next = clone(draft);
  const q = next.flow.questions[idx];
  const axis = next.flow.axes.find((a) => a.key === q.axisKey)!;
  // Preserve admin-set option images by AXIS VALUE identity (not array
  // position — reorders/inserts/removals would reattach images to the wrong
  // answers otherwise).
  const imageByValue = new Map(
    q.options.filter((o) => o.imageUrl).map((o) => [o.axisValueValue, o.imageUrl!]),
  );
  q.options = input.options.map((opt: any, j: number) => {
    // Auto-declare new axis values referenced by the new options.
    if (!axis.values.some((v) => v.value === opt.axisValueValue)) {
      axis.values.push({
        value: String(opt.axisValueValue ?? ""),
        label: String(opt.valueLabel ?? opt.label ?? opt.axisValueValue ?? ""),
        position: axis.values.length,
        swatchColor: null,
      });
    }
    return {
      label: String(opt.label ?? ""),
      axisValueValue: String(opt.axisValueValue ?? ""),
      botResponse: null,
      reasonText: opt.reasonText ?? null,
      imageUrl: imageByValue.get(String(opt.axisValueValue ?? "")) ?? null,
      showIf: opt.showIf ?? null,
      selectAll: Boolean(opt.selectAll),
      displayMeta: opt.displayMeta ?? null,
      position: j,
    };
  });
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_question_options", target: qLabel(idx), description: `Rewrote the answers for ${qLabel(idx)}` },
  };
}

export function applyAddQuestion(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  const next = clone(draft);
  const q = input.question ?? {};
  let axisKey: string;
  if (input.axis) {
    axisKey = String(input.axis.key ?? "");
    if (next.flow.axes.some((a) => a.key === axisKey)) {
      return { ok: false, error: `Axis "${axisKey}" already exists; use existingAxisKey instead` };
    }
    next.flow.axes.push({
      key: axisKey,
      label: String(input.axis.label ?? axisKey),
      source: "user_question",
      position: next.flow.axes.length,
      values: (input.axis.values ?? []).map((v: any, j: number) => ({
        value: String(v.value ?? ""),
        label: String(v.label ?? ""),
        position: j,
        swatchColor: v.swatchColor ?? null,
      })),
    });
  } else if (input.existingAxisKey) {
    axisKey = String(input.existingAxisKey);
    if (!next.flow.axes.some((a) => a.key === axisKey)) {
      return { ok: false, error: `Axis "${axisKey}" does not exist` };
    }
  } else {
    return { ok: false, error: "Provide either axis (new) or existingAxisKey" };
  }
  const position = Math.max(0, Math.min(next.flow.questions.length, Number(input.position ?? next.flow.questions.length)));
  next.flow.questions.splice(position, 0, {
    axisKey,
    prompt: String(q.prompt ?? ""),
    helperText: q.helperText ?? null,
    multiSelect: Boolean(q.multiSelect),
    maxSelections: Number.isInteger(q.maxSelections) && q.maxSelections >= 1 ? q.maxSelections : null,
    screenGroup: q.screenGroup ?? null,
    showIf: q.showIf ?? null,
    optionStyle: q.optionStyle ?? null,
    options: (q.options ?? []).map((opt: any, j: number) => ({
      label: String(opt.label ?? ""),
      axisValueValue: String(opt.axisValueValue ?? ""),
      botResponse: null,
      reasonText: opt.reasonText ?? null,
      imageUrl: null,
      showIf: opt.showIf ?? null,
      selectAll: Boolean(opt.selectAll),
      displayMeta: opt.displayMeta ?? null,
      position: j,
    })),
  });
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "add_question", target: qLabel(position), description: `Added a new question at position ${position + 1}` },
  };
}

export function applyRemoveQuestion(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  const idx = questionIndex(draft, input.axisKey);
  if (idx === -1) return { ok: false, error: `No question for axis "${input.axisKey}"` };
  const next = clone(draft);
  next.flow.questions.splice(idx, 1);
  if (input.removeAxis) {
    const usedByRules = next.flow.rules.some((r) => input.axisKey in r.criteria);
    if (usedByRules) {
      return {
        ok: false,
        error: `Axis "${input.axisKey}" is referenced by rules. Update the rules first (update_rules), or call again with removeAxis=false`,
      };
    }
    const usedByShowIf =
      next.flow.questions.some((q) => q.showIf?.axis_key === input.axisKey) ||
      next.flow.questions.some((q) => q.options.some((o) => o.showIf?.axis_key === input.axisKey));
    if (usedByShowIf) {
      return { ok: false, error: `Axis "${input.axisKey}" is referenced by showIf conditions; update those questions first` };
    }
    next.flow.axes = next.flow.axes.filter((a) => a.key !== input.axisKey);
  }
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "remove_question", target: qLabel(idx), description: `Removed the "${input.axisKey}" question` },
  };
}

export function applyReorderQuestions(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  const order: string[] = input.axisKeysInOrder ?? [];
  const current = draft.flow.questions.map((q) => q.axisKey);
  if (order.length !== current.length || [...order].sort().join() !== [...current].sort().join()) {
    return { ok: false, error: `axisKeysInOrder must be a permutation of: ${current.join(", ")}` };
  }
  const next = clone(draft);
  next.flow.questions = order.map((key) => next.flow.questions.find((q) => q.axisKey === key)!);
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "reorder_questions", target: "Flow", description: "Reordered the questions" },
  };
}

// Superset of the generator's copy schema keys (asserted by unit test —
// the copilot can edit more fields than generation emits, never fewer).
const COPY_KEYS = new Set([
  ...GENERATED_COPY_KEYS,
  "quiz_gate_photo_label", "quiz_gate_skip_label", "quiz_privacy_note",
  "quiz_add_button_template", "quiz_view_product_label", "quiz_show_matches_label",
  "quiz_upsell_title", "quiz_upsell_body", "quiz_upsell_cta",
  "quiz_shade_headline", "quiz_shade_body", "quiz_shade_cta_photo", "quiz_shade_cta_manual",
  "quiz_visual_caption",
  // Studio slide editors (landing visual + alt audience)
  "quiz_before_image_url", "quiz_after_image_url",
  "quiz_alt_audience_label", "quiz_alt_audience_url",
]);

export function applyUpdateCopy(draft: DraftShape, input: any, _catalog: CatalogProduct[]): ApplyResult {
  const fields = input.fields ?? {};
  const keys = Object.keys(fields);
  if (keys.length === 0) return { ok: false, error: "fields is empty" };
  const bad = keys.filter((k) => !COPY_KEYS.has(k));
  if (bad.length) return { ok: false, error: `Unknown copy fields: ${bad.join(", ")}` };
  const next = clone(draft);
  for (const [k, v] of Object.entries(fields)) {
    next.settings[k] = Array.isArray(v) ? v.map((s) => String(s).slice(0, 400)) : String(v).slice(0, 400);
  }
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_copy", target: "Copy", description: `Updated ${keys.length} copy field${keys.length > 1 ? "s" : ""}` },
  };
}

const DESIGN_KEYS = new Set([
  ...GENERATED_DESIGN_KEYS,
  "quiz_heading_font_override", "quiz_body_font_override",
]);

export function applyUpdateDesignTokens(draft: DraftShape, input: any, _catalog: CatalogProduct[]): ApplyResult {
  const fields = input.fields ?? {};
  const keys = Object.keys(fields);
  if (keys.length === 0) return { ok: false, error: "fields is empty" };
  const bad = keys.filter((k) => !DESIGN_KEYS.has(k));
  if (bad.length) return { ok: false, error: `Unknown design tokens: ${bad.join(", ")}` };
  for (const [k, v] of Object.entries(fields)) {
    if (k.endsWith("_color") && v != null && !HEX_RE.test(String(v))) {
      return { ok: false, error: `${k} must be #rrggbb (got "${v}")` };
    }
  }
  const next = clone(draft);
  for (const [k, v] of Object.entries(fields)) next.settings[k] = v;
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_design_tokens", target: "Design", description: `Updated ${keys.length} design token${keys.length > 1 ? "s" : ""}` },
  };
}

export function applyUpdateRules(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  const mode = input.mode;
  const next = clone(draft);
  const toRule = (r: any) => ({
    criteria: Object.fromEntries((r.criteria ?? []).map((p: any) => [String(p.axisKey), String(p.axisValue)])),
    productId: r.productId ?? null,
    variantId: r.variantId ?? null,
    rank: Math.max(1, Math.round(Number(r.rank ?? 1))),
    quantity: r.quantity != null ? Math.max(1, Math.round(Number(r.quantity))) : 1,
  });
  if (mode === "replace_all") {
    next.flow.rules = (input.rules ?? []).map(toRule);
  } else if (mode === "add") {
    next.flow.rules.push(...(input.rules ?? []).map(toRule));
  } else if (mode === "remove") {
    const w = input.removeWhere ?? {};
    const before = next.flow.rules.length;
    next.flow.rules = next.flow.rules.filter((r) => {
      if (w.productId && r.productId === w.productId) return false;
      if (w.variantId && r.variantId === w.variantId) return false;
      if (w.criteriaAxis && w.criteriaAxis in r.criteria) return false;
      return true;
    });
    if (next.flow.rules.length === before) return { ok: false, error: "removeWhere matched no rules" };
  } else {
    return { ok: false, error: `mode must be replace_all | add | remove` };
  }
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_rules", target: "Rules", description: `Rules ${mode.replace("_", " ")} (now ${next.flow.rules.length})` },
  };
}

export function applyUpdateRecommendationMode(draft: DraftShape, input: any, catalog: CatalogProduct[]): ApplyResult {
  if (!["matrix", "ai", "hybrid"].includes(input.mode)) {
    return { ok: false, error: "mode must be matrix | ai | hybrid" };
  }
  const next = clone(draft);
  next.settings.recommendation_mode = input.mode;
  if (input.tuning && typeof input.tuning === "object") {
    next.settings.recommendation_tuning = {
      ...((next.settings.recommendation_tuning as object) ?? {}),
      ...input.tuning,
    };
  }
  const error = revalidate(next, catalog);
  if (error) return { ok: false, error };
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_recommendation_mode", target: "Rules", description: `Matching mode set to ${input.mode}` },
  };
}

export function applyUpdateGuidance(draft: DraftShape, input: any, _catalog: CatalogProduct[]): ApplyResult {
  const text = String(input.aiGuidance ?? "").trim();
  if (!text) return { ok: false, error: "aiGuidance is empty" };
  const next = clone(draft);
  next.settings.ai_guidance = text.slice(0, 8000);
  return {
    ok: true,
    draft: next,
    summary: { tool: "update_guidance", target: "Guidance", description: "Rewrote the AI merchandising guidance" },
  };
}

export function applyGetDraftDetails(draft: DraftShape, input: any, _catalog: CatalogProduct[]): ApplyResult {
  const section = input.section;
  let data: unknown;
  if (section === "question") {
    const idx = questionIndex(draft, input.axisKey ?? "");
    if (idx === -1) return { ok: false, error: `No question for axis "${input.axisKey}"` };
    data = { question: draft.flow.questions[idx], axis: draft.flow.axes.find((a) => a.key === input.axisKey) };
  } else if (section === "rules") {
    data = draft.flow.rules;
  } else if (section === "copy" || section === "design") {
    data = draft.settings;
  } else if (section === "guidance") {
    data = { aiGuidance: draft.settings.ai_guidance ?? null };
  } else {
    return { ok: false, error: "section must be question | rules | copy | design | guidance" };
  }
  return {
    ok: true,
    draft,
    readOnly: true,
    data,
    summary: { tool: "get_draft_details", target: "Flow", description: "Read draft details" },
  };
}

export const APPLIERS: Record<string, (d: DraftShape, i: any, c: CatalogProduct[]) => ApplyResult> = {
  update_question: applyUpdateQuestion,
  update_question_options: applyUpdateQuestionOptions,
  add_question: applyAddQuestion,
  remove_question: applyRemoveQuestion,
  reorder_questions: applyReorderQuestions,
  update_copy: applyUpdateCopy,
  update_design_tokens: applyUpdateDesignTokens,
  update_rules: applyUpdateRules,
  update_recommendation_mode: applyUpdateRecommendationMode,
  update_guidance: applyUpdateGuidance,
  get_draft_details: applyGetDraftDetails,
};

// ---------------------------------------------------------------------
// Anthropic tool definitions
// ---------------------------------------------------------------------

const showIfSchema = {
  type: "object" as const,
  properties: { axis_key: { type: "string" }, axis_value: { type: "string" } },
  required: ["axis_key", "axis_value"],
};

const optionSchema = {
  type: "object" as const,
  properties: {
    label: { type: "string" },
    axisValueValue: { type: "string", description: "snake_case axis value this option records; new values are auto-added to the axis" },
    valueLabel: { type: "string", description: "display label for a NEW axis value" },
    reasonText: { type: "string" },
    showIf: showIfSchema,
    selectAll: { type: "boolean" },
    displayMeta: {
      type: "object" as const,
      properties: {
        sublabel: { type: "string" },
        tag: { type: "string" },
        meterLabel: { type: "string" },
        meterPct: { type: "number" },
        swatch: { type: "string" },
        swatch2: { type: "string" },
      },
    },
  },
  required: ["label", "axisValueValue"],
};

const ruleSchema = {
  type: "object" as const,
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object" as const,
        properties: { axisKey: { type: "string" }, axisValue: { type: "string" } },
        required: ["axisKey", "axisValue"],
      },
    },
    productId: { type: "string" },
    variantId: { type: "string" },
    rank: { type: "number" },
    quantity: { type: "number" },
  },
  required: ["criteria", "rank"],
};

export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "update_question",
    description:
      "Edit ONE question's prompt, helper text, style, multi-select, screen group, or show-if condition in place. Call this for wording/tone/style changes to an existing question. Make the smallest edit that satisfies the request.",
    input_schema: {
      type: "object",
      properties: {
        axisKey: { type: "string", description: "axis key of the question to edit" },
        patch: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            helperText: { type: "string" },
            multiSelect: { type: "boolean" },
            maxSelections: { type: "number" },
            screenGroup: { type: "string" },
            showIf: showIfSchema,
            optionStyle: { type: "string", enum: [...QUESTION_OPTION_STYLES] },
          },
        },
      },
      required: ["axisKey", "patch"],
    },
  },
  {
    name: "update_question_options",
    description:
      "Replace the full option list of ONE question. Call this when rewording, adding, or removing answer choices. Existing option images are preserved by position.",
    input_schema: {
      type: "object",
      properties: {
        axisKey: { type: "string" },
        options: { type: "array", items: optionSchema },
      },
      required: ["axisKey", "options"],
    },
  },
  {
    name: "add_question",
    description:
      "Add a NEW question (with a new axis, or onto an existing axis that has no question yet) at a position in the flow. Call when the merchant asks for an additional question.",
    input_schema: {
      type: "object",
      properties: {
        axis: {
          type: "object",
          properties: {
            key: { type: "string" },
            label: { type: "string" },
            values: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  value: { type: "string" },
                  label: { type: "string" },
                  swatchColor: { type: "string" },
                },
                required: ["value", "label"],
              },
            },
          },
          required: ["key", "label", "values"],
        },
        existingAxisKey: { type: "string" },
        position: { type: "number", description: "0-based position in the question flow" },
        question: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            helperText: { type: "string" },
            multiSelect: { type: "boolean" },
            maxSelections: { type: "number" },
            screenGroup: { type: "string" },
            showIf: showIfSchema,
            optionStyle: { type: "string", enum: [...QUESTION_OPTION_STYLES] },
            options: { type: "array", items: optionSchema },
          },
          required: ["prompt", "options"],
        },
      },
      required: ["question", "position"],
    },
  },
  {
    name: "remove_question",
    description:
      "Remove a question (and optionally its axis when nothing else references it). Call when shortening the quiz. If rules reference the axis, update_rules first in the same turn.",
    input_schema: {
      type: "object",
      properties: {
        axisKey: { type: "string" },
        removeAxis: { type: "boolean" },
      },
      required: ["axisKey"],
    },
  },
  {
    name: "reorder_questions",
    description: "Reorder the question flow. Provide EVERY question's axis key in the new order.",
    input_schema: {
      type: "object",
      properties: { axisKeysInOrder: { type: "array", items: { type: "string" } } },
      required: ["axisKeysInOrder"],
    },
  },
  {
    name: "update_copy",
    description:
      "Update storefront copy fields (landing headline/eyebrow/subtext/trust items, gate, results, upsell, shade gate). Call for any wording change OUTSIDE the questions themselves.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "quiz_* copy fields to set; quiz_trust_items is an array of strings",
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "update_design_tokens",
    description:
      "Update visual design tokens: colors (#rrggbb), radii (px numbers), progress style (pips|bar|counter|none), intro layout (split|centered), animation (full|minimal|off), font overrides. Call for look-and-feel requests.",
    input_schema: {
      type: "object",
      properties: { fields: { type: "object" } },
      required: ["fields"],
    },
  },
  {
    name: "update_rules",
    description:
      "Change the recommendation rules: replace_all, add, or remove (removeWhere: {productId|variantId|criteriaAxis}). Only reference catalog product/variant ids and declared axis values.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["replace_all", "add", "remove"] },
        rules: { type: "array", items: ruleSchema },
        removeWhere: {
          type: "object",
          properties: {
            productId: { type: "string" },
            variantId: { type: "string" },
            criteriaAxis: { type: "string" },
          },
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "update_recommendation_mode",
    description: "Switch matching mode (matrix | ai | hybrid) and optionally adjust tuning knobs.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["matrix", "ai", "hybrid"] },
        tuning: { type: "object" },
      },
      required: ["mode"],
    },
  },
  {
    name: "update_guidance",
    description:
      "Replace the AI merchandising guidance (LAYER RULES + PRODUCT FACTS brief for the runtime ranker). Call when the merchant changes positioning, bestsellers, or exclusion rules in ai/hybrid mode.",
    input_schema: {
      type: "object",
      properties: { aiGuidance: { type: "string" } },
      required: ["aiGuidance"],
    },
  },
  {
    name: "get_draft_details",
    description:
      "READ the exact current JSON of a draft slice before editing it. Call this FIRST when you need precise current text (the conversation only carries a summary).",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["question", "rules", "copy", "design", "guidance"] },
        axisKey: { type: "string", description: "required when section=question" },
      },
      required: ["section"],
    },
  },
];
