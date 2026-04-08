import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  transformImage,
  transformImageWithOpenAI,
  GEMINI_MODEL_PRO,
  GEMINI_MODEL_FLASH,
  MODEL_OPENAI,
  type ReferenceImagePart,
} from "../lib/ai.server";
import { parseReferenceImageUrls } from "../lib/reference-images";
import {
  getProductConfiguration,
  getVariantConfiguration,
  trackTransformationEvent,
  productHasVariantConfigs,
  findShopByDomain,
  shopHasValidAccess,
} from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { safeFetch } from "../lib/safe-fetch.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Handle CORS preflight requests first
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { 
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        }
      });
    }

    // ============================================
    // STEP 1: Parse request and validate fields
    // ============================================
    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const productId = formData.get("productId") as string;
    const shopDomain = formData.get("shopDomain") as string;
    const widgetType = (formData.get("widgetType") as string) || "unknown";

    // Multi-variant mode: variantIds[] sent as repeated FormData keys
    // Single-variant / no-variant mode: legacy variantId key (backward compat)
    const variantIds = formData.getAll("variantIds[]") as string[];
    const variantId = variantIds.length === 0
      ? (formData.get("variantId") as string | null)
      : null;
    const isMultiVariant = variantIds.length > 0;

    if (!imageFile || !productId || !shopDomain) {
      return json({
        error: "Missing required fields: image, productId, and shopDomain"
      }, {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Log request details
    const isHeicHeif = imageFile?.name?.toLowerCase().match(/\.(heic|heif)$/) ||
                       ['image/heic', 'image/heif'].includes(imageFile?.type?.toLowerCase());
    console.log('Storefront API called with:', {
      productId,
      shopDomain,
      variantId,
      variantIds: isMultiVariant ? variantIds : undefined,
      widgetType,
      imageSize: imageFile?.size,
      imageType: imageFile?.type,
      isHeicHeif
    });

    // ============================================
    // STEP 2: VALIDATE SHOP EXISTS (Security)
    // Must verify shop before rate limiting to prevent
    // attackers from using fake domains to bypass limits
    // ============================================
    const verifiedShop = await findShopByDomain(shopDomain);
    
    if (!verifiedShop) {
      console.log(`[Security] Unknown shop domain rejected: ${shopDomain}`);
      return json({ 
        error: "Incorrect shop domain. Please check your shop domain widget configuration." 
      }, { 
        status: 403,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Use the VERIFIED shop domain for all subsequent operations
    // This prevents attackers from spoofing shop domains
    const verifiedShopDomain = verifiedShop.shop_domain;
    console.log(`[Security] Shop verified: ${shopDomain} → ${verifiedShopDomain}`);

    // ============================================
    // STEP 3: SUBSCRIPTION CHECK
    // Verify shop has valid access (active subscription, trial, grace period, or grandfathered)
    // ============================================
    const hasAccess = await shopHasValidAccess(verifiedShopDomain);
    
    if (!hasAccess) {
      console.log(`[Billing] Shop ${verifiedShopDomain} does not have valid subscription`);
      return json({ 
        error: "This store's subscription is inactive. Please contact the store administrator." 
      }, { 
        status: 403,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // ============================================
    // STEP 4: RATE LIMITING
    // ============================================
    const clientIP = getClientIP(request);
    
    // Check per-IP rate limit (20 requests per minute)
    const ipMinuteLimit = checkRateLimit(
      `transform:ip:${clientIP}:minute`,
      RATE_LIMITS.TRANSFORM_PER_IP_MINUTE.limit,
      RATE_LIMITS.TRANSFORM_PER_IP_MINUTE.windowMs
    );
    
    if (!ipMinuteLimit.allowed) {
      console.log(`[RateLimit] IP ${clientIP} exceeded minute limit`);
      return json({ 
        error: "Too many requests. Please wait a moment and try again." 
      }, { 
        status: 429,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Retry-After": ipMinuteLimit.retryAfterSeconds.toString(),
        }
      });
    }

    // Check per-IP hourly limit (100 requests per hour)
    const ipHourLimit = checkRateLimit(
      `transform:ip:${clientIP}:hour`,
      RATE_LIMITS.TRANSFORM_PER_IP_HOUR.limit,
      RATE_LIMITS.TRANSFORM_PER_IP_HOUR.windowMs
    );
    
    if (!ipHourLimit.allowed) {
      console.log(`[RateLimit] IP ${clientIP} exceeded hourly limit`);
      return json({ 
        error: "Hourly limit reached. Please try again later." 
      }, { 
        status: 429,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Retry-After": ipHourLimit.retryAfterSeconds.toString(),
        }
      });
    }

    // Check per-shop rate limit using VERIFIED domain (500 requests per hour)
    const shopLimit = checkRateLimit(
      `transform:shop:${verifiedShopDomain}:hour`,
      RATE_LIMITS.TRANSFORM_PER_SHOP_HOUR.limit,
      RATE_LIMITS.TRANSFORM_PER_SHOP_HOUR.windowMs
    );
    
    if (!shopLimit.allowed) {
      console.log(`[RateLimit] Shop ${verifiedShopDomain} exceeded hourly limit`);
      return json({ 
        error: "This store has reached its hourly limit. Please try again later." 
      }, { 
        status: 429,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Retry-After": shopLimit.retryAfterSeconds.toString(),
        }
      });
    }

    // ============================================
    // STEP 5: Get product configuration
    // ============================================
    const productRow = await getProductConfiguration(verifiedShopDomain, productId);

    if (!productRow) {
      return json({
        error: "Product not configured for transformations. Please contact the store administrator.",
      }, {
        status: 404,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ============================================
    // STEP 5b: Convert image to base64 (shared by all variants)
    // ============================================
    const isValidImageFile = (file: File): boolean => {
      if (file.type.startsWith('image/')) return true;
      const heicMimeTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
      if (heicMimeTypes.includes(file.type.toLowerCase())) return true;
      if (!file.type || file.type === '' || file.type === 'application/octet-stream') {
        const ext = file.name?.toLowerCase().split('.').pop();
        const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'];
        return validExtensions.includes(ext || '');
      }
      return false;
    };

    if (!isValidImageFile(imageFile)) {
      return json({
        error: "Please upload an image file (JPG, PNG, HEIC, etc.)."
      }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const maxSize = 5 * 1024 * 1024;
    if (imageFile.size > maxSize) {
      return json({
        error: "File too large. Please upload an image smaller than 5MB."
      }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // Model selection (same for all variants in this request)
    const adminModelOverride = productRow.ai_model as string | null;
    let modelToUse: string;
    if (adminModelOverride) {
      modelToUse = adminModelOverride;
      console.log(`🎛️ Admin model override: ${modelToUse}`);
    } else {
      const hasVariantConfigs = await productHasVariantConfigs(productRow.id);
      modelToUse = hasVariantConfigs ? GEMINI_MODEL_PRO : GEMINI_MODEL_FLASH;
      console.log(`Model auto-selection: hasVariantConfigs=${hasVariantConfigs}, using ${modelToUse}`);
    }

    // Helper: build prompt + reference images for a single variant
    async function buildVariantConfig(vid: string | null) {
      let prompt = productRow.transformation_prompt as string;
      let referenceUrls = parseReferenceImageUrls(productRow);

      if (vid && String(vid).trim() !== "") {
        const variantRow = await getVariantConfiguration(verifiedShopDomain, productId, vid);
        if (variantRow?.transformation_prompt) {
          prompt = variantRow.transformation_prompt as string;
        }
        const variantUrls = parseReferenceImageUrls(variantRow ?? undefined);
        if (variantUrls.length > 0) referenceUrls = variantUrls;
      }

      const referenceImages: ReferenceImagePart[] = [];
      for (const refUrl of referenceUrls) {
        try {
          const refResponse = await safeFetch(refUrl);
          if (refResponse && refResponse.ok) {
            const refBuffer = await refResponse.arrayBuffer();
            referenceImages.push({
              data: Buffer.from(refBuffer).toString('base64'),
              mimeType: refResponse.headers.get('content-type') || 'image/jpeg',
            });
          }
        } catch (refError) {
          console.error('Failed to fetch reference image, skipping:', refUrl, refError);
        }
      }

      return { prompt, referenceImages };
    }

    // Helper: run a single transform with Gemini → OpenAI fallback
    async function runTransform(prompt: string, referenceImages: ReferenceImagePart[]) {
      if (modelToUse === MODEL_OPENAI) {
        return transformImageWithOpenAI({
          inputImage: base64Image,
          transformationPrompt: prompt,
          mimeType: imageFile.type,
          referenceImages,
        });
      }
      let result = await transformImage({
        inputImage: base64Image,
        transformationPrompt: prompt,
        mimeType: imageFile.type,
        model: modelToUse,
        referenceImages,
      });
      if (!result.success && referenceImages.length > 0) {
        console.log('⚠️ Gemini failed with reference image(s), falling back to OpenAI');
        result = await transformImageWithOpenAI({
          inputImage: base64Image,
          transformationPrompt: prompt,
          mimeType: imageFile.type,
          referenceImages,
        });
      }
      return result;
    }

    // ============================================
    // MULTI-VARIANT PATH (variantIds[] provided)
    // ============================================
    if (isMultiVariant) {
      console.log(`Multi-variant transform: ${variantIds.length} variants`);

      const results = await Promise.all(
        variantIds.map(async (vid) => {
          try {
            const { prompt, referenceImages } = await buildVariantConfig(vid);
            const result = await runTransform(prompt, referenceImages);

            if (result.success) {
              trackTransformationEvent(verifiedShopDomain, productId, 'transformation', widgetType).catch(() => {});
            }

            return {
              variantId: vid,
              generatedImage: result.generatedImage ?? null,
              processedInputImage: result.processedInputImage ?? null,
              error: result.success ? null : (result.error || 'Transformation failed'),
            };
          } catch (err) {
            console.error(`Variant ${vid} transform error:`, err);
            return {
              variantId: vid,
              generatedImage: null,
              processedInputImage: null,
              error: String(err),
            };
          }
        })
      );

      console.log(`Multi-variant complete: ${results.filter(r => !r.error).length}/${results.length} succeeded`);

      return json({ success: true, results }, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
        }
      });
    }

    // ============================================
    // SINGLE-VARIANT PATH (legacy / no variantIds[])
    // Image validation, base64 conversion, and model selection already done above.
    // ============================================
    const { prompt: transformationPrompt, referenceImages: singleRefImages } = await buildVariantConfig(variantId);

    const singleResult = await runTransform(transformationPrompt, singleRefImages);

    if (!singleResult.success) {
      return json({
        error: singleResult.error || "Image transformation failed"
      }, {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    trackTransformationEvent(verifiedShopDomain, productId, 'transformation', widgetType).catch(err => {
      console.error('Failed to track analytics event:', err);
    });

    console.log(`Successful transformation for product ${productId} on shop ${verifiedShopDomain}`);

    return json({
      success: true,
      generatedImage: singleResult.generatedImage,
      processedInputImage: singleResult.processedInputImage,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
      }
    });

  } catch (error) {
    console.error("Error in storefront transform-image API:", error);
    return json({ 
      error: "Internal server error" 
    }, { 
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
};

// Handle CORS preflight requests
export const loader = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    },
  });
};
