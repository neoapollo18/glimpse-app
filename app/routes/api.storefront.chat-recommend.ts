import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  transformImage,
  transformImageWithOpenAI,
  GEMINI_MODEL_FLASH,
  MODEL_OPENAI,
  MODEL_OPENAI_2,
  isOpenAIModel,
  type ReferenceImagePart,
} from "../lib/ai.server";
import { parseReferenceImageUrls } from "../lib/reference-images";
import {
  findShopByDomain,
  shopHasValidAccess,
  getConfiguredProducts,
  getChatAssistantConfig,
  trackTransformationEvent,
  getVariantsForProducts,
  pickVariantsByCriteria,
} from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { safeFetch } from "../lib/safe-fetch.server";
import prisma from "../db.server";

const SHOPIFY_ADMIN_TIMEOUT_MS = 6_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

// Best-effort fallback only. Shopify's default product handle is the
// slugified title, but merchants commonly override it in admin (the
// "Search engine listing" → URL handle field). Used when the Admin
// GraphQL handle lookup is unavailable or returns nothing for a GID.
function slugifyHandle(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const last = gid.split("/").pop() || "";
  return /^\d+$/.test(last) ? last : null;
}

/**
 * Look up real Shopify product handles for a list of product GIDs. Single
 * batched GraphQL call against Admin API; any GID that fails to resolve
 * is simply absent from the map and the caller falls back to the slugified
 * product name.
 *
 * Why we need this: gleame-chat.js renders the "Shop This" button as
 * <a href="/products/{handle}">. If that handle disagrees with the real
 * Shopify handle (because the merchant customized it), the link 404s and
 * customers can't get to the product page.
 */
async function fetchProductHandles(
  shopDomain: string,
  productGids: string[],
): Promise<Map<string, string>> {
  const handles = new Map<string, string>();
  if (productGids.length === 0) return handles;

  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false, accessToken: { not: "" } },
    orderBy: { id: "desc" },
  });
  if (!session?.accessToken) {
    console.warn(`[chat-recommend] no offline token for ${shopDomain}; falling back to slugified handles`);
    return handles;
  }

  const query = `
    query GetProductHandles($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id handle }
      }
    }
  `;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHOPIFY_ADMIN_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables: { ids: productGids } }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[chat-recommend] handle lookup HTTP ${res.status} for ${shopDomain}`);
      return handles;
    }
    const data = (await res.json()) as {
      data?: { nodes?: Array<{ id: string; handle: string } | null> };
      errors?: Array<{ message: string }>;
    };
    if (data.errors?.length) {
      console.error(`[chat-recommend] handle lookup GraphQL errors for ${shopDomain}:`, data.errors);
      return handles;
    }
    for (const node of data.data?.nodes ?? []) {
      if (node && node.id && node.handle) handles.set(node.id, node.handle);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`[chat-recommend] handle lookup timed out for ${shopDomain}`);
    } else {
      console.error(`[chat-recommend] handle lookup threw for ${shopDomain}:`, err);
    }
  } finally {
    clearTimeout(timer);
  }
  return handles;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;
    // preference is accepted as a form field for future category-based filtering;
    // currently not used to avoid rejecting requests when the field is empty.

    // criteria is a JSON object of axis_key → axis_value, e.g.
    // {"undertone":"warm"} or {"undertone":"warm","depth":"fair"}. The
    // widget sends this for shops with a recommendation matrix configured.
    // We parse defensively — malformed criteria just falls through to the
    // legacy AI-pick path instead of erroring the whole request.
    let criteria: Record<string, string> = {};
    try {
      const raw = formData.get("criteria");
      if (typeof raw === "string" && raw.length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Both keys and values must match the same identifier shape used
          // in the schema's CHECK constraints (lower snake_case). Anything
          // else is dropped — a malformed payload becomes empty criteria,
          // which silently falls through to the legacy AI-pick path.
          const ID_RE = /^[a-z_][a-z0-9_]*$/;
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && ID_RE.test(k) && ID_RE.test(v)) {
              criteria[k] = v;
            }
          }
        }
      }
    } catch {
      // Malformed criteria — ignore, fall through to AI fallback.
    }

    if (!imageFile || !shopDomain) {
      return json(
        { error: "Missing required fields: image, shopDomain" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Verify shop
    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) {
      return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
    }
    const verifiedDomain = verifiedShop.shop_domain;

    // Billing check
    const hasAccess = await shopHasValidAccess(verifiedDomain);
    if (!hasAccess) {
      return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
    }

    // Rate limit
    const clientIP = getClientIP(request);
    const ipLimit = checkRateLimit(
      `chat-recommend:ip:${clientIP}:minute`,
      10, // 10 recommendations per minute per IP
      60_000
    );
    if (!ipLimit.allowed) {
      return json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": ipLimit.retryAfterSeconds.toString() } }
      );
    }

    // Get chat config
    const chatConfig = await getChatAssistantConfig(verifiedDomain);
    if (!chatConfig.enabled) {
      return json({ error: "Chat assistant not enabled" }, { status: 403, headers: CORS_HEADERS });
    }

    // Get eligible products
    let products = await getConfiguredProducts(verifiedDomain);
    if (chatConfig.product_scope === "selected") {
      const selectedIds = chatConfig.selected_product_ids || [];
      if (selectedIds.length === 0) {
        return json(
          { recommendations: [], error: "No products selected for recommendations" },
          { status: 200, headers: CORS_HEADERS }
        );
      }
      products = products.filter((p: { id: string }) => selectedIds.includes(p.id));
    }

    if (products.length === 0) {
      return json(
        { recommendations: [], error: "No products available for recommendations" },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Clamp desired count to a safe range (matches admin UI slider 1..5)
    const desiredCount = Math.max(
      1,
      Math.min(5, Number(chatConfig.num_recommendations) || 3)
    );

    type Product = {
      id: string;
      product_name: string;
      shopify_id: string;
      transformation_prompt: string;
      ai_model?: string | null;
      reference_image_url?: string | null;
      reference_image_urls?: string[];
    };

    type Variant = {
      id: string;
      product_id: string;
      shopify_variant_id: string;
      variant_title: string;
      transformation_prompt: string;
      ai_model?: string | null;
      reference_image_url?: string | null;
      reference_image_urls?: string[];
      // Optional italic copy line shown beneath the variant title on the
      // chat product card. Migration 032 added the column; widget reads it
      // as `tagline` on each recommendation.
      tagline?: string | null;
    };

    // matrixRank is the merchant's authored rank when this candidate came
    // from a matrix rule (1 = top match). Undefined for AI-pick candidates.
    // We surface it on the response so the widget's "Top Match" badge
    // tracks the merchant's intent rather than the response array index —
    // important when rank-1 fails to transform and rank-2 takes its place
    // in the response, but the merchant still wanted their rank-1 badged
    // (or in this case, just preserves whichever merchant rank actually
    // succeeded).
    type Candidate = { product: Product; variant: Variant | null; matrixRank?: number };

    // Build a flat candidate pool: one entry per configured variant, plus one
    // entry for any product without variants. This lets the assistant recommend
    // specific shades (e.g. "She's a Wildflower") rather than the parent product.
    const productList = products as Product[];
    const variants = (await getVariantsForProducts(productList.map((p) => p.id))) as Variant[];
    const variantsByProduct = new Map<string, Variant[]>();
    for (const v of variants) {
      const arr = variantsByProduct.get(v.product_id);
      if (arr) arr.push(v);
      else variantsByProduct.set(v.product_id, [v]);
    }

    const candidates: Candidate[] = [];
    for (const product of productList) {
      const productVariants = variantsByProduct.get(product.id);
      if (productVariants && productVariants.length > 0) {
        for (const variant of productVariants) {
          candidates.push({ product, variant });
        }
      } else {
        candidates.push({ product, variant: null });
      }
    }

    if (candidates.length === 0) {
      return json(
        { recommendations: [], error: "No products available for recommendations" },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // -----------------------------------------------------------------
    // Matrix path: if the merchant has a recommendation matrix and the
    // criteria matches a rule, the variants are pre-selected and pre-
    // ordered by rank. We honor that exactly — no shuffle, no diversity
    // pass — so the merchant's curated picks come through unchanged.
    //
    // If the matrix doesn't apply (criteria empty, no matching rule, or
    // matched variants aren't in the eligible candidate pool), we fall
    // through to the legacy AI-pick path below.
    // -----------------------------------------------------------------
    let ordered: Candidate[];
    let matrixApplied = false;

    if (Object.keys(criteria).length > 0) {
      const matrixHits = await pickVariantsByCriteria(verifiedShop.id, criteria);
      if (matrixHits && matrixHits.length > 0) {
        const variantById = new Map<string, Variant>();
        for (const v of variants) variantById.set(v.id, v);
        const productById = new Map<string, Product>();
        for (const p of productList) productById.set(p.id, p);

        const matched: Candidate[] = [];
        for (const hit of matrixHits) {
          if (hit.variantInternalId) {
            const v = variantById.get(hit.variantInternalId);
            if (!v) continue; // rule references a variant not in scope; skip
            const p = productById.get(v.product_id);
            if (!p) continue;
            matched.push({ product: p, variant: v, matrixRank: hit.rank });
          } else if (hit.productInternalId) {
            // Whole-product target (no specific variant) → recommend the
            // product itself. transformCandidate handles variant:null by
            // falling back to the product-level prompt.
            const p = productById.get(hit.productInternalId);
            if (!p) continue; // rule references a product not in scope; skip
            matched.push({ product: p, variant: null, matrixRank: hit.rank });
          }
        }

        if (matched.length > 0) {
          ordered = matched;
          matrixApplied = true;
        } else {
          ordered = candidates;
        }
      } else {
        ordered = candidates;
      }
    } else {
      ordered = candidates;
    }

    // Legacy AI-pick path: only when the matrix didn't deliver. Uniform
    // shuffle + diversity-by-product pass, same as before.
    if (!matrixApplied) {
      const shuffled = [...candidates];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const seenProducts = new Set<string>();
      const uniquePassFirst: Candidate[] = [];
      const uniquePassRest: Candidate[] = [];
      for (const c of shuffled) {
        if (seenProducts.has(c.product.id)) {
          uniquePassRest.push(c);
        } else {
          seenProducts.add(c.product.id);
          uniquePassFirst.push(c);
        }
      }
      ordered = uniquePassFirst.concat(uniquePassRest);
    }

    // Convert image to base64 once
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const transformCandidate = async (candidate: Candidate) => {
      const { product, variant } = candidate;
      // Variant config wins over product config when present; fall back per field
      // so a variant with a missing prompt still uses the product's prompt.
      const source = variant || product;
      const productName = product.product_name;
      const variantTitle = variant?.variant_title || null;
      const displayTitle = variantTitle
        ? `${productName} — ${variantTitle}`
        : productName;
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
            mimeType: imageFile.type,
            model: modelToUse,
            referenceImages,
          });
          // Degrade gpt-image-2 → gpt-image-1.5 on failure (org verification etc).
          if (!result.success && modelToUse === MODEL_OPENAI_2) {
            console.log(`⚠️ ${MODEL_OPENAI_2} failed in chat-recommend, falling back to ${MODEL_OPENAI}`);
            result = await transformImageWithOpenAI({
              inputImage: base64Image,
              transformationPrompt: prompt,
              mimeType: imageFile.type,
              model: MODEL_OPENAI,
              referenceImages,
            });
          }
        } else {
          result = await transformImage({
            inputImage: base64Image,
            transformationPrompt: prompt,
            mimeType: imageFile.type,
            model: modelToUse,
            referenceImages,
          });
          if (!result.success && referenceImages.length > 0) {
            // Defaults to gpt-image-1.5 — cheapest verified OpenAI path.
            result = await transformImageWithOpenAI({
              inputImage: base64Image,
              transformationPrompt: prompt,
              mimeType: imageFile.type,
              referenceImages,
            });
          }
        }

        if (result.success) {
          trackTransformationEvent(verifiedDomain, product.shopify_id, "transformation", "chat").catch(() => {});
        }

        return {
          productId: product.shopify_id,
          variantId: variant?.shopify_variant_id ?? null,
          productHandle: slugifyHandle(productName),
          variantNumericId: extractNumericId(variant?.shopify_variant_id),
          title: displayTitle,
          productName,
          variantTitle,
          tagline: variant?.tagline ?? null,
          tryOnPreview: result.generatedImage ?? null,
          error: result.success ? null : (result.error || "Transform failed"),
          matrixRank: candidate.matrixRank,
        };
      } catch (err) {
        console.error(`Chat recommend transform error for ${product.id}${variant ? `/${variant.id}` : ""}:`, err);
        return {
          productId: product.shopify_id,
          variantId: variant?.shopify_variant_id ?? null,
          productHandle: slugifyHandle(productName),
          variantNumericId: extractNumericId(variant?.shopify_variant_id),
          title: displayTitle,
          productName,
          variantTitle,
          tagline: variant?.tagline ?? null,
          tryOnPreview: null,
          error: "Transform failed",
          matrixRank: candidate.matrixRank,
        };
      }
    };

    // First pass: transform the top N candidates in parallel
    const firstBatch = ordered.slice(0, desiredCount);
    const firstResults = await Promise.all(firstBatch.map(transformCandidate));
    let successful = firstResults.filter((r) => r.tryOnPreview !== null);

    // Backfill: if any failed and we still have candidates in the pool, try more
    if (successful.length < desiredCount && ordered.length > desiredCount) {
      const needed = desiredCount - successful.length;
      const backfillPool = ordered.slice(
        desiredCount,
        desiredCount + Math.min(needed * 2, ordered.length - desiredCount)
      );
      const backfillResults = await Promise.all(backfillPool.map(transformCandidate));
      successful = successful.concat(
        backfillResults.filter((r) => r.tryOnPreview !== null)
      );
    }

    const finalSuccessful = successful.slice(0, desiredCount);

    // Replace slugified placeholder handles with the real Shopify handles
    // so the "Shop This" link in gleame-chat.js resolves to /products/{real}.
    // Single batched call; any GID not in the map keeps its slugified
    // fallback so behavior never regresses below pre-fix.
    const realHandles = await fetchProductHandles(
      verifiedDomain,
      finalSuccessful.map((r) => r.productId).filter((id): id is string => Boolean(id)),
    );
    // Annotate each recommendation with rank for the widget's "Top Match"
    // badge. For matrix-applied responses we preserve the merchant's
    // authored rank (so the badge follows their curated intent, not the
    // response array index). For AI-pick responses, rank is just the
    // position in the response. matrixApplied tells the widget which
    // semantics are in play.
    const recommendations = finalSuccessful.map((r, idx) => {
      const effectiveRank = (typeof r.matrixRank === "number" && r.matrixRank > 0)
        ? r.matrixRank
        : idx + 1;
      // Strip matrixRank from the wire — widget only needs `rank`.
      const { matrixRank: _matrixRank, ...rest } = r;
      const withRank = { ...rest, rank: effectiveRank };
      const real = r.productId ? realHandles.get(r.productId) : undefined;
      return real ? { ...withRank, productHandle: real } : withRank;
    });

    return json({ recommendations, matrixApplied }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Chat recommend error:", err);
    return json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
