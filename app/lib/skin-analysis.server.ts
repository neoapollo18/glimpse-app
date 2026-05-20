/**
 * AI skincare analysis.
 *
 * Selfie in → structured JSON out. The selfie is held in memory only for the
 * duration of this call and is never written to disk, DB, logs, or cache, per
 * legal/PRIVACY_POLICY.md §5.2 (same posture as the try-on transform path).
 *
 * Uses Google Gemini (same vendor as our try-on path) with structured JSON
 * output. Gemini's structured output is best-effort rather than strict, so
 * we still defensively parse the response.
 */

import { GoogleGenAI } from '@google/genai';
import { compressImage, transformImage, GEMINI_MODEL_FLASH_31 } from './ai.server';
import { supabase, findShopByDomain } from './supabase.server';
import prisma from '../db.server';

// Model pinned. If/when we upgrade, do it deliberately and re-run the
// offline tone-fairness audit (scripts/skin-tone-audit.mjs) against the
// new model before flipping merchants over.
export const SKIN_ANALYSIS_MODEL = 'gemini-2.5-pro';

// Vision benefits from more detail than the try-on pipeline; 1024px gives
// Gemini enough resolution to catch fine lines / pore texture without
// blowing up token cost.
const SKIN_ANALYSIS_MAX_PX = 1024;

// Gemini SDK has no first-class per-request timeout that we can rely on
// across versions — wrap with Promise.race instead. 45s gives Pro enough
// headroom (typical p99 ~10-20s; Pro long-tails further than Flash).
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;

// Shopify Admin GraphQL — used to hydrate product cards. 8s is plenty;
// admin queries normally return in <500ms.
const SHOPIFY_ADMIN_TIMEOUT_MS = 8_000;

// Append Shopify's CDN image transform suffix so we don't ship 2-3MB hero
// images to render 150px thumbs. Format: insert `_400x400` before the
// extension. Falls back to the original URL if the pattern doesn't match
// (e.g. non-Shopify CDN, missing extension).
function shrinkShopifyImage(url: string | null, edgePx: number): string | null {
  if (!url) return null;
  // Strip query string for matching, restore at end.
  const [path, query] = url.split('?', 2);
  const m = path.match(/^(.*)\.([a-zA-Z0-9]+)$/);
  if (!m) return url;
  const sized = `${m[1]}_${edgePx}x${edgePx}.${m[2]}`;
  return query ? `${sized}?${query}` : sized;
}

// One product per recommendation slot, top 3 concerns by score.
const MAX_RECOMMENDATIONS = 3;

// Strict subset of values the model is allowed to return. Keep in sync with
// SCORE_KEYS below — frontend depends on every key being present.
const SKIN_TYPES = ['oily', 'dry', 'combination', 'normal', 'sensitive'] as const;
const REJECTION_REASONS = ['not_a_face', 'multiple_faces', 'low_quality', 'obstructed'] as const;
export const SCORE_KEYS = [
  'wrinkles',
  'sun_damage',
  'firmness',
  'dark_circles',
  'texture',
  'moisture',
  'spots',
  'acne',
] as const;

export type SkinType = (typeof SKIN_TYPES)[number];
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type SkinScores = Record<ScoreKey, number>;

export interface SkinAnalysisResult {
  rejected: boolean;
  reason: RejectionReason | null;
  skin_type: SkinType | null;
  scores: SkinScores | null;
  notes: string | null;
}

export interface AnalyzeSkinRequest {
  /** base64-encoded image bytes (no data: prefix). */
  inputImage: string;
  mimeType: string;
  /**
   * Optional merchant-edited prompt body. If null we use DEFAULT_SYSTEM_PROMPT.
   * The IMMUTABLE_SAFETY_BLOCK is always appended server-side so merchants
   * cannot edit out the fairness/non-medical-language guardrails.
   */
  systemPromptOverride?: string | null;
  /**
   * Optional emphasis concerns chosen by the merchant. Programmatically
   * rendered as an EMPHASIS block; steers narration only, not scores.
   */
  emphasisConcerns?: ScoreKey[] | null;
}

export interface AnalyzeSkinResponse {
  success: boolean;
  result?: SkinAnalysisResult;
  /** Compressed input echoed back so the widget can render the user's
   * (rotated, normalized) photo without re-uploading. Same convention as
   * transformImage's processedInputImage. */
  processedInputImage?: string;
  error?: string;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// JSON schema (Gemini structured output)
// ---------------------------------------------------------------------------
// Gemini follows OpenAPI 3.0 schema conventions: nullability is expressed
// with `nullable: true` (NOT `type: ["X","null"]`), and `additionalProperties`
// is not enforced. Schema enforcement is best-effort — defensive parsing
// downstream catches stragglers.
const scoreProperty = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
} as const;

const SKIN_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  required: ['rejected', 'reason', 'skin_type', 'scores', 'notes'],
  properties: {
    rejected: { type: 'boolean' },
    reason: {
      type: 'string',
      nullable: true,
      enum: [...REJECTION_REASONS],
    },
    skin_type: {
      type: 'string',
      nullable: true,
      enum: [...SKIN_TYPES],
    },
    scores: {
      type: 'object',
      nullable: true,
      required: [...SCORE_KEYS],
      properties: Object.fromEntries(SCORE_KEYS.map((k) => [k, scoreProperty])),
    },
    notes: { type: 'string', nullable: true, maxLength: 400 },
  },
} as const;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
export const DEFAULT_SYSTEM_PROMPT = `You are a cosmetic skin-analysis assistant for an e-commerce skincare store. You analyze a customer's selfie and produce structured scores that drive product recommendations. You are NOT a medical professional and never claim to be.

INPUT VALIDATION
- If the image does not show a single human face clearly, set rejected=true and reason to one of: not_a_face | multiple_faces | low_quality | obstructed. Set skin_type=null, scores=null, notes=null.
- Otherwise rejected=false and all other fields populated.

SCORING (each 0-100, higher = MORE visible / more of a concern)
Use the rubric below to anchor each score to a 5-tier scale:
- 0-20: minimal
- 21-40: mild
- 41-60: moderate
- 61-80: high
- 81-100: severe

The rubric is your INTERNAL scoring guide. Do NOT quote or echo this rubric language in the "notes" field — "notes" must follow the LANGUAGE rules below.

wrinkles
- minimal: Skin appears smooth with no visible fine lines or wrinkles.
- mild: Early fine lines visible, primarily in high-movement areas like the eyes and forehead.
- moderate: Noticeable wrinkles present across expression zones, consistent with natural aging.
- high: Deep wrinkles visible across multiple facial zones, including at rest.
- severe: Pronounced deep-set wrinkles across the entire face, with significant depth even at rest.

sun_damage
- minimal: No significant UV-related changes detected across the skin surface.
- mild: Early signs of UV exposure detected, primarily in high-exposure zones like the nose and cheeks.
- moderate: Moderate sun-related discoloration and pigmentation changes visible.
- high: Significant UV damage detected, including uneven tone and hyperpigmentation.
- severe: Extensive sun damage present, indicating prolonged UV exposure without adequate protection.

firmness (higher = more visible looseness)
- minimal: Skin appears firm and well-supported with strong elasticity.
- mild: Slight reduction in skin elasticity detected, common in early aging stages.
- moderate: Noticeable loss of firmness, particularly along the jawline and cheek areas.
- high: Significant reduction in skin density and elasticity across multiple zones.
- severe: Pronounced loss of firmness across the face, with significant sagging along the jawline and cheeks.

dark_circles
- minimal: Under-eye area appears bright with no significant discoloration detected.
- mild: Slight darkening detected under the eyes, likely related to circulation or fatigue.
- moderate: Moderate under-eye discoloration visible, affecting overall radiance.
- high: Significant under-eye darkness detected, suggesting chronic fatigue or pigmentation.
- severe: Pronounced under-eye discoloration with deep shadowing across the entire under-eye area.

texture
- minimal: Skin surface appears smooth and even with consistent tone.
- mild: Slight surface irregularity detected, likely post-inflammatory or pore-related.
- moderate: Noticeable texture variations across the skin surface affecting smoothness.
- high: Significant texture irregularity present across multiple facial zones.
- severe: Pronounced surface texture disruption with severe roughness and irregularities across the face.

moisture (higher = drier-looking, NOT more hydrated)
- minimal: Skin appears well-hydrated with a healthy moisture barrier.
- mild: Slight dehydration detected, surface may appear occasionally tight or dull.
- moderate: Moderate moisture deficit visible, skin may show early signs of dryness.
- high: Significant dehydration detected, skin barrier may appear compromised.
- severe: Severe moisture deficit visible, with extreme dryness and a compromised-looking barrier.

spots
- minimal: Skin tone appears even with no significant hyperpigmentation detected.
- mild: Minor spots or uneven pigmentation detected, likely post-inflammatory.
- moderate: Moderate hyperpigmentation visible, including sun spots or post-acne marks.
- high: Significant pigmentation irregularities detected across multiple zones.
- severe: Extensive hyperpigmentation visible across the face, including dense sun spots and post-acne marks.

acne
- minimal: Skin appears clear with no active breakouts detected.
- mild: Minor breakouts detected, likely occasional or hormonally triggered.
- moderate: Active breakouts visible across one or more facial zones.
- high: Significant active breakouts detected across multiple areas of the face.
- severe: Extensive active breakouts visible across the face, including dense papules and pustules.

CALIBRATION
Use the FULL 0-100 range. A young adult with no visible concerns scores 0-15 on every metric. A typical adult scores 30-60 on most metrics. Do NOT cluster scores around 50.

SKIN TYPE
Pick the single best fit from {oily, dry, combination, normal, sensitive}. If genuinely unclear, default to "combination".`;

// Block the merchant CANNOT edit — concatenated server-side after their
// (optional) prompt override. Contains the legal-sensitive language rules
// and the fairness instructions.
export const IMMUTABLE_SAFETY_BLOCK = `FAIRNESS
Calibrate consistently across all skin tones.
- Do NOT systematically score darker skin tones higher on sun_damage, spots, or dark_circles based on baseline pigmentation. Score only what looks like a genuine concern relative to the surrounding skin.
- Do NOT systematically score lighter skin tones higher on redness or acne based on baseline tone variance.

LANGUAGE
- Use cosmetic, non-medical vocabulary: "appears", "visible", "looks".
- Forbidden words: diagnose, condition, disease, disorder, treatment, cure, patient, medical, clinical, dermatologic.
- "notes" field: 1-2 sentences, plain, friendly, focused on the top 1-2 visible concerns. No advice, no prescriptions, no severity warnings.`;

function buildEmphasisBlock(emphasisConcerns: ScoreKey[] | null | undefined): string {
  if (!emphasisConcerns || emphasisConcerns.length === 0) return '';
  const list = emphasisConcerns.join(', ');
  // Important: this only changes which concerns the notes call out. The
  // numeric scores must remain calibrated by SCORING + CALIBRATION above.
  return `\n\nEMPHASIS\nThis merchant primarily addresses: ${list}. When two concerns are similarly visible, prioritize these in the "notes" field. Do NOT inflate the numeric scores — emphasis steers narration, not measurement.`;
}

export function buildSystemPrompt(
  override: string | null | undefined,
  emphasisConcerns: ScoreKey[] | null | undefined,
): string {
  const base = (override?.trim() || DEFAULT_SYSTEM_PROMPT).trim();
  return `${base}\n\n${IMMUTABLE_SAFETY_BLOCK}${buildEmphasisBlock(emphasisConcerns)}`;
}

// ---------------------------------------------------------------------------
// Sun-damage projection prompts
//
// Used by /api/storefront/project-skin to generate two image-edit projections
// of the customer's selfie: 5 years from now without sun protection / with a
// consistent skincare + SPF routine. Identity, pose, lighting, and framing
// are pinned so only the skin shifts — otherwise the model drifts into
// "different person" territory and the before/after stops being credible.
// ---------------------------------------------------------------------------
export const DEFAULT_PROJECTION_WITHOUT_TREATMENT_PROMPT = `Show this person's skin as it would realistically look after five years of inconsistent sun protection — visible but not dramatic sun damage from accumulated UV exposure. Same person, same face shape, same eye shape, same nose shape, same lip shape, same jawline, same eyebrows, same hair, same overall skin tone, same expression, same accessories, same clothing, same framing, same background, same lighting.

Across the face, introduce or deepen the following signs of sun damage depending on what is already present in the input:

Hyperpigmentation: a few small sun spots and patches of uneven pigmentation appear on the cheeks, temples, and the bridge of the nose. Existing freckles and any natural pigmentation become slightly darker and more defined. The overall skin tone is the same, but with more visible pigmentation variance across the face.

Fine lines and wrinkles: fine lines around the outer corners of the eyes (crow's feet), across the forehead, and around the mouth become slightly more visible. If fine lines are not present in the input, introduce subtle ones in these areas. The lines are fine and natural, not deep.

Texture and dehydration: the skin looks slightly less moisturized, slightly less plump, and slightly rougher in texture than the input. Pores appear marginally more visible. The skin has less of a fresh, hydrated glow.

Elasticity: the skin looks slightly less firm overall, with very mild softening along the jawline and around the mouth. This is a surface-level skin quality change only.

Redness: a faint amount of redness or ruddiness appears on the cheeks, nose, and any sun-exposed areas, suggesting accumulated sun exposure.

Critically, preserve all natural skin texture and features: existing pores, moles, beauty marks, and identifying features remain present. The face must not look airbrushed, plastic, or filtered — the changes are added to real-looking skin, not painted over a smoothed surface. The person remains clearly recognizable as the same individual.

Every facial feature occupies the same exact pixel position and shape as in the input. Do not warp, distort, reshape, narrow, or widen any feature. Do not change the bone structure, do not hollow the cheeks, do not change the jaw or chin shape, and do not change facial volume or weight. The person's overall skin tone (warm/cool/depth) is unchanged — only pigmentation variance increases. Ethnicity, age range, and gender appearance are unchanged from the input.

One single clean photograph. No before/after, no split, no arrows, no labels, no captions, no watermark.`;

export const DEFAULT_PROJECTION_WITH_TREATMENT_PROMPT = `Generate a photorealistic projection of this person 5 years from now after a consistent daily skincare routine with sunscreen, gentle cleansing, and targeted serums. Show the protective effect:
- smooth, even-toned skin with no new sun spots
- well-hydrated texture, soft and luminous
- fine lines around the eyes softened, not exaggerated
- firmness and elasticity well-preserved along the cheeks and jawline

CRITICAL: Preserve identity exactly — same face shape, bone structure, eyes, nose, mouth, hair, skin tone, ethnicity, and apparent age progression of only 5 years. Keep the SAME pose, SAME framing, SAME background, and SAME lighting as the input photo. Only the skin condition changes. No stylization, no filters — photorealistic.`;

// ---------------------------------------------------------------------------
// Gemini client (lazy — only constructed when called, so import-time errors
// don't fire if the env var is missing in non-storefront contexts)
// ---------------------------------------------------------------------------
let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  text?: string;
}

/** Pull the JSON text out of a Gemini response, tolerating both shapes. */
function extractText(response: GeminiResponse | null | undefined): string {
  if (!response) return '';
  if (typeof response.text === 'string' && response.text) return response.text;
  const parts = response.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function analyzeSkin(req: AnalyzeSkinRequest): Promise<AnalyzeSkinResponse> {
  const t0 = Date.now();

  // Resize + HEIC normalize. Re-uses the try-on pipeline's helper so we get
  // EXIF rotation handling for free. Output is always JPEG.
  let compressedBase64: string;
  let compressedMimeType: string;
  try {
    const compressed = await compressImage(req.inputImage, req.mimeType, SKIN_ANALYSIS_MAX_PX);
    compressedBase64 = compressed.compressedBase64;
    compressedMimeType = compressed.compressedMimeType;
  } catch (err) {
    // compressImage already falls back to the original buffer on failure,
    // but if it throws (HEIC convert path), surface a clean error.
    return {
      success: false,
      error: 'Could not process image. Please try a different photo.',
      latencyMs: Date.now() - t0,
    };
  }

  const systemPrompt = buildSystemPrompt(req.systemPromptOverride, req.emphasisConcerns);

  let raw = '';
  try {
    const responsePromise = client().models.generateContent({
      model: SKIN_ANALYSIS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Analyze this skin photo.' },
            { inlineData: { mimeType: compressedMimeType, data: compressedBase64 } },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        // Cast — Gemini's TS schema type is more restrictive than what
        // we hand-rolled (it wants `Type` enum instead of literal strings),
        // but the underlying API accepts the JSON-schema-shaped object.
        responseSchema: SKIN_ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown>,
        // Low-but-not-zero temperature — stable scores with a touch of
        // variability so narration doesn't read templated.
        temperature: 0.2,
      },
    });

    // SDK abort support varies by version; Promise.race is the
    // version-stable way to enforce a hard deadline.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms`)),
        GEMINI_REQUEST_TIMEOUT_MS,
      ),
    );

    const response = (await Promise.race([responsePromise, timeoutPromise])) as GeminiResponse;
    raw = extractText(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini request failed';
    console.error('[skin-analysis] Gemini call threw:', message);
    return {
      success: false,
      error: 'Skin analysis is temporarily unavailable. Please try again in a moment.',
      latencyMs: Date.now() - t0,
    };
  }

  if (!raw.trim()) {
    return {
      success: false,
      error: 'Empty response from analysis service.',
      latencyMs: Date.now() - t0,
    };
  }

  // Gemini occasionally wraps JSON in ```json fences despite responseMimeType
  // being application/json. Strip them defensively before parsing.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: SkinAnalysisResult;
  try {
    parsed = JSON.parse(cleaned) as SkinAnalysisResult;
  } catch {
    console.error('[skin-analysis] JSON parse failed. First 200 chars:', cleaned.slice(0, 200));
    return {
      success: false,
      error: 'Could not interpret analysis. Please try again.',
      latencyMs: Date.now() - t0,
    };
  }

  // Gemini's structured-output enforcement is best-effort — verify the
  // shape we depend on rather than trusting the schema.
  if (!parsed || typeof parsed.rejected !== 'boolean') {
    console.error('[skin-analysis] Response missing required fields:', cleaned.slice(0, 200));
    return {
      success: false,
      error: 'Could not interpret analysis. Please try again.',
      latencyMs: Date.now() - t0,
    };
  }

  return {
    success: true,
    result: parsed,
    processedInputImage: compressedBase64,
    latencyMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Recommendation picker (server-side, deterministic)
// ---------------------------------------------------------------------------
/**
 * Given an analysis result and the merchant's concern→products map, pick the
 * top 3 recommendations: one product per top-scoring concern, deduped, in
 * descending score order. Concerns missing from the map yield no rec for
 * that slot — caller can decide whether to fall back to tag-based defaults.
 */
export function pickRecommendations(
  scores: SkinScores,
  concernProductMap: Record<string, string[] | undefined>,
  maxRecommendations = MAX_RECOMMENDATIONS,
): { concern: ScoreKey; productId: string }[] {
  const sortedConcerns = (Object.entries(scores) as [ScoreKey, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const seen = new Set<string>();
  const picks: { concern: ScoreKey; productId: string }[] = [];
  for (const concern of sortedConcerns) {
    if (picks.length >= maxRecommendations) break;
    const candidates = concernProductMap[concern] ?? [];
    for (const productId of candidates) {
      if (seen.has(productId)) continue;
      picks.push({ concern, productId });
      seen.add(productId);
      break; // one product per concern slot
    }
  }
  return picks;
}

// ---------------------------------------------------------------------------
// Sun-damage projections
//
// Image-edit projections of the customer's selfie 5 years from now: one
// without protection, one with a daily skincare routine. Owns model choice
// (gemini-3.1-flash-image-preview) and the compress-once optimization —
// both generations share the same input bytes, so we run compressImage
// exactly once and hand the pre-compressed buffer to two parallel
// transformImage calls. Saves one HEIC convert + Sharp resize per click
// on phone uploads.
// ---------------------------------------------------------------------------

// 2048px to match GEMINI_MODEL_FLASH_31's 2K input ceiling. The projection
// prompt is strict about pixel-position preservation, so feeding the model
// more spatial detail helps it keep identity stable across the transform.
// The output is rendered at ~400px in the widget — the resolution win is on
// the *input* side, not the display side.
const PROJECTION_MAX_PX = 2048;

export interface ProjectSkinRequest {
  /** base64-encoded image bytes (no data: prefix). */
  inputImage: string;
  mimeType: string;
  /** Merchant-edited prompts (with code defaults if null). */
  withoutTreatmentPrompt: string;
  withTreatmentPrompt: string;
}

export interface ProjectSkinResponse {
  /** base64 of the without-treatment projection, or null on failure. */
  withoutTreatment: string | null;
  /** base64 of the with-treatment projection, or null on failure. */
  withTreatment: string | null;
  latencyMs: number;
}

export async function projectSkin(req: ProjectSkinRequest): Promise<ProjectSkinResponse> {
  const t0 = Date.now();

  // Compress once. Both transforms share the same processed bytes.
  let compressedBase64: string;
  let compressedMimeType: string;
  try {
    const out = await compressImage(req.inputImage, req.mimeType, PROJECTION_MAX_PX);
    compressedBase64 = out.compressedBase64;
    compressedMimeType = out.compressedMimeType;
  } catch (err) {
    console.error('[project-skin] compress threw:', err);
    return { withoutTreatment: null, withTreatment: null, latencyMs: Date.now() - t0 };
  }

  // Both generations are independent — Promise.allSettled so a single
  // failure doesn't kill the other slot. `preCompressed: true` tells
  // transformImage to send the bytes verbatim (no redundant compress).
  const [withoutSettled, withSettled] = await Promise.allSettled([
    transformImage({
      inputImage: compressedBase64,
      transformationPrompt: req.withoutTreatmentPrompt,
      mimeType: compressedMimeType,
      model: GEMINI_MODEL_FLASH_31,
      preCompressed: true,
    }),
    transformImage({
      inputImage: compressedBase64,
      transformationPrompt: req.withTreatmentPrompt,
      mimeType: compressedMimeType,
      model: GEMINI_MODEL_FLASH_31,
      preCompressed: true,
    }),
  ]);

  function pick(r: PromiseSettledResult<{ success: boolean; generatedImage?: string }>): string | null {
    // transformImage normally returns {success:false} on error rather than
    // rejecting (see ai.server.ts), but allSettled keeps us defensive.
    if (r.status !== 'fulfilled') {
      console.error('[project-skin] generation rejected:', r.reason);
      return null;
    }
    if (!r.value.success || !r.value.generatedImage) return null;
    return r.value.generatedImage;
  }

  return {
    withoutTreatment: pick(withoutSettled),
    withTreatment: pick(withSettled),
    latencyMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Feature-flag + per-shop config (DB)
// ---------------------------------------------------------------------------

export interface SkinAnalysisConfig {
  shop_id: string;
  system_prompt: string | null;
  emphasis_concerns: ScoreKey[];
  /** Map of concern key → list of Shopify product GIDs. */
  concern_product_map: Record<string, string[]>;
  /** Override for the WITHOUT-treatment projection prompt. NULL = use default. */
  projection_without_treatment_prompt: string | null;
  /** Override for the WITH-treatment projection prompt. NULL = use default. */
  projection_with_treatment_prompt: string | null;
  updated_at: string;
}

/**
 * Returns true only if `shops.is_skin_analysis_enabled = true` for this
 * shop_id. Default is FALSE for every shop — only Gleame founders flip
 * this from /admin. Use this variant when you've already verified the
 * shop and have its UUID; saves a redundant findShopByDomain.
 */
export async function isSkinAnalysisEnabledByShopId(shopId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shops')
    .select('is_skin_analysis_enabled')
    .eq('id', shopId)
    .maybeSingle();

  if (error) {
    console.error(`[skin-analysis] flag lookup failed for shop_id=${shopId}:`, error);
    return false;
  }
  return Boolean(data?.is_skin_analysis_enabled);
}

/** Convenience wrapper for callers that only have the domain (e.g. admin UI). */
export async function isSkinAnalysisEnabledForShop(shopDomain: string): Promise<boolean> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return false;
  return isSkinAnalysisEnabledByShopId(shop.id);
}

function emptyConfig(shopId: string): SkinAnalysisConfig {
  return {
    shop_id: shopId,
    system_prompt: null,
    emphasis_concerns: [],
    concern_product_map: {},
    projection_without_treatment_prompt: null,
    projection_with_treatment_prompt: null,
    updated_at: new Date(0).toISOString(),
  };
}

/**
 * Get the merchant's config row by shop_id. Returns an in-memory default
 * if no row exists (we don't INSERT on the storefront read path; the
 * merchant admin save creates the row explicitly).
 */
export async function getSkinAnalysisConfigByShopId(
  shopId: string,
): Promise<SkinAnalysisConfig> {
  const { data, error } = await supabase
    .from('skin_analysis_config')
    .select('shop_id, system_prompt, emphasis_concerns, concern_product_map, projection_without_treatment_prompt, projection_with_treatment_prompt, updated_at')
    .eq('shop_id', shopId)
    .maybeSingle();

  if (error) {
    console.error(`[skin-analysis] config lookup failed for shop_id=${shopId}:`, error);
    return emptyConfig(shopId);
  }
  return (data as SkinAnalysisConfig | null) ?? emptyConfig(shopId);
}

/** Convenience wrapper for callers that only have the domain (e.g. admin UI). */
export async function getSkinAnalysisConfig(shopDomain: string): Promise<SkinAnalysisConfig | null> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return null;
  return getSkinAnalysisConfigByShopId(shop.id);
}

// ---------------------------------------------------------------------------
// Product card lookup (via Shopify Admin GraphQL)
// ---------------------------------------------------------------------------

export interface ProductCard {
  productId: string;
  title: string;
  imageUrl: string | null;
  /**
   * Path-only storefront URL, e.g. `/products/some-handle`. Path-only so the
   * browser resolves it against whatever origin the embed is rendering on
   * (the merchant's primary domain) — avoids a cross-origin redirect through
   * `*.myshopify.com` that some merchant themes intercept and that would
   * lose the customer's cart session.
   */
  url: string | null;
}

/**
 * Fetch product cards (title, image, storefront URL) for a list of product
 * GIDs on a shop, using the shop's offline access token. Returns whatever
 * succeeds — missing or unparseable products are simply absent from the
 * map. Adds ~200ms per call but avoids storing handles in our DB and
 * keeping them in sync with Shopify.
 */
export async function fetchProductCards(
  shopDomain: string,
  productGids: string[],
): Promise<Map<string, ProductCard>> {
  const cards = new Map<string, ProductCard>();
  if (productGids.length === 0) return cards;

  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false, accessToken: { not: '' } },
    orderBy: { id: 'desc' },
  });
  if (!session?.accessToken) {
    console.warn(`[skin-analysis] no offline token for ${shopDomain}; product cards unavailable`);
    return cards;
  }

  const query = `
    query GetProductCards($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          handle
          featuredImage { url }
        }
      }
    }
  `;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHOPIFY_ADMIN_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${shopDomain}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({ query, variables: { ids: productGids } }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      console.error(`[skin-analysis] productCards GraphQL HTTP ${response.status} for ${shopDomain}`);
      return cards;
    }
    const result = (await response.json()) as {
      data?: { nodes?: Array<{ id: string; title: string; handle: string; featuredImage?: { url: string } | null } | null> };
      errors?: Array<{ message: string }>;
    };
    if (result.errors?.length) {
      console.error(`[skin-analysis] productCards GraphQL errors for ${shopDomain}:`, result.errors);
      return cards;
    }
    for (const node of result.data?.nodes ?? []) {
      if (!node) continue;
      cards.set(node.id, {
        productId: node.id,
        title: node.title ?? '',
        imageUrl: shrinkShopifyImage(node.featuredImage?.url ?? null, 400),
        url: node.handle ? `/products/${node.handle}` : null,
      });
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[skin-analysis] fetchProductCards timed out for ${shopDomain} after ${SHOPIFY_ADMIN_TIMEOUT_MS}ms`);
    } else {
      console.error(`[skin-analysis] fetchProductCards threw for ${shopDomain}:`, err);
    }
  } finally {
    clearTimeout(timer);
  }
  return cards;
}

/**
 * Upsert a partial config update for a shop. Pass only the fields the
 * merchant changed; nulls are persisted for `system_prompt` (clears
 * override) but ignored for `emphasis_concerns` / `concern_product_map`
 * (use empty array / empty object to clear those explicitly).
 */
export async function saveSkinAnalysisConfig(
  shopDomain: string,
  patch: Partial<Omit<SkinAnalysisConfig, 'shop_id' | 'updated_at'>>,
): Promise<{ success: boolean; error?: string }> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return { success: false, error: 'Shop not found' };

  const row: Record<string, unknown> = { shop_id: shop.id };
  if ('system_prompt' in patch) row.system_prompt = patch.system_prompt ?? null;
  if (patch.emphasis_concerns !== undefined) row.emphasis_concerns = patch.emphasis_concerns;
  if (patch.concern_product_map !== undefined) row.concern_product_map = patch.concern_product_map;
  // Like system_prompt: empty string clears, null clears, anything else stored verbatim.
  if ('projection_without_treatment_prompt' in patch) {
    row.projection_without_treatment_prompt = patch.projection_without_treatment_prompt ?? null;
  }
  if ('projection_with_treatment_prompt' in patch) {
    row.projection_with_treatment_prompt = patch.projection_with_treatment_prompt ?? null;
  }

  const { error } = await supabase
    .from('skin_analysis_config')
    .upsert(row, { onConflict: 'shop_id' });

  if (error) {
    console.error('[skin-analysis] config save failed:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}
