import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { transformImage, transformImageWithOpenAI, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH } from "../lib/ai.server";
import { getProductOrVariantConfiguration, trackTransformationEvent, productHasVariantConfigs, findShopByDomain, shopHasValidAccess } from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";

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
    const variantId = formData.get("variantId") as string | null;
    const widgetType = (formData.get("widgetType") as string) || "unknown";

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
    // Get product or variant configuration from Supabase
    // If variantId provided, tries variant first, then falls back to product
    const productConfig = await getProductOrVariantConfiguration(
      verifiedShopDomain, 
      productId,
      variantId || undefined
    );
    
    if (!productConfig) {
      return json({ 
        error: "Product not configured for transformations. Please contact the store administrator." 
      }, { 
        status: 404,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Validate image file
    const maxSize = 5 * 1024 * 1024; // 5MB for storefront (smaller than admin)

    // Helper function to check if file is a valid image (including HEIC/HEIF)
    const isValidImageFile = (file: File): boolean => {
      // Standard image MIME type check
      if (file.type.startsWith('image/')) {
        return true;
      }
      // HEIC/HEIF specific MIME types
      const heicMimeTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
      if (heicMimeTypes.includes(file.type.toLowerCase())) {
        return true;
      }
      // Fallback: check by file extension for unrecognized MIME types (common with HEIC on some browsers)
      if (!file.type || file.type === '' || file.type === 'application/octet-stream') {
        const ext = file.name?.toLowerCase().split('.').pop();
        const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'];
        return validExtensions.includes(ext || '');
      }
      return false;
    };

    // Check if it's actually an image (with HEIC/HEIF support)
    if (!isValidImageFile(imageFile)) {
      return json({ 
        error: "Please upload an image file (JPG, PNG, HEIC, etc.)." 
      }, { 
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    if (imageFile.size > maxSize) {
      return json({ 
        error: "File too large. Please upload an image smaller than 5MB." 
      }, { 
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // Determine which model to use based on whether product has variant configs
    // Products with variant configs (makeup) use Pro model, others (skincare) use Flash
    const hasVariantConfigs = await productHasVariantConfigs(productConfig.id);
    const modelToUse = hasVariantConfigs ? GEMINI_MODEL_PRO : GEMINI_MODEL_FLASH;
    console.log(`Model selection: hasVariantConfigs=${hasVariantConfigs}, using ${modelToUse}`);

    // Fetch reference image if one is attached to the product config
    let referenceImage: string | undefined;
    let referenceImageMimeType: string | undefined;
    
    if (productConfig.reference_image_url) {
      try {
        const refResponse = await fetch(productConfig.reference_image_url);
        if (refResponse.ok) {
          const refBuffer = await refResponse.arrayBuffer();
          referenceImage = Buffer.from(refBuffer).toString('base64');
          referenceImageMimeType = refResponse.headers.get('content-type') || 'image/jpeg';
          console.log(`📎 Reference image loaded (${Math.round(refBuffer.byteLength / 1024)}KB)`);
        }
      } catch (refError) {
        console.error('Failed to fetch reference image, proceeding without it:', refError);
      }
    }

    // When a reference image is present: try Gemini Pro first (fast), fall back to OpenAI (slow but permissive)
    let result;
    if (referenceImage) {
      console.log('🔀 Reference image present - trying Gemini Pro first');
      result = await transformImage({
        inputImage: base64Image,
        transformationPrompt: productConfig.transformation_prompt,
        mimeType: imageFile.type,
        model: GEMINI_MODEL_PRO,
        referenceImage,
        referenceImageMimeType,
      });

      // If Gemini fails (safety filter etc), fall back to OpenAI
      if (!result.success) {
        console.log('⚠️ Gemini failed, falling back to OpenAI');
        result = await transformImageWithOpenAI({
          inputImage: base64Image,
          transformationPrompt: productConfig.transformation_prompt,
          mimeType: imageFile.type,
          referenceImage,
          referenceImageMimeType,
        });
      }
    } else {
      result = await transformImage({
        inputImage: base64Image,
        transformationPrompt: productConfig.transformation_prompt,
        mimeType: imageFile.type,
        model: modelToUse,
      });
    }

    if (!result.success) {
      return json({ 
        error: result.error || "Image transformation failed" 
      }, { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Track analytics event (don't wait for it to complete)
    trackTransformationEvent(verifiedShopDomain, productId, 'transformation', widgetType).catch(error => {
      console.error('Failed to track analytics event:', error);
    });

    // Log successful transformation for analytics
    console.log(`Successful transformation for product ${productId} on shop ${verifiedShopDomain}`);

    return json({
      success: true,
      generatedImage: result.generatedImage,
      processedInputImage: result.processedInputImage,
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
