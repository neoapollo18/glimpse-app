// Shared try-on transform pipeline, extracted from chat-recommend so the
// quiz page's per-card try-on endpoint runs the identical model-selection /
// reference-image / fallback chain. Returns the raw transform outcome;
// callers assemble their own wire objects.

import {
  transformImage,
  transformImageWithOpenAI,
  GEMINI_MODEL_FLASH,
  MODEL_OPENAI,
  MODEL_OPENAI_2,
  isOpenAIModel,
  type ReferenceImagePart,
} from "./ai.server";
import { parseReferenceImageUrls } from "./reference-images";
import { safeFetch } from "./safe-fetch.server";
import { trackTransformationEvent } from "./supabase.server";
import type { EngineProduct, EngineVariant } from "./recommendation-engine.server";

export type TransformOutcome = {
  tryOnPreview: string | null;
  error: string | null;
};

/**
 * Transform a shopper photo with a candidate's prompt. Variant config wins
 * over product config when present; falls back per field so a variant with
 * a missing prompt still uses the product's prompt.
 *
 * `widgetType` is recorded on the transformation analytics event
 * ("chat" for the assistant, "quiz" for the quiz page).
 */
export async function transformCandidateImage(args: {
  product: EngineProduct;
  variant: EngineVariant | null;
  base64Image: string;
  mimeType: string;
  shopDomain: string;
  widgetType: string;
  logTag?: string;
}): Promise<TransformOutcome> {
  const { product, variant, base64Image, mimeType, shopDomain, widgetType } = args;
  const logTag = args.logTag ?? "tryon-transform";
  const source = variant || product;
  try {
    const prompt = source.transformation_prompt || product.transformation_prompt;
    // Reference images: prefer variant's own refs, else product's
    const referenceUrls = parseReferenceImageUrls(source).length > 0
      ? parseReferenceImageUrls(source)
      : parseReferenceImageUrls(product);

    const referenceImages: ReferenceImagePart[] = [];
    for (const refUrl of referenceUrls) {
      try {
        const refResponse = await safeFetch(refUrl);
        if (refResponse && refResponse.ok) {
          const refBuffer = await refResponse.arrayBuffer();
          referenceImages.push({
            data: Buffer.from(refBuffer).toString("base64"),
            mimeType: refResponse.headers.get("content-type") || "image/jpeg",
          });
        }
      } catch {
        // Skip failed reference images
      }
    }

    const modelToUse = (variant?.ai_model as string) || (product.ai_model as string) || GEMINI_MODEL_FLASH;

    let result;
    if (isOpenAIModel(modelToUse)) {
      result = await transformImageWithOpenAI({
        inputImage: base64Image,
        transformationPrompt: prompt,
        mimeType,
        model: modelToUse,
        referenceImages,
      });
      // Degrade gpt-image-2 → gpt-image-1.5 on failure (org verification etc).
      if (!result.success && modelToUse === MODEL_OPENAI_2) {
        console.log(`⚠️ ${MODEL_OPENAI_2} failed in ${logTag}, falling back to ${MODEL_OPENAI}`);
        result = await transformImageWithOpenAI({
          inputImage: base64Image,
          transformationPrompt: prompt,
          mimeType,
          model: MODEL_OPENAI,
          referenceImages,
        });
      }
    } else {
      result = await transformImage({
        inputImage: base64Image,
        transformationPrompt: prompt,
        mimeType,
        model: modelToUse,
        referenceImages,
      });
      if (!result.success && referenceImages.length > 0) {
        // Defaults to gpt-image-1.5 — cheapest verified OpenAI path.
        result = await transformImageWithOpenAI({
          inputImage: base64Image,
          transformationPrompt: prompt,
          mimeType,
          referenceImages,
        });
      }
    }

    if (result.success) {
      trackTransformationEvent(shopDomain, product.shopify_id, "transformation", widgetType).catch(() => {});
    }

    return {
      tryOnPreview: result.generatedImage ?? null,
      error: result.success ? null : (result.error || "Transform failed"),
    };
  } catch (err) {
    console.error(`[${logTag}] transform error for ${product.id}${variant ? `/${variant.id}` : ""}:`, err);
    return { tryOnPreview: null, error: "Transform failed" };
  }
}
