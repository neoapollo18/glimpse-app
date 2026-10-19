// Shop-level try-on availability for the quiz-config payload.
//
// quiz_tryon_enabled defaults to true (migration 069), so a store that
// never set up a single product for try-on still had the quiz offer it: the
// photo step, the "Try them on me" results banner and per-card "See on me",
// none of which can render anything without a product prompt
// (tryon-readiness.ts). quiz-config ANDs the merchant toggle with this
// check, so those surfaces only appear when at least one product the quiz
// can recommend is set up for try-on.
//
// Only rows that HAVE a prompt are read (id/status columns, never the prompt
// text), so the cost doesn't grow with the catalog. Scope mirrors
// buildCandidatePool: live products (status NULL or 'active'), non-deleted
// variants, product_scope 'selected' limited to selected_product_ids.
// Errors throw: the caller keeps the merchant's toggle rather than
// switching try-on off on a failed read.

import { supabase, type ChatAssistantConfig } from "./supabase.server";

const PAGE = 1000;
// .in() lists ride the querystring: same chunk size as getVariantsForProducts.
const CHUNK = 100;

type PromptColumn = "transformation_prompt" | "multi_set_prompt";
type ProductRow = { id: string; status?: string | null };
type VariantRow = { id: string; status?: string | null; products?: ProductRow | ProductRow[] | null };

type Scope = Pick<ChatAssistantConfig, "product_scope" | "selected_product_ids" | "quiz_multi_set_prompt">;

const liveProduct = (r: ProductRow) => r.status == null || r.status === "active";

async function pageAll<T>(
  label: string,
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Non-empty prompt: NOT NULL and <> '' (catalog sync writes '' prompts).
const productsWithPrompt = (shopId: string, column: PromptColumn) =>
  pageAll<ProductRow>(`products.${column}`, (from, to) =>
    supabase
      .from("products")
      .select("id, status")
      .eq("shop_id", shopId)
      .not(column, "is", null)
      .neq(column, "")
      .order("id", { ascending: true })
      .range(from, to),
  );

// product_variants has no shop_id: scope through the parent product (the
// same inner join the variant pickers use). Variant status is filtered in
// the query with NULL counted as live (a bare neq would drop NULL rows).
const variantsWithPrompt = (shopId: string, column: PromptColumn) =>
  pageAll<VariantRow>(`product_variants.${column}`, (from, to) =>
    supabase
      .from("product_variants")
      .select("id, status, products!inner ( id, status )")
      .eq("products.shop_id", shopId)
      .not(column, "is", null)
      .neq(column, "")
      .or("status.is.null,status.neq.deleted")
      .order("id", { ascending: true })
      .range(from, to),
  );

async function anyLiveProductInScope(shopId: string, selected: Set<string> | null): Promise<boolean> {
  const ids = selected ? [...selected] : [null];
  for (let i = 0; i < ids.length; i += CHUNK) {
    let q = supabase.from("products").select("id, status").eq("shop_id", shopId).or("status.is.null,status.eq.active");
    if (selected) q = q.in("id", ids.slice(i, i + CHUNK) as string[]);
    const { data, error } = await q.limit(1);
    if (error) throw new Error(`products read failed: ${error.message}`);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

/**
 * Whether any product the shop's quiz can recommend has a try-on prompt
 * (its own, a variant's, or a multi-set prompt). A superset of what
 * per-match readiness accepts, so it never hides a try-on a shopper could
 * get; quiz-recommend's per-match `tryon` flag narrows it on the results.
 */
export async function shopHasTryonProducts(shopId: string, scope: Scope): Promise<boolean> {
  const selected = scope.product_scope === "selected" ? new Set(scope.selected_product_ids ?? []) : null;
  // Same as buildCandidatePool: "selected" with nothing selected is an
  // empty pool, which quiz-tryon can't resolve anything against.
  if (selected && selected.size === 0) return false;
  const inScope = (p: ProductRow | null | undefined) =>
    Boolean(p && liveProduct(p) && (!selected || selected.has(p.id)));
  const parentOf = (v: VariantRow) => (Array.isArray(v.products) ? v.products[0] : v.products);

  const [products, multiSetProducts, variants, multiSetVariants] = await Promise.all([
    productsWithPrompt(shopId, "transformation_prompt"),
    productsWithPrompt(shopId, "multi_set_prompt"),
    variantsWithPrompt(shopId, "transformation_prompt"),
    variantsWithPrompt(shopId, "multi_set_prompt"),
  ]);
  if (products.some(inScope) || multiSetProducts.some(inScope)) return true;
  if (variants.some((v) => inScope(parentOf(v))) || multiSetVariants.some((v) => inScope(parentOf(v)))) return true;
  // The shop-wide multi-set prompt renders any product recommended as 2+ sets.
  if (typeof scope.quiz_multi_set_prompt === "string" && scope.quiz_multi_set_prompt.trim()) {
    return anyLiveProductInScope(shopId, selected);
  }
  return false;
}
