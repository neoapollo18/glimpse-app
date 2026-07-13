// Shared recommendation engine used by the chat assistant
// (api.storefront.chat-recommend) and the quiz page
// (api.storefront.quiz-recommend). Extracted from chat-recommend so both
// surfaces run the exact same candidate-pool, ordering, and handle-resolution
// logic. Behavior here must stay wire-compatible with the chat widget —
// change with care.

import prisma from "../db.server";
import {
  getConfiguredProducts,
  getVariantsForProducts,
  pickVariantsByCriteria,
} from "./supabase.server";
import type { ChatAssistantConfig } from "./supabase.server";

const SHOPIFY_ADMIN_TIMEOUT_MS = 6_000;
const HANDLE_CACHE_TTL_MS = 10 * 60_000;

export type EngineProduct = {
  id: string;
  product_name: string;
  shopify_id: string;
  transformation_prompt: string;
  ai_model?: string | null;
  reference_image_url?: string | null;
  reference_image_urls?: string[];
};

export type EngineVariant = {
  id: string;
  product_id: string;
  shopify_variant_id: string;
  variant_title: string;
  transformation_prompt: string;
  ai_model?: string | null;
  reference_image_url?: string | null;
  reference_image_urls?: string[];
  // Optional italic copy line shown beneath the variant title on product
  // cards. Migration 032 added the column.
  tagline?: string | null;
};

// matrixRank is the merchant's authored rank when this candidate came from a
// matrix rule (1 = top match). Undefined for AI-pick candidates.
export type Candidate = {
  product: EngineProduct;
  variant: EngineVariant | null;
  matrixRank?: number;
  // Per-rule quantity (e.g. "2 sets"). Only set on matrix-matched candidates;
  // defaults to 1 on the wire. Added in migration 043 for the quiz page.
  quantity?: number;
};

export type CandidatePool = {
  products: EngineProduct[];
  variants: EngineVariant[];
  candidates: Candidate[];
};

// Distinguishes "merchant chose 'selected products' but selected none" from
// "no configured products at all" — chat-recommend sends different error
// copy for each and the wire format must not change.
export type CandidatePoolResult =
  | { pool: CandidatePool; emptyReason: null }
  | { pool: null; emptyReason: "no_selected" | "no_products" };

// Best-effort fallback only. Shopify's default product handle is the
// slugified title, but merchants commonly override it in admin. Used when
// the Admin GraphQL handle lookup is unavailable or returns nothing.
export function slugifyHandle(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const last = gid.split("/").pop() || "";
  return /^\d+$/.test(last) ? last : null;
}

/**
 * Build the flat candidate pool for a shop: one entry per configured
 * variant, plus one entry for any product without variants. Applies the
 * chat config's product scope ("all" vs "selected").
 *
 * Returns an emptyReason instead of a pool when the shop has no eligible
 * products (callers respond with their own empty-state payload).
 */
export async function buildCandidatePool(
  shopDomain: string,
  chatConfig: Pick<ChatAssistantConfig, "product_scope" | "selected_product_ids">,
): Promise<CandidatePoolResult> {
  let products = (await getConfiguredProducts(shopDomain)) as EngineProduct[];
  if (chatConfig.product_scope === "selected") {
    const selectedIds = chatConfig.selected_product_ids || [];
    if (selectedIds.length === 0) return { pool: null, emptyReason: "no_selected" };
    products = products.filter((p) => selectedIds.includes(p.id));
  }
  if (products.length === 0) return { pool: null, emptyReason: "no_products" };

  const variants = (await getVariantsForProducts(products.map((p) => p.id))) as EngineVariant[];
  const variantsByProduct = new Map<string, EngineVariant[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id);
    if (arr) arr.push(v);
    else variantsByProduct.set(v.product_id, [v]);
  }

  const candidates: Candidate[] = [];
  for (const product of products) {
    const productVariants = variantsByProduct.get(product.id);
    if (productVariants && productVariants.length > 0) {
      for (const variant of productVariants) {
        candidates.push({ product, variant });
      }
    } else {
      candidates.push({ product, variant: null });
    }
  }

  if (candidates.length === 0) return { pool: null, emptyReason: "no_products" };
  return { pool: { products, variants, candidates }, emptyReason: null };
}

/**
 * AI ordering: uniform shuffle + diversity-by-product pass (unique products
 * first, duplicates after). This is the full fallback when the matrix
 * doesn't apply, and the backfill pool when a curated pick fails.
 */
export function aiOrderCandidates(candidates: Candidate[]): Candidate[] {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const seenProducts = new Set<string>();
  const uniquePassFirst: Candidate[] = [];
  const uniquePassRest: Candidate[] = [];
  for (const c of shuffled) {
    if (seenProducts.has(c.product.id)) {
      uniquePassRest.push(c);
    } else {
      seenProducts.add(c.product.id);
      uniquePassFirst.push(c);
    }
  }
  return uniquePassFirst.concat(uniquePassRest);
}

export type MatrixHit = {
  variantInternalId: string | null;
  productInternalId: string | null;
  rank: number;
  quantity?: number;
};

/**
 * Resolve matrix hits against the in-scope candidate pool and produce the
 * final ordering: curated picks first in rank order, AI-ordered candidates
 * appended purely as a backfill pool.
 *
 * `logTag` keeps each endpoint's log lines distinguishable (e.g.
 * "chat-recommend" / "quiz-recommend").
 */
export function orderByMatrix(
  hits: MatrixHit[] | null,
  pool: CandidatePool,
  aiOrdered: Candidate[],
  opts: { logTag: string; shopDomain: string; criteria: Record<string, string> },
): { ordered: Candidate[]; matrixApplied: boolean; matrixCount: number } {
  const candidateKey = (c: Candidate) => `${c.product.id}|${c.variant ? c.variant.id : ""}`;

  if (!hits || hits.length === 0) {
    if (Object.keys(opts.criteria).length > 0) {
      console.log(
        `[${opts.logTag}] no matrix rule for ${opts.shopDomain}; ` +
          `criteria=${JSON.stringify(opts.criteria)} — AI fallback`
      );
    }
    return { ordered: aiOrdered, matrixApplied: false, matrixCount: 0 };
  }

  const variantById = new Map<string, EngineVariant>();
  for (const v of pool.variants) variantById.set(v.id, v);
  const productById = new Map<string, EngineProduct>();
  for (const p of pool.products) productById.set(p.id, p);

  const matched: Candidate[] = [];
  for (const hit of hits) {
    if (hit.variantInternalId) {
      const v = variantById.get(hit.variantInternalId);
      if (!v) continue; // rule references a variant not in scope; skip
      const p = productById.get(v.product_id);
      if (!p) continue;
      matched.push({ product: p, variant: v, matrixRank: hit.rank, quantity: hit.quantity });
    } else if (hit.productInternalId) {
      // Whole-product target (no specific variant) → recommend the product
      // itself; transform callers handle variant:null by falling back to
      // the product-level prompt.
      const p = productById.get(hit.productInternalId);
      if (!p) continue; // rule references a product not in scope; skip
      matched.push({ product: p, variant: null, matrixRank: hit.rank, quantity: hit.quantity });
    }
  }

  if (matched.length === 0) {
    console.warn(
      `[${opts.logTag}] matrix rule matched but no target in scope for ${opts.shopDomain}; ` +
        `criteria=${JSON.stringify(opts.criteria)} — AI fallback`
    );
    return { ordered: aiOrdered, matrixApplied: false, matrixCount: 0 };
  }

  const used = new Set(matched.map(candidateKey));
  return {
    ordered: matched.concat(aiOrdered.filter((c) => !used.has(candidateKey(c)))),
    matrixApplied: true,
    matrixCount: matched.length,
  };
}

/**
 * Convenience wrapper: exact matrix lookup + ordering. Mirrors the original
 * chat-recommend flow (lookup only runs when criteria is non-empty).
 */
export async function orderCandidates(
  shopId: string,
  criteria: Record<string, string>,
  pool: CandidatePool,
  opts: { logTag: string; shopDomain: string },
): Promise<{ ordered: Candidate[]; matrixApplied: boolean; matrixCount: number }> {
  const aiOrdered = aiOrderCandidates(pool.candidates);
  const hits = Object.keys(criteria).length > 0
    ? await pickVariantsByCriteria(shopId, criteria)
    : null;
  return orderByMatrix(hits, pool, aiOrdered, { ...opts, criteria });
}

// ---------------------------------------------------------------------
// Product handle resolution (Admin GraphQL) with an in-memory cache.
// ---------------------------------------------------------------------

// Per-shop gid → handle cache. Handles change rarely (merchant edits the
// URL slug in admin); a 10-minute TTL keeps the 6s Admin API call off the
// hot path for busy shops while staying fresh enough in practice.
const handleCache = new Map<string, { handles: Map<string, string>; fetchedAt: number }>();

/**
 * Look up real Shopify product handles for a list of product GIDs. Single
 * batched GraphQL call against the Admin API; any GID that fails to resolve
 * is simply absent from the map and callers fall back to the slugified
 * product name.
 *
 * Why: product cards link to /products/{handle}. If that handle disagrees
 * with the real Shopify handle (merchant customized it), the link 404s.
 */
export async function fetchProductHandles(
  shopDomain: string,
  productGids: string[],
  logTag = "recommendation-engine",
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (productGids.length === 0) return result;

  const cached = handleCache.get(shopDomain);
  const fresh = cached && Date.now() - cached.fetchedAt < HANDLE_CACHE_TTL_MS;
  const missing: string[] = [];
  for (const gid of productGids) {
    const hit = fresh ? cached!.handles.get(gid) : undefined;
    if (hit) result.set(gid, hit);
    else missing.push(gid);
  }
  if (missing.length === 0) return result;

  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false, accessToken: { not: "" } },
    orderBy: { id: "desc" },
  });
  if (!session?.accessToken) {
    console.warn(`[${logTag}] no offline token for ${shopDomain}; falling back to slugified handles`);
    return result;
  }

  const query = `
    query GetProductHandles($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id handle }
      }
    }
  `;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHOPIFY_ADMIN_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables: { ids: missing } }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[${logTag}] handle lookup HTTP ${res.status} for ${shopDomain}`);
      return result;
    }
    const data = (await res.json()) as {
      data?: { nodes?: Array<{ id: string; handle: string } | null> };
      errors?: Array<{ message: string }>;
    };
    if (data.errors?.length) {
      console.error(`[${logTag}] handle lookup GraphQL errors for ${shopDomain}:`, data.errors);
      return result;
    }
    const store = fresh ? cached!.handles : new Map<string, string>();
    for (const node of data.data?.nodes ?? []) {
      if (node && node.id && node.handle) {
        result.set(node.id, node.handle);
        store.set(node.id, node.handle);
      }
    }
    handleCache.set(shopDomain, { handles: store, fetchedAt: fresh ? cached!.fetchedAt : Date.now() });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`[${logTag}] handle lookup timed out for ${shopDomain}`);
    } else {
      console.error(`[${logTag}] handle lookup threw for ${shopDomain}:`, err);
    }
  } finally {
    clearTimeout(timer);
  }
  return result;
}
