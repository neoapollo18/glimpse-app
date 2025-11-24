import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { transformImage } from "../lib/ai.server";
import { getProductOrVariantConfiguration, trackTransformationEvent } from "../lib/supabase.server";

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
    const variantId = formData.get("variantId") as string | null; // NEW: Optional variant ID

    console.log('Storefront API called with:', { productId, shopDomain, variantId, imageSize: imageFile?.size });

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

    // Check if it's actually an image by checking the file type starts with 'image/'
    if (!imageFile.type.startsWith('image/')) {
      return json({ 
        error: "Please upload an image file." 
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

    // Call OpenAI API with the product's transformation prompt
    const result = await transformImage({
      inputImage: base64Image,
      transformationPrompt: productConfig.transformation_prompt,
      mimeType: imageFile.type,
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
    trackTransformationEvent(shopDomain, productId, 'transformation').catch(error => {
      console.error('Failed to track analytics event:', error);
    });

    // Log successful transformation for analytics
    console.log(`Successful transformation for product ${productId} on shop ${shopDomain}`);

    return json({
      success: true,
      generatedImage: result.generatedImage,
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
