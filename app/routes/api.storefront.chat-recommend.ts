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
} from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

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
    const preference = formData.get("preference") as string;

    if (!imageFile || !shopDomain || !preference) {
      return json(
        { error: "Missing required fields: image, shopDomain, preference" },
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
    if (chatConfig.product_scope === "selected" && chatConfig.selected_product_ids.length > 0) {
      products = products.filter((p: { id: string }) =>
        chatConfig.selected_product_ids.includes(p.id)
      );
    }

    if (products.length === 0) {
      return json(
        { error: "No products available for recommendations" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Rule-based selection: shuffle and pick top N
    // (Future: match preference to product categories for smarter selection)
    const shuffled = [...products].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, chatConfig.num_recommendations);

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    // Run transforms in parallel for each selected product
    const results = await Promise.all(
      selected.map(async (product: {
        id: string;
        product_name: string;
        shopify_id: string;
        transformation_prompt: string;
        ai_model?: string | null;
        reference_image_url?: string | null;
        reference_image_urls?: string[];
      }) => {
        try {
          const prompt = product.transformation_prompt;
          const referenceUrls = parseReferenceImageUrls(product);

          // Fetch reference images
          const referenceImages: ReferenceImagePart[] = [];
          for (const refUrl of referenceUrls) {
            try {
              const refResponse = await fetch(refUrl);
              if (refResponse.ok) {
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

          // Use flash model for speed (multiple transforms)
          const modelToUse = (product.ai_model as string) || GEMINI_MODEL_FLASH;

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
            // Fallback to OpenAI if Gemini fails with reference images
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
            title: product.product_name,
            tryOnPreview: result.generatedImage ?? null,
            error: result.success ? null : (result.error || "Transform failed"),
          };
        } catch (err) {
          console.error(`Chat recommend transform error for ${product.id}:`, err);
          return {
            productId: product.shopify_id,
            title: product.product_name,
            tryOnPreview: null,
            error: "Transform failed",
          };
        }
      })
    );

    // Filter to only successful results
    const recommendations = results.filter((r) => r.tryOnPreview !== null);

    return json({ recommendations }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Chat recommend error:", err);
    return json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
