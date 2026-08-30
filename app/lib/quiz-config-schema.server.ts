// Schema + validation layer for AI-generated quiz configs (Phase 5).
//
// PURE MODULE: no Supabase/env imports, so vitest can exercise it directly.
// The generator asks Claude for GeneratedQuizConfig as plain JSON text (NOT
// structured outputs: this schema exceeds the API's grammar-compilation caps
// of 24 optional / 16 union parameters, which 400'd every generation), then
// validateGeneratedConfig() enforces the referential rules a JSON schema
// cannot express and converts the result into the QuizDraft shape
// ({flow, settings}) consumed by quiz-draft.server.ts.
//
// Because the output isn't grammar-constrained, every flexible field is
// .nullish(): the model may omit a key OR send an explicit null and both
// parse. Rule criteria stay {axisKey, axisValue} PAIR ARRAYS (a stable shape
// for the model to emit) and are converted to Record<string, string> here.

// zod/v4 API (shipped inside the zod 3.25+ package under this subpath).
import { z } from "zod/v4";

// ---------------------------------------------------------------------
// Catalog input (passed in by callers; sourced from the synced tables)
// ---------------------------------------------------------------------

export interface CatalogVariant {
  id: string; // product_variants.id (uuid)
  title: string;
  displayColor?: string | null;
  price?: number | null;
  status?: string | null;
}

export interface CatalogProduct {
  id: string; // products.id (uuid)
  name: string;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[] | null;
  price?: number | null;
  status?: string | null;
  variants: CatalogVariant[];
}

// ---------------------------------------------------------------------
// Generated config schema (what Claude returns)
// ---------------------------------------------------------------------

const ID_RE = /^[a-z_][a-z0-9_]*$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const QUESTION_OPTION_STYLES = ["chips", "boxed", "list", "visual", "rich", "vibe"] as const;

const ShowIfSchema = z
  .object({
    axis_key: z.string(),
    axis_value: z.string(),
  })
  .nullish();

const DisplayMetaSchema = z
  .object({
    sublabel: z.string().nullish(),
    tag: z.string().nullish(),
    meterLabel: z.string().nullish(),
    meterPct: z.number().nullish(),
    swatch: z.string().nullish(),
    swatch2: z.string().nullish(),
  })
  .nullish();

const GeneratedAxisSchema = z.object({
  key: z.string(),
  label: z.string(),
  source: z.enum(["user_question", "photo"]),
  values: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      swatchColor: z.string().nullish(),
    }),
  ),
});

const GeneratedOptionSchema = z.object({
  label: z.string(),
  axisValueValue: z.string(),
  reasonText: z.string().nullish(),
  showIf: ShowIfSchema,
  selectAll: z.boolean().nullish(),
  displayMeta: DisplayMetaSchema,
});

const GeneratedQuestionSchema = z.object({
  axisKey: z.string(),
  prompt: z.string(),
  helperText: z.string().nullish(),
  multiSelect: z.boolean().nullish(),
  maxSelections: z.number().nullish(),
  screenGroup: z.string().nullish(),
  showIf: ShowIfSchema,
  optionStyle: z.enum(QUESTION_OPTION_STYLES).nullish(),
  options: z.array(GeneratedOptionSchema),
});

const GeneratedRuleSchema = z.object({
  // Pair array (structured outputs can't do records); converted to
  // Record<string,string> during normalization.
  criteria: z.array(z.object({ axisKey: z.string(), axisValue: z.string() })),
  productId: z.string().nullish(),
  variantId: z.string().nullish(),
  rank: z.number(),
  quantity: z.number().nullish(),
});

const CopyFieldsSchema = z.object({
  quiz_eyebrow: z.string().nullish(),
  quiz_headline: z.string().nullish(),
  quiz_subtext: z.string().nullish(),
  quiz_trust_items: z.array(z.string()).nullish(),
  quiz_gate_headline: z.string().nullish(),
  quiz_gate_helper: z.string().nullish(),
  quiz_results_headline_photo: z.string().nullish(),
  quiz_results_headline_nophoto: z.string().nullish(),
  quiz_results_subtext: z.string().nullish(),
  quiz_best_match_pill: z.string().nullish(),
  quiz_also_matched_label: z.string().nullish(),
  quiz_retake_label: z.string().nullish(),
});
const GeneratedCopySchema = CopyFieldsSchema.nullish();

const DesignTokenFieldsSchema = z.object({
  quiz_accent_color: z.string().nullish(),
  quiz_ink_color: z.string().nullish(),
  quiz_card_bg_color: z.string().nullish(),
  quiz_line_color: z.string().nullish(),
  quiz_cta_color: z.string().nullish(),
  quiz_button_radius: z.number().nullish(),
  quiz_card_radius: z.number().nullish(),
  quiz_progress_style: z.enum(["pips", "bar", "counter", "none"]).nullish(),
  quiz_intro_layout: z.enum(["split", "centered"]).nullish(),
  quiz_animation_style: z.enum(["full", "minimal", "off"]).nullish(),
});
const GeneratedDesignTokensSchema = DesignTokenFieldsSchema.nullish();

// Canonical key lists for the other whitelists (copilot COPY_KEYS/DESIGN_KEYS)
// to be tested against — the anti-drift contract lives in the unit tests.
export const GENERATED_COPY_KEYS = Object.keys(CopyFieldsSchema.shape);
export const GENERATED_DESIGN_KEYS = Object.keys(DesignTokenFieldsSchema.shape);
// Radius columns are INTEGER 0-60 in the DB (migration 049 CHECK) — the
// publish path hard-rejects violations, so normalize here.
const RADIUS_KEYS = new Set(["quiz_button_radius", "quiz_card_radius"]);

export const GeneratedQuizConfigSchema = z.object({
  // Top-level arrays tolerate omission/null and normalize to [] — an
  // ai-mode config legitimately has no rules, and a MISSING array should
  // fail in the validator (friendly message + repair round-trip), not at
  // JSON parse where the repair loop can't see it.
  axes: z.array(GeneratedAxisSchema).nullish().transform((v) => v ?? []),
  questions: z.array(GeneratedQuestionSchema).nullish().transform((v) => v ?? []),
  rules: z.array(GeneratedRuleSchema).nullish().transform((v) => v ?? []),
  recommendationMode: z.enum(["matrix", "ai", "hybrid"]),
  aiGuidance: z.string().nullish(),
  copy: GeneratedCopySchema,
  designTokens: GeneratedDesignTokensSchema,
});

export type GeneratedQuizConfig = z.infer<typeof GeneratedQuizConfigSchema>;

// ---------------------------------------------------------------------
// Caps (enforced in code, not just prompt)
// ---------------------------------------------------------------------

// Upper BOUNDS, not generation targets. Deliberately looser than the prompt's
// guidance (8 questions, 2-8 options) because the same validator re-gates
// every copilot patch on drafts captured from manually-authored LIVE configs,
// which legally exceed AI guidance (ORLY's colors question has 13 chips).
// Caps tighter than real configs would make the copilot reject every edit.
export const CAPS = {
  maxAxes: 16,
  maxValuesPerAxis: 24,
  maxQuestions: 12,
  minOptionsPerQuestion: 2,
  maxOptionsPerQuestion: 16,
  maxRules: 1000,
  maxCopyLength: 400,
  maxGuidanceLength: 8000,
} as const;

/**
 * Shared live-row predicates (migration 057): status NULL means the row
 * predates catalog sync and is always live. Keep in sync with the copies in
 * supabase.server.ts (this module must stay import-pure for unit tests).
 */
export const isLiveProduct = (p: { status?: string | null }) => p.status == null || p.status === "active";
export const isLiveVariant = (v: { status?: string | null }) => v.status !== "deleted";

// ---------------------------------------------------------------------
// Validation + normalization into QuizDraft shape
// ---------------------------------------------------------------------

// Structurally identical to quiz-draft.server's QuizDraft, but declared
// locally so this module stays dependency-free for unit tests.
export interface NormalizedDraft {
  flow: {
    axes: Array<{
      key: string;
      label: string;
      source: "photo" | "user_question";
      position: number;
      values: Array<{ value: string; label: string; position: number; swatchColor?: string | null }>;
    }>;
    questions: Array<{
      axisKey: string;
      prompt: string;
      helperText?: string | null;
      multiSelect?: boolean;
      maxSelections?: number | null;
      screenGroup?: string | null;
      showIf?: { axis_key: string; axis_value: string } | null;
      optionStyle?: string | null;
      options: Array<{
        label: string;
        axisValueValue: string;
        botResponse: string | null;
        reasonText?: string | null;
        imageUrl?: string | null;
        showIf?: { axis_key: string; axis_value: string } | null;
        selectAll?: boolean;
        displayMeta?: {
          sublabel?: string;
          tag?: string;
          meterLabel?: string;
          meterPct?: number;
          swatch?: string;
          swatch2?: string;
        } | null;
        position: number;
      }>;
    }>;
    rules: Array<{
      criteria: Record<string, string>;
      variantId?: string | null;
      productId?: string | null;
      rank: number;
      quantity?: number;
    }>;
  };
  settings: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  draft: NormalizedDraft | null;
}

const trimOrNull = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

export function validateGeneratedConfig(
  config: GeneratedQuizConfig,
  catalog: CatalogProduct[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- axes ----
  if (config.axes.length === 0) errors.push("No axes generated");
  if (config.axes.length > CAPS.maxAxes) errors.push(`Too many axes (${config.axes.length} > ${CAPS.maxAxes})`);
  const axisByKey = new Map<string, GeneratedQuizConfig["axes"][number]>();
  for (const axis of config.axes) {
    if (!ID_RE.test(axis.key)) errors.push(`Axis key "${axis.key}" is not lower snake_case`);
    if (axisByKey.has(axis.key)) errors.push(`Duplicate axis key "${axis.key}"`);
    axisByKey.set(axis.key, axis);
    if (axis.values.length === 0) errors.push(`Axis "${axis.key}" has no values`);
    if (axis.values.length > CAPS.maxValuesPerAxis) {
      errors.push(`Axis "${axis.key}" has too many values (${axis.values.length} > ${CAPS.maxValuesPerAxis})`);
    }
    const seenValues = new Set<string>();
    for (const v of axis.values) {
      if (!ID_RE.test(v.value)) errors.push(`Axis "${axis.key}" value "${v.value}" is not lower snake_case`);
      if (seenValues.has(v.value)) errors.push(`Axis "${axis.key}" has duplicate value "${v.value}"`);
      seenValues.add(v.value);
      if (v.swatchColor && !HEX_RE.test(v.swatchColor)) {
        warnings.push(`Axis "${axis.key}" value "${v.value}" swatch "${v.swatchColor}" is not #rrggbb; dropped`);
        v.swatchColor = null;
      }
    }
  }

  const axisHasValue = (axisKey: string, value: string): boolean =>
    axisByKey.get(axisKey)?.values.some((v) => v.value === value) ?? false;

  // ---- questions ----
  if (config.questions.length === 0) errors.push("No questions generated");
  if (config.questions.length > CAPS.maxQuestions) {
    errors.push(`Too many questions (${config.questions.length} > ${CAPS.maxQuestions})`);
  }
  const askedAxes: string[] = [];
  const questionAxisKeys = new Set<string>();
  for (const [qi, q] of config.questions.entries()) {
    const axis = axisByKey.get(q.axisKey);
    if (!axis) {
      errors.push(`Question ${qi + 1} references unknown axis "${q.axisKey}"`);
      continue;
    }
    if (axis.source !== "user_question") {
      errors.push(`Question ${qi + 1} targets photo axis "${q.axisKey}" (photo axes are classified, not asked)`);
    }
    if (questionAxisKeys.has(q.axisKey)) errors.push(`Multiple questions target axis "${q.axisKey}"`);
    questionAxisKeys.add(q.axisKey);

    if (q.options.length < CAPS.minOptionsPerQuestion || q.options.length > CAPS.maxOptionsPerQuestion) {
      errors.push(
        `Question ${qi + 1} ("${q.axisKey}") has ${q.options.length} options (allowed ${CAPS.minOptionsPerQuestion}-${CAPS.maxOptionsPerQuestion})`,
      );
    }
    for (const opt of q.options) {
      if (!axisHasValue(q.axisKey, opt.axisValueValue)) {
        errors.push(`Question "${q.axisKey}" option "${opt.label}" maps to undeclared value "${opt.axisValueValue}"`);
      }
      if (opt.showIf) {
        if (!askedAxes.includes(opt.showIf.axis_key)) {
          errors.push(`Option "${opt.label}" showIf references axis "${opt.showIf.axis_key}" not asked earlier`);
        } else if (!axisHasValue(opt.showIf.axis_key, opt.showIf.axis_value)) {
          errors.push(`Option "${opt.label}" showIf references unknown value "${opt.showIf.axis_value}"`);
        }
      }
      const meterPct = opt.displayMeta?.meterPct;
      if (meterPct != null && (meterPct < 0 || meterPct > 100)) {
        warnings.push(`Option "${opt.label}" meterPct ${meterPct} clamped to 0-100`);
        opt.displayMeta!.meterPct = Math.max(0, Math.min(100, meterPct));
      }
      // The publish path (saveRecommendationConfig) hard-rejects non-hex
      // displayMeta swatches; mutate in place so the copilot's shared-ref
      // draft is fixed too, not just the generator's normalized copy.
      if (opt.displayMeta?.swatch && !HEX_RE.test(opt.displayMeta.swatch)) {
        warnings.push(`Option "${opt.label}" swatch "${opt.displayMeta.swatch}" is not #rrggbb; dropped`);
        opt.displayMeta.swatch = undefined;
      }
      if (opt.displayMeta?.swatch2 && !HEX_RE.test(opt.displayMeta.swatch2)) {
        warnings.push(`Option "${opt.label}" swatch2 "${opt.displayMeta.swatch2}" is not #rrggbb; dropped`);
        opt.displayMeta.swatch2 = undefined;
      }
    }
    if (q.showIf) {
      if (!askedAxes.includes(q.showIf.axis_key)) {
        errors.push(`Question "${q.axisKey}" showIf references axis "${q.showIf.axis_key}" not asked earlier`);
      } else if (!axisHasValue(q.showIf.axis_key, q.showIf.axis_value)) {
        errors.push(`Question "${q.axisKey}" showIf references unknown value "${q.showIf.axis_value}"`);
      }
    }
    // Publish path requires a positive INTEGER (or null) regardless of
    // multiSelect — normalize anything else away.
    if (q.maxSelections != null && (!Number.isInteger(q.maxSelections) || q.maxSelections < 1)) {
      warnings.push(`Question "${q.axisKey}" maxSelections ${q.maxSelections} dropped (must be a positive integer)`);
      q.maxSelections = null;
    }
    askedAxes.push(q.axisKey);
  }

  // ---- rules (hallucinated targets are DROPPED with warnings, not errors) ----
  const productIds = new Set(catalog.filter(isLiveProduct).map((p) => p.id));
  const variantIds = new Set(
    catalog.flatMap((p) => p.variants.filter(isLiveVariant).map((v) => v.id)),
  );
  if (config.rules.length > CAPS.maxRules) {
    warnings.push(`Rule list truncated from ${config.rules.length} to ${CAPS.maxRules}`);
    config.rules = config.rules.slice(0, CAPS.maxRules);
  }
  const keptRules: NormalizedDraft["flow"]["rules"] = [];
  for (const [ri, rule] of config.rules.entries()) {
    const hasProduct = Boolean(rule.productId);
    const hasVariant = Boolean(rule.variantId);
    if (hasProduct === hasVariant) {
      warnings.push(`Rule ${ri + 1} dropped: needs exactly one of productId/variantId`);
      continue;
    }
    if (hasProduct && !productIds.has(rule.productId!)) {
      warnings.push(`Rule ${ri + 1} dropped: product ${rule.productId} not in catalog`);
      continue;
    }
    if (hasVariant && !variantIds.has(rule.variantId!)) {
      warnings.push(`Rule ${ri + 1} dropped: variant ${rule.variantId} not in catalog`);
      continue;
    }
    const criteria: Record<string, string> = {};
    let criteriaOk = true;
    for (const pair of rule.criteria) {
      if (!axisByKey.has(pair.axisKey)) {
        warnings.push(`Rule ${ri + 1} dropped: unknown criteria axis "${pair.axisKey}"`);
        criteriaOk = false;
        break;
      }
      if (!axisHasValue(pair.axisKey, pair.axisValue)) {
        warnings.push(`Rule ${ri + 1} dropped: unknown criteria value "${pair.axisKey}=${pair.axisValue}"`);
        criteriaOk = false;
        break;
      }
      criteria[pair.axisKey] = pair.axisValue;
    }
    if (!criteriaOk) continue;
    keptRules.push({
      criteria,
      productId: rule.productId ?? null,
      variantId: rule.variantId ?? null,
      // Publish path requires a positive rank — clamp, never emit 0.
      rank: Math.max(1, Math.round(rule.rank)),
      quantity: rule.quantity != null ? Math.max(1, Math.round(rule.quantity)) : 1,
    });
  }
  if (keptRules.length === 0 && config.recommendationMode === "matrix") {
    errors.push(
      config.rules.length > 0
        ? "All rules were dropped (hallucinated targets?) but recommendationMode is matrix"
        : "recommendationMode is matrix but there are no rules — add rules or switch to ai/hybrid",
    );
  }

  // ---- settings (copy + design + mode + guidance) ----
  const settings: Record<string, unknown> = {
    recommendation_mode: config.recommendationMode,
  };
  const guidance = trimOrNull(config.aiGuidance ?? null);
  if (guidance) {
    settings.ai_guidance = guidance.slice(0, CAPS.maxGuidanceLength);
  } else if (config.recommendationMode !== "matrix") {
    warnings.push("recommendationMode is ai/hybrid but no aiGuidance was generated");
  }
  for (const [key, value] of Object.entries(config.copy ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      settings[key] = value.map((s) => String(s).slice(0, CAPS.maxCopyLength));
    } else {
      const t = trimOrNull(String(value));
      if (t) settings[key] = t.slice(0, CAPS.maxCopyLength);
    }
  }
  for (const [key, value] of Object.entries(config.designTokens ?? {})) {
    if (value == null) continue;
    if (key.endsWith("_color") && !HEX_RE.test(String(value))) {
      warnings.push(`Design token ${key}="${value}" is not #rrggbb; dropped`);
      continue;
    }
    if (RADIUS_KEYS.has(key)) {
      // DB CHECK is integer 0-60 (migration 049) — clamp instead of failing
      // at publish time.
      const clamped = Math.max(0, Math.min(60, Math.round(Number(value))));
      if (clamped !== value) warnings.push(`Design token ${key}=${value} clamped to ${clamped}`);
      settings[key] = clamped;
      continue;
    }
    settings[key] = value;
  }

  if (errors.length > 0) return { ok: false, errors, warnings, draft: null };

  // .nullish() fields mean displayMeta can arrive with explicit nulls; scrub
  // them so the DB stores only meaningful keys, and an all-null meta
  // collapses to no meta at all.
  type DraftDisplayMeta = NonNullable<
    NormalizedDraft["flow"]["questions"][number]["options"][number]["displayMeta"]
  >;
  const scrubDisplayMeta = (
    meta: GeneratedQuizConfig["questions"][number]["options"][number]["displayMeta"],
  ): DraftDisplayMeta | null => {
    if (!meta) return null;
    const out: DraftDisplayMeta = {};
    if (meta.sublabel) out.sublabel = meta.sublabel;
    if (meta.tag) out.tag = meta.tag;
    if (meta.meterLabel) out.meterLabel = meta.meterLabel;
    if (meta.meterPct != null) out.meterPct = meta.meterPct;
    if (meta.swatch) out.swatch = meta.swatch;
    if (meta.swatch2) out.swatch2 = meta.swatch2;
    return Object.keys(out).length > 0 ? out : null;
  };

  const draft: NormalizedDraft = {
    flow: {
      axes: config.axes.map((a, i) => ({
        key: a.key,
        label: a.label.trim(),
        source: a.source,
        position: i,
        values: a.values.map((v, j) => ({
          value: v.value,
          label: v.label.trim(),
          position: j,
          swatchColor: v.swatchColor ?? null,
        })),
      })),
      questions: config.questions.map((q) => ({
        axisKey: q.axisKey,
        prompt: q.prompt.trim(),
        helperText: trimOrNull(q.helperText),
        multiSelect: q.multiSelect ?? false,
        maxSelections: q.maxSelections ?? null,
        screenGroup: trimOrNull(q.screenGroup),
        showIf: q.showIf ?? null,
        optionStyle: q.optionStyle ?? null,
        options: q.options.map((opt, j) => ({
          label: opt.label.trim(),
          axisValueValue: opt.axisValueValue,
          botResponse: null,
          reasonText: trimOrNull(opt.reasonText),
          imageUrl: null,
          showIf: opt.showIf ?? null,
          selectAll: opt.selectAll ?? false,
          displayMeta: scrubDisplayMeta(opt.displayMeta),
          position: j,
        })),
      })),
      rules: keptRules,
    },
    settings,
  };

  return { ok: true, errors, warnings, draft };
}

// ---------------------------------------------------------------------
// Flow-order normalization
// ---------------------------------------------------------------------

/**
 * The storefront question order comes from recommendation_axes.position (the
 * save RPC never stores a question position), while drafts/preview/copilot
 * treat flow.questions ARRAY order as the order. Renumber axis positions from
 * the question array so what the merchant previewed is what publishes:
 * user_question axes take their question's index, remaining axes (photo,
 * unreferenced) follow in their existing relative order.
 */
export function normalizeFlowOrder<T extends NormalizedDraft["flow"]>(flow: T): T {
  const questionOrder = new Map(flow.questions.map((q, i) => [q.axisKey, i]));
  let tail = flow.questions.length;
  const axes = [...flow.axes]
    .sort((a, b) => {
      const qa = questionOrder.get(a.key);
      const qb = questionOrder.get(b.key);
      if (qa != null && qb != null) return qa - qb;
      if (qa != null) return -1;
      if (qb != null) return 1;
      return (a.position ?? 0) - (b.position ?? 0);
    })
    .map((axis) => ({
      ...axis,
      position: questionOrder.get(axis.key) ?? tail++,
    }));
  return { ...flow, axes };
}

// ---------------------------------------------------------------------
// Catalog serialization (deterministic — byte-stable = prompt-cacheable)
// ---------------------------------------------------------------------

export const CATALOG_MAX_PRODUCTS = 300;

/**
 * One line per product, sorted by id. NO timestamps, NO unsorted maps —
 * any nondeterminism here invalidates the prompt-cache prefix on every call.
 */
export function serializeCatalog(
  catalog: CatalogProduct[],
  opts: { maxProducts?: number; priorityProductIds?: string[] } = {},
): { text: string; included: number; truncated: number } {
  const max = opts.maxProducts ?? CATALOG_MAX_PRODUCTS;
  const priority = new Set(opts.priorityProductIds ?? []);

  const active = catalog
    .filter(isLiveProduct)
    .slice()
    .sort((a, b) => {
      const pa = priority.has(a.id) ? 0 : 1;
      const pb = priority.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const included = active.slice(0, max);
  const lines = included.map((p) => {
    const parts = [
      `p:${p.id}`,
      p.name,
      p.productType || "-",
      p.vendor || "-",
      p.price != null ? `$${p.price}` : "-",
      p.tags && p.tags.length ? `tags:${[...p.tags].sort().join("|")}` : "tags:-",
    ];
    const variants = p.variants
      .filter(isLiveVariant)
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((v) => `v:${v.id} ${v.title}${v.displayColor ? ` ${v.displayColor}` : ""}`)
      .join("; ");
    return `${parts.join(" | ")} | variants: ${variants || "-"}`;
  });

  const truncated = active.length - included.length;
  const header =
    truncated > 0
      ? `# CATALOG (${included.length} of ${active.length} products; ${truncated} omitted — do not assume completeness)\n`
      : `# CATALOG (${included.length} products)\n`;
  return { text: header + lines.join("\n"), included: included.length, truncated };
}
