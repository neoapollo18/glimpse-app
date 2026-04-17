import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  transformImage,
  transformImageWithOpenAI,
  GEMINI_MODEL_FLASH,
  MODEL_OPENAI,
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
} from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { safeFetch } from "../lib/safe-fetch.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

// Shopify's default product handle is the slugified title. Merchants can
// override it in admin, in which case this falls out of sync — but for the
// default case this produces the correct /products/{handle} URL without a
// round-trip to Shopify.
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
    };

    type Candidate = { product: Product; variant: Variant | null };

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

    // Uniform Fisher-Yates shuffle
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Diversity pass: prefer one variant per product so a shop with one
    // multi-variant product can't fill every recommendation slot with shades
    // of the same item. Repeats from the same product are kept as a tail
    // fallback for catalogs smaller than `desiredCount`.
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
    const ordered = uniquePassFirst.concat(uniquePassRest);

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
        if (modelToUse === MODEL_OPENAI) {
          result = await transformImageWithOpenAI({
            inputImage: base64Image,
            transformationPrompt: prompt,
            mimeType: imageFile.type,
            referenceImages,
          });
        } else {
          result = await transformImage({
            inputImage: base64Image,
            transformationPrompt: prompt,
            mimeType: imageFile.type,
            model: modelToUse,
            referenceImages,
          });
          if (!result.success && referenceImages.length > 0) {
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
          tryOnPreview: result.generatedImage ?? null,
          error: result.success ? null : (result.error || "Transform failed"),
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
          tryOnPreview: null,
          error: "Transform failed",
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

    const recommendations = successful.slice(0, desiredCount);

    return json({ recommendations }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Chat recommend error:", err);
    return json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
