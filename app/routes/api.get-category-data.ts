import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCategoryWithFullData } from "../lib/supabase.server";

/**
 * GET /api/get-category-data?categoryId=<uuid>
 * 
 * Fetches a category with all its parameters and levels.
 * Used by the funnel configuration UI to display questions.
 * 
 * Response:
 *   - category: { id, name, base_prompt, parameters: [{ id, name, display_name, question_text, is_locked, levels: [...] }] }
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Authenticate - only logged-in merchants can use this
  await authenticate.admin(request);
  
  const url = new URL(request.url);
  const categoryId = url.searchParams.get("categoryId");
  
  if (!categoryId) {
    return json({ error: "categoryId query parameter is required" }, { status: 400 });
  }
  
  try {
    const category = await getCategoryWithFullData(categoryId);
    
    if (!category) {
      return json({ error: "Category not found" }, { status: 404 });
    }
    
    return json({ category });
  } catch (error) {
    console.error("Error fetching category data:", error);
    return json({ error: "Failed to fetch category data" }, { status: 500 });
  }
};
