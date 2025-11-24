import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getProductVariants } from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    if (!productId) {
      return json({ error: "Product ID is required" }, { status: 400 });
    }

    // Get configured variants from database
    const variants = await getProductVariants(productId);

    return json({ success: true, variants });
  } catch (error) {
    console.error("Error in get-variants API:", error);
    return json({ error: "Failed to fetch variants" }, { status: 500 });
  }
};

