import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getProductVariants } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Require admin authentication
  try {
    await authenticate.admin(request);
  } catch {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    if (!productId) {
      return json({ error: "Product ID is required" }, { status: 400 });
    }

    // Validate productId format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return json({ error: "Invalid product ID format" }, { status: 400 });
    }

    // Get configured variants from database
    const variants = await getProductVariants(productId);

    return json({ success: true, variants });
  } catch (error) {
    console.error("Error in get-variants API:", error);
    return json({ error: "Failed to fetch variants" }, { status: 500 });
  }
};

