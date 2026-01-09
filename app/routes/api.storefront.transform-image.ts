import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { transformImage, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH } from "../lib/ai.server";
import { getProductOrVariantConfiguration, trackTransformationEvent, productHasVariantConfigs } from "../lib/supabase.server";

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

    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const productId = formData.get("productId") as string;
    const shopDomain = formData.get("shopDomain") as string;
    const variantId = formData.get("variantId") as string | null;
    const widgetType = (formData.get("widgetType") as string) || "unknown";
    
    // Debug: log received widgetType
    console.log('Transform API received widgetType:', widgetType);

    // Log HEIC/HEIF specifically for debugging
    const isHeicHeif = imageFile?.name?.toLowerCase().match(/\.(heic|heif)$/) || 
                       ['image/heic', 'image/heif'].includes(imageFile?.type?.toLowerCase());
    console.log('Storefront API called with:', { 
      productId, 
      shopDomain, 
      variantId, 
      imageSize: imageFile?.size,
      imageType: imageFile?.type,
      imageName: imageFile?.name,
      isHeicHeif
    });

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

    // Get product or variant configuration from Supabase
    // If variantId provided, tries variant first, then falls back to product
    const productConfig = await getProductOrVariantConfiguration(
      shopDomain, 
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

    // Call Gemini API with the product's transformation prompt and selected model
    const result = await transformImage({
      inputImage: base64Image,
      transformationPrompt: productConfig.transformation_prompt,
      mimeType: imageFile.type,
      model: modelToUse,
    });

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
    trackTransformationEvent(shopDomain, productId, 'transformation', widgetType).catch(error => {
      console.error('Failed to track analytics event:', error);
    });

    // Log successful transformation for analytics
    console.log(`Successful transformation for product ${productId} on shop ${shopDomain}`);

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
