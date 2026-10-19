// Which prompt (and reference images) a quiz try-on would use for one
// product or variant. Pure and shared: the transform itself
// (tryon-transform.server.ts) and quiz-recommend's per-match `tryon` flag
// both read it, so "the results offer a try-on" and "the server can
// generate one" can't drift apart.

import { coerceReferenceImageUrlList, parseReferenceImageUrls } from "./reference-images";

type PromptSource = {
  id?: string;
  transformation_prompt?: string | null;
  reference_image_url?: string | null;
  reference_image_urls?: unknown;
  multi_set_prompt?: string | null;
  multi_set_reference_urls?: unknown;
};

export type TryonPromptArgs = {
  product: PromptSource;
  variant: PromptSource | null;
  quantity?: number;
  /** Shop-wide multi-set prompt (chat_assistant_config.quiz_multi_set_prompt). */
  multiSetFallbackPrompt?: string | null;
};

export type ResolvedTryonPrompt = {
  /** Empty (null, undefined or "") when nothing is configured. */
  prompt: string | null | undefined;
  referenceUrls: string[];
  /** A product/variant multi_set_prompt was skipped: it has no multi-set
   * reference photos (the transform logs this). */
  multiSetWithoutRefs: boolean;
};

/**
 * Variant config wins over product config, per field. When `quantity` >= 2
 * the multi-set prompt REPLACES the base prompt: the variant's, else the
 * product's, and only together with its own multi-set reference images (a
 * multi-set prompt without them falls back); the shop-wide fallback prompt
 * is the ref-less last resort. Nothing configured means single-set config.
 */
export function resolveTryonPrompt(args: TryonPromptArgs): ResolvedTryonPrompt {
  const { product, variant } = args;
  const source = variant || product;
  const quantity = Math.max(1, Math.round(args.quantity ?? 1));
  const firstNonEmpty = (...lists: string[][]) => lists.find((l) => l.length > 0) ?? [];

  // Product/variant multi-set prompts are written against their multi-set
  // reference photos (the finished N-set look); firing one with single-set
  // refs would tell the model to read two-set density off a one-set photo.
  // No multi-set refs = drop back to single-set config for that level. The
  // shop-wide fallback prompt is generic text and needs no refs.
  let multiSetPrompt = quantity >= 2
    ? (variant?.multi_set_prompt || product.multi_set_prompt || null)
    : null;
  let multiSetRefs: string[] = [];
  let multiSetWithoutRefs = false;
  if (multiSetPrompt) {
    multiSetRefs = firstNonEmpty(
      coerceReferenceImageUrlList(variant?.multi_set_reference_urls),
      coerceReferenceImageUrlList(product.multi_set_reference_urls),
    );
    if (multiSetRefs.length === 0) {
      multiSetWithoutRefs = true;
      multiSetPrompt = null;
    }
  }
  if (!multiSetPrompt && quantity >= 2 && args.multiSetFallbackPrompt) {
    multiSetPrompt = args.multiSetFallbackPrompt;
  }

  const prompt = multiSetPrompt
    ? multiSetPrompt.replace(/\{count\}/g, String(quantity))
    : (source.transformation_prompt || product.transformation_prompt);
  const referenceUrls = multiSetRefs.length > 0
    ? multiSetRefs
    : variant
      ? firstNonEmpty(parseReferenceImageUrls(variant), parseReferenceImageUrls(product))
      : parseReferenceImageUrls(product);

  return { prompt, referenceUrls, multiSetWithoutRefs };
}

/**
 * Whether a quiz try-on for this product/variant has a prompt to run. A
 * product nobody set up for try-on has none, and the model has nothing to
 * render, so the quiz must not offer a try-on for it.
 */
export function tryonReady(args: TryonPromptArgs): boolean {
  const { prompt } = resolveTryonPrompt(args);
  return typeof prompt === "string" && prompt.trim().length > 0;
}
