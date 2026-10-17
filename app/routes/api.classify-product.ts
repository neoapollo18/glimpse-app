import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { classifyProduct } from "../lib/category-classifier.server";
import { checkRateLimits, RATE_LIMITS } from "../lib/rate-limiter.server";

// Shopify caps product titles and types at 255 chars, so these never cut a
// real value; they keep a multi-MB field out of the Gemini prompt.
const MAX_NAME_CHARS = 300;
const MAX_TYPE_CHARS = 255;

/**
 * POST /api/classify-product
 * 
 * Classifies a product into one of the 11 beauty categories using Gemini.
 * Returns a suggested category with confidence score.
 * 
 * Request body (form data):
 *   - productName: string (required) - The product title
 *   - productType: string (optional) - Shopify product type
 *   - productDescription: string (optional) - Product description
 * 
 * Response:
 *   - success: boolean
 *   - suggestion: { categoryId, categoryName, confidence } | null
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Authenticate - only logged-in merchants can use this
    const { session } = await authenticate.admin(request);

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    // Per shop: the products page classifies once per new-product modal
    // open. The client treats an error as "no suggestion".
    const limit = checkRateLimits([
      {
        key: `classify-product:shop:${session.shop}:hour`,
        limit: RATE_LIMITS.CLASSIFY_PRODUCT_PER_SHOP_HOUR.limit,
        windowMs: RATE_LIMITS.CLASSIFY_PRODUCT_PER_SHOP_HOUR.windowMs,
      },
    ]);
    if (!limit.allowed) {
      return json({
        error: "Too many classification requests. Please try again later."
      }, { status: 429, headers: { "Retry-After": limit.retryAfterSeconds.toString() } });
    }

    const formData = await request.formData();
    const rawName = formData.get("productName");
    const rawType = formData.get("productType");
    const productName = typeof rawName === "string" ? rawName.slice(0, MAX_NAME_CHARS) : "";
    const productType = typeof rawType === "string" ? rawType.slice(0, MAX_TYPE_CHARS) : null;
    const rawDescription = formData.get("productDescription");
    const productDescription = typeof rawDescription === "string" ? rawDescription : null;

    if (!productName) {
      return json({ 
        error: "Product name is required" 
      }, { status: 400 });
    }

    // Call the classifier
    const suggestion = await classifyProduct(
      productName,
      productType || undefined,
      productDescription || undefined
    );

    return json({
      success: true,
      suggestion,
    });

  } catch (error) {
    console.error("Error in classify-product API:", error);
    return json({ 
      error: "Failed to classify product" 
    }, { status: 500 });
  }
};
