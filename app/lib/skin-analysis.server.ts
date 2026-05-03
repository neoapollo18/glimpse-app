/**
 * AI skincare analysis.
 *
 * Selfie in → structured JSON out. The selfie is held in memory only for the
 * duration of this call and is never written to disk, DB, logs, or cache, per
 * legal/PRIVACY_POLICY.md §5.2 (same posture as the try-on transform path).
 *
 * Calls OpenAI gpt-4o with a strict JSON schema so the response shape is
 * guaranteed at the API level — no defensive parsing on the way out.
 */

import OpenAI from 'openai';
import { compressImage } from './ai.server';
import { supabase, findShopByDomain } from './supabase.server';
import prisma from '../db.server';

// Model pinned. If/when we upgrade, do it deliberately and re-run the
// offline tone-fairness audit (scripts/skin-tone-audit.mjs) against the
// new model before flipping merchants over.
export const SKIN_ANALYSIS_MODEL = 'gpt-4o-2024-11-20';

// Vision benefits from more detail than the try-on pipeline; 1024px on the
// long edge maps to OpenAI's "high detail" tier without burning extra tokens.
const SKIN_ANALYSIS_MAX_PX = 1024;

// OpenAI SDK v5 default request timeout is 600s — way too long for a
// customer-facing storefront call where someone is staring at a spinner.
// 30s is enough headroom for gpt-4o vision (typical p99 ~10-15s).
const OPENAI_REQUEST_TIMEOUT_MS = 30_000;

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
// JSON schema (strict mode)
// ---------------------------------------------------------------------------
// Note: OpenAI's strict mode requires `additionalProperties: false`, every
// property listed in `required`, and `null` allowed via `type: ["X","null"]`
// rather than `nullable: true`.
const scoreProperty = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
} as const;

const SKIN_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rejected', 'reason', 'skin_type', 'scores', 'notes'],
  properties: {
    rejected: { type: 'boolean' },
    reason: {
      type: ['string', 'null'],
      enum: [...REJECTION_REASONS, null],
    },
    skin_type: {
      type: ['string', 'null'],
      enum: [...SKIN_TYPES, null],
    },
    scores: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: [...SCORE_KEYS],
      properties: Object.fromEntries(SCORE_KEYS.map((k) => [k, scoreProperty])),
    },
    notes: { type: ['string', 'null'], maxLength: 400 },
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
- wrinkles: visible fine lines and wrinkles (forehead, crow's feet, nasolabial)
- sun_damage: visible photoaging — uneven pigmentation, sunspots, dullness from sun
- firmness: visible loss of firmness or sagging. Higher = more visible looseness.
- dark_circles: visible darkness or shadowing under the eyes
- texture: visible roughness, enlarged pores, uneven surface
- moisture: visible dryness or dehydration. Higher = drier-looking, NOT more hydrated.
- spots: visible discrete pigmentation (freckles, age spots, post-acne marks)
- acne: visible active breakouts, papules, pustules

CALIBRATION
Use the FULL 0-100 range. A young adult with no visible concerns scores 0-15 on every metric. A typical adult scores 30-60 on most metrics. Reserve 80-100 for genuinely severe presentations. Do NOT cluster scores around 50.

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
// OpenAI client (lazy — only constructed when called, so import-time errors
// don't fire if the env var is missing in non-storefront contexts)
// ---------------------------------------------------------------------------
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');
  _client = new OpenAI({ apiKey: key });
  return _client;
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

  let raw: string | null | undefined;
  try {
    const response = await client().chat.completions.create(
      {
        model: SKIN_ANALYSIS_MODEL,
        // Deterministic-ish — vision LLMs benefit from a touch of variability
        // for narration, but we want stable scores. Low temp wins for both.
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'skin_analysis',
            strict: true,
            schema: SKIN_ANALYSIS_JSON_SCHEMA,
          },
        },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this skin photo.' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${compressedMimeType};base64,${compressedBase64}`,
                  // High detail = the model sees a 1024-px tile pair instead
                  // of the low-detail 512-px summary. Required for catching
                  // fine lines, pore texture, etc.
                  detail: 'high',
                },
              },
            ],
          },
        ],
      },
      { timeout: OPENAI_REQUEST_TIMEOUT_MS }
    );
    raw = response.choices[0]?.message?.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenAI request failed';
    console.error('[skin-analysis] OpenAI call threw:', message);
    return {
      success: false,
      error: 'Skin analysis is temporarily unavailable. Please try again in a moment.',
      latencyMs: Date.now() - t0,
    };
  }

  if (!raw) {
    return {
      success: false,
      error: 'Empty response from analysis service.',
      latencyMs: Date.now() - t0,
    };
  }

  let parsed: SkinAnalysisResult;
  try {
    parsed = JSON.parse(raw) as SkinAnalysisResult;
  } catch {
    // strict mode should make this unreachable in practice. If we ever land
    // here, the model returned non-JSON despite the schema — log and fail
    // soft.
    console.error('[skin-analysis] Strict JSON parse failed. First 200 chars:', raw.slice(0, 200));
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
// Feature-flag + per-shop config (DB)
// ---------------------------------------------------------------------------

export interface SkinAnalysisConfig {
  shop_id: string;
  system_prompt: string | null;
  emphasis_concerns: ScoreKey[];
  /** Map of concern key → list of Shopify product GIDs. */
  concern_product_map: Record<string, string[]>;
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
    .select('shop_id, system_prompt, emphasis_concerns, concern_product_map, updated_at')
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
  /** Full storefront URL, e.g. https://shop.myshopify.com/products/some-handle. */
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
        url: node.handle ? `https://${shopDomain}/products/${node.handle}` : null,
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

  const { error } = await supabase
    .from('skin_analysis_config')
    .upsert(row, { onConflict: 'shop_id' });

  if (error) {
    console.error('[skin-analysis] config save failed:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}
