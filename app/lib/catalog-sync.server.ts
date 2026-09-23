// Catalog sync (quiz-first overhaul, Phase 1).
//
// Pulls the merchant's Shopify catalog into Supabase products/product_variants
// so the quiz recommendation engine has a candidate pool without any manual
// try-on configuration or onboarding scripts.
//
// Invariants (load-bearing for live merchants):
// - Gated per shop by shops.catalog_sync_enabled (DEFAULT FALSE). ORLY and
//   L&M stay FALSE forever (hard-enforced by CATALOG_SYNC_DENYLIST in
//   enableCatalogSync); webhooks bail before any write.
// - Sync NEVER writes config columns: transformation_prompt,
//   reference_image_url(s), multi_set_prompt, multi_set_reference_urls,
//   ai_model, category_id, funnel_responses, display_color, tagline. The
//   batched upserts enforce this structurally — those columns are simply
//   absent from every payload row (uniform keys per batch; PostgREST leaves
//   absent columns untouched on conflict and uses the column default on
//   insert).
// - Deletes are soft (status = 'deleted'); recommendation_rules FK-reference
//   these rows.
// - Every write is verified via .select() row counts (Supabase UPDATE matching
//   0 rows succeeds silently).

import { supabase, findShopByDomain } from "./supabase.server";
import { invalidateCatalogCache } from "./quiz-generator.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// Shopify Admin GraphQL cost budget is 1,000 points per query. With this
// field set the requested cost is ~3 + P*(5 + 2V): variant nodes cost 2
// (1 node + 1 nested image object — variant imagery IS synced since the
// v2 brand-library work), product nodes ~5 + variant connection. P=4,
// V=100 => ~823 points. Do NOT raise these without redoing the math; the
// old 50x100 shape cost ~10,000 points and Shopify rejected every request
// outright.
const PAGE_SIZE = 4;
const VARIANTS_PER_PRODUCT = 100;

const PRODUCTS_PAGE_QUERY = `#graphql
  query CatalogSyncPage($first: Int!, $after: String, $variants: Int!) {
    productsCount {
      count
    }
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          tags
          featuredImage {
            url
          }
          priceRangeV2 {
            minVariantPrice {
              amount
            }
          }
          variants(first: $variants) {
            pageInfo {
              hasNextPage
            }
            edges {
              node {
                id
                title
                sku
                price
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface SyncedProduct {
  shopifyId: string; // full GID (matches existing rows)
  title: string;
  handle: string | null;
  status: "active" | "draft" | "archived";
  vendor: string | null;
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  price: number | null;
  variants: SyncedVariant[];
  // False when Shopify reported more variants than we fetched (>100) OR the
  // source (webhook) can't enumerate variants — the vanished-variant sweep
  // must be skipped for this product or real variants get soft-deleted.
  variantsComplete: boolean;
}

interface SyncedVariant {
  shopifyVariantId: string; // full GID
  title: string;
  sku: string | null;
  price: number | null;
  imageUrl: string | null;
}

function parsePrice(value: unknown): number | null {
  const n = typeof value === "string" ? parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(value: unknown): "active" | "draft" | "archived" {
  const s = String(value ?? "active").toLowerCase();
  return s === "draft" || s === "archived" ? s : "active";
}

const numericId = (gid: string): string => gid.split("/").pop() ?? gid;

// Hand-managed brand shops whose products/product_variants are curated by
// onboarding scripts (scripts/brand-configs/*.json): catalog_sync_enabled
// must stay FALSE forever for them. Enforced HERE, not just by the column
// default — the studio top bar offers one-click enable to any admin session,
// and nothing ever sets the flag back to false.
const CATALOG_SYNC_DENYLIST = new Set([
  "orlybeauty.myshopify.com", // ORLY (scripts/brand-configs/orly-attributes.json)
  "locks-mane.myshopify.com", // Locks & Mane (scripts/brand-configs/locks-and-mane.json)
]);

export async function isCatalogSyncEnabled(shopDomain: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("shops")
    .select("catalog_sync_enabled")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (error) {
    console.error(`[CatalogSync] enabled-check failed for ${shopDomain}:`, error.message);
    return false; // fail closed: never sync a shop we can't verify
  }
  return data?.catalog_sync_enabled === true;
}

export async function enableCatalogSync(shopDomain: string): Promise<{ ok: boolean; error?: string }> {
  if (CATALOG_SYNC_DENYLIST.has(shopDomain)) {
    console.warn(`[CatalogSync] refusing to enable sync for hand-managed shop ${shopDomain}`);
    return { ok: false, error: "Catalog sync is disabled for this shop — its catalog is hand-managed." };
  }
  const { data, error } = await supabase
    .from("shops")
    .update({ catalog_sync_enabled: true })
    .eq("shop_domain", shopDomain)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: `no shops row for ${shopDomain}` };
  return { ok: true };
}

/**
 * Sync one page (~8 products, up to 100 variants each) of the shop's
 * catalog. Resumable: pass the returned nextCursor back in; the cursor is
 * also persisted on the shops row so an abandoned sync can continue later.
 * Returns nextCursor = null when the catalog is fully synced.
 */
export async function syncCatalogPage(
  admin: AdminGraphql,
  shopDomain: string,
  cursor?: string | null,
): Promise<{ nextCursor: string | null; synced: number; total: number | null; errors: string[] }> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) throw new Error(`[CatalogSync] unknown shop ${shopDomain}`);
  if (!(await isCatalogSyncEnabled(shopDomain))) {
    throw new Error(`[CatalogSync] sync not enabled for ${shopDomain}`);
  }

  // Snapshot freshness marker: DB variant rows written at/after this instant
  // (e.g. by a products/update webhook landing mid-page) are NEWER than the
  // GraphQL snapshot below and must not be swept as "vanished".
  const fetchStartedAt = Date.now();
  const response = await admin.graphql(PRODUCTS_PAGE_QUERY, {
    variables: { first: PAGE_SIZE, after: cursor ?? null, variants: VARIANTS_PER_PRODUCT },
  });
  const body = (await response.json()) as {
    data?: {
      productsCount?: { count: number } | null;
      products?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: Record<string, any> }>;
      };
    };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length || !body.data?.products) {
    throw new Error(`[CatalogSync] GraphQL error: ${body.errors?.map((e) => e.message).join("; ") || "empty response"}`);
  }

  const total = body.data.productsCount?.count ?? null;
  const products: SyncedProduct[] = body.data.products.edges.map(({ node }) => ({
    shopifyId: node.id,
    title: node.title,
    handle: node.handle ?? null,
    status: normalizeStatus(node.status),
    vendor: node.vendor || null,
    productType: node.productType || null,
    tags: Array.isArray(node.tags) ? node.tags : [],
    imageUrl: node.featuredImage?.url ?? null,
    price: parsePrice(node.priceRangeV2?.minVariantPrice?.amount),
    variantsComplete: node.variants?.pageInfo?.hasNextPage !== true,
    variants: (node.variants?.edges ?? []).map(({ node: v }: { node: Record<string, any> }) => ({
      shopifyVariantId: v.id,
      title: v.title,
      sku: v.sku || null,
      price: parsePrice(v.price),
      imageUrl: v.image?.url ?? null,
    })),
  }));

  const { written, errors } = await upsertCatalogProducts(shop.id, products, fetchStartedAt);
  invalidateCatalogCache(shop.id);

  const { hasNextPage, endCursor } = body.data.products.pageInfo;
  const nextCursor = hasNextPage ? endCursor : null;

  // Compare-and-swap on the cursor we were handed: two concurrent chains
  // (two tabs, dashboard + studio chip) otherwise race last-writer-wins,
  // and a slow stale chain can overwrite a finished chain's null cursor
  // with a bogus mid-catalog resume point.
  let bookkeeping = supabase
    .from("shops")
    .update({
      catalog_sync_cursor: nextCursor,
      catalog_last_synced_at: new Date().toISOString(),
      ...(total != null ? { catalog_product_count: total } : {}),
    })
    .eq("id", shop.id);
  bookkeeping = cursor
    ? bookkeeping.eq("catalog_sync_cursor", cursor)
    : bookkeeping.is("catalog_sync_cursor", null);
  const { data: shopUpdate, error: shopUpdateError } = await bookkeeping.select("id");
  if (shopUpdateError) {
    errors.push(`shops bookkeeping update failed: ${shopUpdateError.message}`);
  } else if (!shopUpdate?.length) {
    errors.push("sync cursor not updated: another catalog sync advanced it concurrently");
  }

  // synced = product rows actually WRITTEN to the DB, not products fetched
  // from Shopify — counting fetches let a page whose upserts all failed
  // still report full success to the client.
  return { nextCursor, synced: written, total, errors };
}

/**
 * Batched insert-or-update keyed on the migration-057 unique indexes. Every
 * row in a batch carries the IDENTICAL key set (one shared mapper) — this is
 * load-bearing: supabase-js builds the PostgREST columns list from the union
 * of row keys, and a stray key would make missing values overwrite existing
 * rows with NULL.
 */
async function upsertCatalogProducts(
  shopId: string,
  products: SyncedProduct[],
  // Epoch ms of when the incoming product data was fetched; variant rows
  // synced at/after this are fresher than the snapshot and exempt from the
  // vanished-variant sweep.
  fetchedAt: number,
): Promise<{ written: number; errors: string[] }> {
  const errors: string[] = [];
  if (products.length === 0) return { written: 0, errors };
  const now = new Date().toISOString();

  // Legacy rows may store the bare numeric Shopify id instead of the GID
  // (see getProductConfiguration's fallback). Normalize them to GID first so
  // the GID-keyed upsert updates them instead of inserting duplicates.
  const gids = products.map((p) => p.shopifyId);
  const numerics = products.map((p) => numericId(p.shopifyId));
  const { data: existingRows, error: existingError } = await supabase
    .from("products")
    .select("id, shopify_id")
    .eq("shop_id", shopId)
    .in("shopify_id", [...gids, ...numerics]);
  if (existingError) {
    errors.push(`existing-products lookup failed: ${existingError.message}`);
    return { written: 0, errors };
  }
  const byShopifyId = new Map((existingRows ?? []).map((r) => [r.shopify_id as string, r.id as string]));
  for (const p of products) {
    const legacyRowId = byShopifyId.get(numericId(p.shopifyId));
    if (!legacyRowId) continue;
    if (byShopifyId.has(p.shopifyId)) {
      // Both a numeric-id row AND a GID row exist — genuine pre-existing
      // duplicate; never touch it automatically.
      errors.push(`duplicate rows for ${p.shopifyId} (numeric + gid) — resolve manually`);
      continue;
    }
    const { data: renamed, error: renameError } = await supabase
      .from("products")
      .update({ shopify_id: p.shopifyId })
      .eq("id", legacyRowId)
      .select("id");
    if (renameError || !renamed?.length) {
      errors.push(`legacy id normalize failed for ${p.shopifyId}: ${renameError?.message ?? "0 rows"}`);
    }
  }

  // One batched upsert for the page. Config columns are structurally absent.
  const productRows = products.map((p) => ({
    shop_id: shopId,
    shopify_id: p.shopifyId,
    product_name: p.title,
    handle: p.handle,
    status: p.status,
    vendor: p.vendor,
    product_type: p.productType,
    tags: p.tags,
    image_url: p.imageUrl,
    price: p.price,
    synced_at: now,
  }));
  const { data: upserted, error: upsertError } = await supabase
    .from("products")
    .upsert(productRows, { onConflict: "shop_id,shopify_id" })
    .select("id, shopify_id");
  const written = upserted?.length ?? 0;
  if (upsertError || written !== productRows.length) {
    errors.push(`product upsert wrote ${written}/${productRows.length}: ${upsertError?.message ?? ""}`);
    if (!written) return { written: 0, errors };
  }
  const rowIdByGid = new Map((upserted ?? []).map((r) => [r.shopify_id as string, r.id as string]));

  // Variants: one batched upsert across the whole page.
  const variantRows: Array<Record<string, unknown>> = [];
  for (const p of products) {
    const productRowId = rowIdByGid.get(p.shopifyId);
    if (!productRowId) continue;
    for (const v of p.variants) {
      variantRows.push({
        product_id: productRowId,
        shopify_variant_id: v.shopifyVariantId,
        variant_title: v.title,
        sku: v.sku,
        price: v.price,
        image_url: v.imageUrl,
        status: "active",
        synced_at: now,
      });
    }
  }
  if (variantRows.length > 0) {
    const { data: upsertedVariants, error: variantError } = await supabase
      .from("product_variants")
      .upsert(variantRows, { onConflict: "product_id,shopify_variant_id" })
      .select("id");
    if (variantError || (upsertedVariants?.length ?? 0) !== variantRows.length) {
      errors.push(`variant upsert wrote ${upsertedVariants?.length ?? 0}/${variantRows.length}: ${variantError?.message ?? ""}`);
    }
  }

  // Vanished-variant sweep (soft delete) — ONLY for products whose variant
  // list is known complete. Skipping incomplete products prevents webhooks
  // (or >100-variant products) from soft-deleting real variants.
  const sweepable = products.filter((p) => p.variantsComplete && rowIdByGid.has(p.shopifyId));
  if (sweepable.length > 0) {
    const sweepIds = sweepable.map((p) => rowIdByGid.get(p.shopifyId)!);
    const { data: dbVariants, error: dbVariantsError } = await supabase
      .from("product_variants")
      .select("id, product_id, shopify_variant_id, status, synced_at")
      .in("product_id", sweepIds);
    if (dbVariantsError) {
      errors.push(`variant sweep lookup failed: ${dbVariantsError.message}`);
    } else {
      const incomingByProduct = new Map(
        sweepable.map((p) => [rowIdByGid.get(p.shopifyId)!, new Set(p.variants.map((v) => v.shopifyVariantId))]),
      );
      const vanished = (dbVariants ?? []).filter((row) => {
        const incoming = incomingByProduct.get(row.product_id as string);
        if (!incoming || incoming.has(row.shopify_variant_id as string) || row.status === "deleted") {
          return false;
        }
        // Rows written at/after the fetch (e.g. a webhook that added a brand
        // new variant mid-page) are fresher than our snapshot — skip them or
        // the sweep soft-deletes a variant that really exists.
        const syncedAtMs = row.synced_at ? Date.parse(row.synced_at as string) : NaN;
        return !(Number.isFinite(syncedAtMs) && syncedAtMs >= fetchedAt);
      });
      if (vanished.length > 0) {
        const { data: swept, error: sweepError } = await supabase
          .from("product_variants")
          .update({ status: "deleted", synced_at: now })
          .in("id", vanished.map((r) => r.id))
          .select("id");
        if (sweepError || (swept?.length ?? 0) !== vanished.length) {
          errors.push(`variant soft-delete wrote ${swept?.length ?? 0}/${vanished.length}: ${sweepError?.message ?? ""}`);
        }
      }
    }
  }

  return { written, errors };
}

/**
 * Webhook payloads (products/create, products/update) arrive in REST shape
 * with numeric ids; convert to the GID format stored in our tables. Variant
 * lists from webhooks are treated as complete only when present.
 *
 * Variant images: REST payloads carry variant.image_id referencing an entry
 * in the top-level images array — resolve image_id -> images[].src so
 * product_variants.image_url stays fresh between full syncs.
 */
export async function syncSingleProduct(
  shopDomain: string,
  payload: {
    id: number;
    title?: string;
    handle?: string;
    status?: string;
    vendor?: string;
    product_type?: string;
    tags?: string;
    image?: { src?: string } | null;
    images?: Array<{ id?: number | string; src?: string }>;
    variants?: Array<{ id: number; title?: string; sku?: string; price?: string; image_id?: number | string | null }>;
  },
): Promise<{ ok: boolean; errors: string[] }> {
  // Webhook payload freshness: treat it as fetched "now" for the sweep guard.
  const fetchedAt = Date.now();
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return { ok: false, errors: [`unknown shop ${shopDomain}`] };

  // image_id (number or string, Shopify is inconsistent across API
  // versions) -> src, keyed as strings so both shapes resolve.
  const imageSrcById = new Map<string, string>();
  for (const img of payload.images ?? []) {
    if (img?.id != null && img.src) imageSrcById.set(String(img.id), img.src);
  }

  const hasVariants = Array.isArray(payload.variants) && payload.variants.length > 0;
  const product: SyncedProduct = {
    shopifyId: `gid://shopify/Product/${payload.id}`,
    title: payload.title ?? "",
    handle: payload.handle ?? null,
    status: normalizeStatus(payload.status),
    vendor: payload.vendor || null,
    productType: payload.product_type || null,
    tags: (payload.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    imageUrl: payload.image?.src ?? null,
    price: parsePrice(payload.variants?.[0]?.price),
    variantsComplete: hasVariants, // an absent list means "unknown", never "none"
    variants: (payload.variants ?? []).map((v) => ({
      shopifyVariantId: `gid://shopify/ProductVariant/${v.id}`,
      title: v.title ?? "",
      sku: v.sku || null,
      price: parsePrice(v.price),
      imageUrl: v.image_id != null ? imageSrcById.get(String(v.image_id)) ?? null : null,
    })),
  };

  const { errors } = await upsertCatalogProducts(shop.id, [product], fetchedAt);
  invalidateCatalogCache(shop.id);
  if (errors.length) console.error(`[CatalogSync] syncSingleProduct ${shopDomain}:`, errors);
  return { ok: errors.length === 0, errors };
}

export async function markProductDeleted(
  shopDomain: string,
  shopifyProductId: number,
): Promise<{ ok: boolean; errors: string[] }> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return { ok: false, errors: [`unknown shop ${shopDomain}`] };
  const gid = `gid://shopify/Product/${shopifyProductId}`;
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("products")
    .update({ status: "deleted", synced_at: now })
    .eq("shop_id", shop.id)
    .in("shopify_id", [gid, String(shopifyProductId)])
    .select("id");
  if (error) return { ok: false, errors: [error.message] };
  invalidateCatalogCache(shop.id);
  if (!rows?.length) return { ok: true, errors: [] }; // product was never synced; nothing to do

  const { error: variantError } = await supabase
    .from("product_variants")
    .update({ status: "deleted", synced_at: now })
    .in("product_id", rows.map((r) => r.id))
    .select("id");
  return { ok: !variantError, errors: variantError ? [variantError.message] : [] };
}
