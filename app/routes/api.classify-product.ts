import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { classifyProduct } from "../lib/category-classifier.server";

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
    await authenticate.admin(request);

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    const formData = await request.formData();
    const productName = formData.get("productName") as string;
    const productType = formData.get("productType") as string | null;
    const productDescription = formData.get("productDescription") as string | null;

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
