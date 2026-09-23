/**
 * Brand library (Overhaul v2 Part 4.1 / G1).
 *
 * Per-store image index built at catalog sync: every image the store
 * already owns, indexed into the brand_library table and tagged with a
 * heuristic role (spec Q9 default: ratio + filename + position + source,
 * no ML, no face detection). Feeds:
 *   - resolveImagesForFacets: attachment-by-construction for generation
 *     (T2 answer tiles resolve variant/product imagery, spec 4.2)
 *   - the Studio images rail + library picker (spec 4.4-4.5) via
 *     listLibrary / addUploadedImage (route: app.api.brand-library.ts)
 *   - TemplateSignals (heroImageCount, bannerCoverage, ...) via
 *     libraryStats (consumed by brand-profile.server.ts)
 *
 * Safety invariants:
 *   - buildBrandLibrary only runs for shops with catalog_sync_enabled
 *     (the existing gate) — live merchants see zero behavior change.
 *   - Every Supabase write feature-detects the brand_library table: if
 *     migration 075 has not run yet, operations no-op with ONE warning.
 *   - Nothing here ever throws into a sync/webhook path: network sources
 *     (GraphQL, homepage HTML) are individually best-effort.
 */

import { supabase, findShopByDomain, uploadReferenceImage } from "./supabase.server";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type LibrarySource =
  | "product_media"
  | "variant_image"
  | "collection_banner"
  | "homepage"
  | "brand_api"
  | "upload";

export type LibraryRole =
  | "packshot"
  | "on-model"
  | "lifestyle"
  | "swatch"
  | "texture"
  | "banner"
  | "logo"
  | "hero"
  | "unknown";

/** Minimal admin GraphQL caller: (query, variables?) => data (same shape
 * as brand-profile.server.ts's AdminGraphql). */
export type AdminGraphqlFn = (
  query: string,
  variables?: Record<string, unknown>
) => Promise<any>;

export interface LibraryImage {
  id: string;
  url: string;
  role: LibraryRole;
  width: number | null;
  height: number | null;
  ratio: number | null;
  source: LibrarySource;
  productIds: string[];
  filename: string | null;
  position: number | null;
}

export interface BuildBrandLibraryOptions {
  /** Admin GraphQL client; without it only DB + homepage sources run. */
  admin?: AdminGraphqlFn;
  /** Wall-clock budget for the whole build (default 25s). */
  timeBoxMs?: number;
  /** Best-effort dominant-color extraction via sharp (default true,
   * capped and only while time remains). */
  dominantColors?: boolean;
}

// ---------------------------------------------------------------------
// Feature detection (migration 075 may not have run yet)
// ---------------------------------------------------------------------

let warnedMissingTable = false;

function isMissingTableError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const msg = err.message ?? "";
  return /relation "?(public\.)?brand_library"? does not exist/i.test(msg) ||
    /Could not find the table '?public\.brand_library'?/i.test(msg);
}

function warnMissingTableOnce(): void {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn(
    "[BrandLibrary] brand_library table missing (run supabase-migrations/075_brand_library.sql) — library operations are a no-op until it exists"
  );
}

// ---------------------------------------------------------------------
// Heuristic tagging (pure — unit tested in scripts/test-brand-library-tagging.mts)
// ---------------------------------------------------------------------

export interface LibraryTagInput {
  source: LibrarySource;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  /** 1-based media position within a product (product_media only). */
  position?: number | null;
}

export interface LibraryTag {
  role: LibraryRole;
  ratio: number | null;
  /** width >= 1200 and clearly portrait or landscape → T1 hero candidate. */
  heroCandidate: boolean;
}

const NAME_ROLES: Array<[RegExp, LibraryRole]> = [
  [/logo|favicon|brandmark/, "logo"],
  [/banner|slideshow|carousel|header[-_]?strip/, "banner"],
  [/hero/, "hero"],
  [/lifestyle|editorial|campaign/, "lifestyle"],
  [/on[-_]?model|model|wearing|worn/, "on-model"],
  [/swatch|shade[-_]?chip|colou?r[-_]?chip/, "swatch"],
  [/texture|macro|detail|close[-_]?up/, "texture"],
];

/**
 * Heuristic role tagging (spec Q9/Q11 defaults). Deterministic priority:
 *   1. filename keywords (lifestyle / banner / logo / swatch / model / ...)
 *   2. source defaults, refined by ratio + media position:
 *      - variant_image → swatch (shade/size chips by construction)
 *      - collection_banner → banner
 *      - brand_api → logo when small & square-ish, else hero
 *      - homepage → hero (og:image / hero img), ultra-wide → banner
 *      - product_media → position 1 packshot; position > 1 lifestyle-
 *        leaning (ultra-wide → banner)
 *      - upload → unknown (merchant tags by picking a slot)
 * has_face detection is deliberately skipped (heuristic-only pass).
 */
export function tagLibraryImage(input: LibraryTagInput): LibraryTag {
  const name = (input.filename ?? "").toLowerCase();
  const w = input.width ?? null;
  const h = input.height ?? null;
  const ratio = w && h && h > 0 ? Math.round((w / h) * 10000) / 10000 : null;

  let role: LibraryRole | null = null;
  for (const [re, r] of NAME_ROLES) {
    if (re.test(name)) {
      role = r;
      break;
    }
  }

  if (!role) {
    const ultraWide = ratio !== null && ratio >= 2.4;
    switch (input.source) {
      case "variant_image":
        role = "swatch";
        break;
      case "collection_banner":
        role = "banner";
        break;
      case "brand_api": {
        const squareish = ratio !== null && ratio >= 0.7 && ratio <= 1.4;
        role = squareish && (w ?? 0) < 600 ? "logo" : "hero";
        break;
      }
      case "homepage":
        role = ultraWide ? "banner" : "hero";
        break;
      case "product_media":
        if (ultraWide) role = "banner";
        else role = (input.position ?? 1) <= 1 ? "packshot" : "lifestyle";
        break;
      case "upload":
      default:
        role = "unknown";
    }
  }

  const heroCandidate =
    (w ?? 0) >= 1200 &&
    ratio !== null &&
    (ratio >= 1.15 || ratio <= 0.87) &&
    role !== "logo" &&
    role !== "swatch";

  return { role, ratio, heroCandidate };
}

export function filenameFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").pop() ?? "");
    return last || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GleameBrandBot/1.0)" },
      redirect: "follow",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function isCatalogSyncEnabledInline(shopDomain: string): Promise<boolean> {
  // Inlined (not imported from catalog-sync.server) to avoid a circular
  // module dependency: catalog-sync consumers kick buildBrandLibrary.
  const { data, error } = await supabase
    .from("shops")
    .select("catalog_sync_enabled")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (error) return false; // fail closed, same as catalog sync
  return data?.catalog_sync_enabled === true;
}

/** Paged product lookup for the shop: id, shopify_id, image_url. */
async function loadShopProducts(
  shopId: string
): Promise<Array<{ id: string; shopify_id: string; image_url: string | null }>> {
  const PAGE = 1000;
  const rows: Array<{ id: string; shopify_id: string; image_url: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("id, shopify_id, image_url")
      .eq("shop_id", shopId)
      .neq("status", "deleted")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[BrandLibrary] products load failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Paged variant lookup (image_url written by catalog sync since the v2
 * variant-image ingestion fix). Chunks the .in() list AND pages each
 * chunk past PostgREST's silent 1000-row cap. */
async function loadVariantsWithImages(
  productIds: string[]
): Promise<Array<{ id: string; product_id: string; variant_title: string | null; image_url: string | null }>> {
  const out: Array<{ id: string; product_id: string; variant_title: string | null; image_url: string | null }> = [];
  for (const ids of chunk(productIds, 150)) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id, product_id, variant_title, image_url")
        .in("product_id", ids)
        .neq("status", "deleted")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`[BrandLibrary] variants load failed: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// resolveImagesForFacets — attachment by construction (spec 4.2).
// The generation agent imports this EXACT signature.
// ---------------------------------------------------------------------

/**
 * For each facet (axis + value + the Supabase products.id uuids it maps
 * to), resolve the image the facet's answer tile should render:
 *   1. a variant image of the facet's products whose variant title
 *      mentions the facet value (the shade/size swatch itself),
 *   2. else any variant image of those products,
 *   3. else the first product image,
 *   4. else null (the validator regenerates/swaps per spec 4.2).
 * Keyed `${axis}:${value}`. Never throws; DB failures resolve to null.
 */
export async function resolveImagesForFacets(
  shopDomain: string,
  facets: Array<{ axis: string; value: string; productIds: string[] }>
): Promise<Record<string, { url: string; role: string } | null>> {
  const out: Record<string, { url: string; role: string } | null> = {};
  for (const f of facets) out[`${f.axis}:${f.value}`] = null;
  if (facets.length === 0) return out;

  try {
    const shop = await findShopByDomain(shopDomain);
    if (!shop) return out;

    const allProductIds = [...new Set(facets.flatMap((f) => f.productIds))].filter(Boolean);
    if (allProductIds.length === 0) return out;

    const [variants, products] = await Promise.all([
      loadVariantsWithImages(allProductIds),
      (async () => {
        const rows: Array<{ id: string; image_url: string | null }> = [];
        for (const ids of chunk(allProductIds, 150)) {
          const { data, error } = await supabase
            .from("products")
            .select("id, image_url")
            .eq("shop_id", shop.id) // ownership: never resolve another shop's rows
            .in("id", ids);
          if (error) throw new Error(error.message);
          rows.push(...(data ?? []));
        }
        return rows;
      })(),
    ]);

    const variantsByProduct = new Map<string, Array<{ variant_title: string | null; image_url: string | null }>>();
    for (const v of variants) {
      if (!v.image_url) continue;
      const list = variantsByProduct.get(v.product_id) ?? [];
      list.push(v);
      variantsByProduct.set(v.product_id, list);
    }
    const productImage = new Map(products.map((p) => [p.id, p.image_url]));

    for (const f of facets) {
      const key = `${f.axis}:${f.value}`;
      const value = f.value.trim().toLowerCase();
      let titleMatch: string | null = null;
      let anyVariant: string | null = null;
      let anyProduct: string | null = null;
      for (const pid of f.productIds) {
        for (const v of variantsByProduct.get(pid) ?? []) {
          if (!anyVariant) anyVariant = v.image_url;
          if (!titleMatch && value && (v.variant_title ?? "").toLowerCase().includes(value)) {
            titleMatch = v.image_url;
          }
        }
        if (!anyProduct) anyProduct = productImage.get(pid) ?? null;
        if (titleMatch) break;
      }
      const url = titleMatch ?? anyVariant;
      out[key] = url
        ? { url, role: "swatch" }
        : anyProduct
          ? { url: anyProduct, role: "packshot" }
          : null;
    }
  } catch (e) {
    console.warn(`[BrandLibrary] resolveImagesForFacets failed for ${shopDomain}:`, (e as Error).message);
  }
  return out;
}

// ---------------------------------------------------------------------
// buildBrandLibrary — the full index build (runs at catalog sync)
// ---------------------------------------------------------------------

interface CollectedImage {
  url: string;
  source: LibrarySource;
  width: number | null;
  height: number | null;
  position: number | null;
  productIds: string[];
}

const PRODUCT_MEDIA_QUERY = `#graphql
  query BrandLibraryProductMedia($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        media(first: 12) {
          nodes {
            ... on MediaImage {
              image { url width height }
            }
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query BrandLibraryCollections($first: Int!) {
    collections(first: $first) {
      nodes {
        id
        title
        image { url width height }
      }
    }
  }
`;

const BRAND_ASSETS_QUERY = `#graphql
  query BrandLibraryBrandAssets {
    shop {
      brand {
        slogan
        logo { image { url width height } }
        coverImage { image { url width height } }
      }
    }
  }
`;

/** Homepage HTML → og:image + hero <img> candidates. Best-effort. */
export function extractHomepageImageCandidates(html: string): Array<{ url: string; width: number | null }> {
  const out: Array<{ url: string; width: number | null }> = [];
  const seen = new Set<string>();
  const push = (url: string | null, width: number | null) => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, width });
  };

  const og = /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i.exec(html);
  push(og ? og[1].replace(/&amp;/g, "&") : null, null);

  // Hero candidates: large imgs in the first 60% of the document.
  const head = html.slice(0, Math.floor(html.length * 0.6));
  for (const m of head.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    if (!src) continue;
    const widths = [...tag.matchAll(/(\d{3,4})w/g)].map((x) => parseInt(x[1], 10));
    const wAttr = /width=["'](\d+)["']/.exec(tag);
    const width = Math.max(0, ...widths, wAttr ? parseInt(wAttr[1], 10) : 0) || null;
    if ((width ?? 0) >= 1200) {
      push(src.startsWith("//") ? `https:${src}` : src, width);
    }
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}

/** Best-effort dominant color via sharp (already a dependency). Fetches a
 * tiny CDN rendition; never throws. */
async function extractDominantColor(url: string): Promise<string[] | null> {
  try {
    const sized = /cdn\.shopify\.com/.test(url)
      ? `${url}${url.includes("?") ? "&" : "?"}width=64`
      : url;
    const res = await fetchWithTimeout(sized, 3000);
    if (!res || !res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 2_000_000) return null;
    const sharp = (await import("sharp")).default;
    const { dominant } = await sharp(buf).stats();
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return [`#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`];
  } catch {
    return null;
  }
}

/**
 * Full library index build. Gated on catalog_sync_enabled; additive
 * upserts on (shop_id, url); feature-detects the table. Time-boxed:
 * sources are collected in priority order and the build stops adding
 * network-derived sources once the budget is spent (what was collected
 * still gets written).
 */
export async function buildBrandLibrary(
  shopDomain: string,
  opts?: BuildBrandLibraryOptions
): Promise<{ imageCount: number; taggedPct: number; ms: number }> {
  const t0 = Date.now();
  const deadline = t0 + (opts?.timeBoxMs ?? 25_000);
  const timeLeft = () => deadline - Date.now();
  const done = (imageCount: number, taggedPct: number) => ({
    imageCount,
    taggedPct,
    ms: Date.now() - t0,
  });

  if (!(await isCatalogSyncEnabledInline(shopDomain))) return done(0, 0);
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return done(0, 0);

  // Feature-detect early: a cheap head query tells us whether 075 ran.
  {
    const probe = await supabase.from("brand_library").select("id").limit(1);
    if (probe.error) {
      if (isMissingTableError(probe.error)) warnMissingTableOnce();
      else console.warn(`[BrandLibrary] probe failed for ${shopDomain}:`, probe.error.message);
      return done(0, 0);
    }
  }

  const collected: CollectedImage[] = [];
  const products = await loadShopProducts(shop.id);
  const rowIdByGid = new Map(products.map((p) => [p.shopify_id, p.id]));

  // Source 1: product media (all positions; position 1 tags packshot,
  // beyond-image-1 media is the lifestyle/texture pool). Admin GraphQL.
  if (opts?.admin) {
    try {
      let after: string | null = null;
      let pages = 0;
      while (timeLeft() > 4000 && pages < 40) {
        pages++;
        const data: any = await opts.admin(PRODUCT_MEDIA_QUERY, { first: 25, after });
        const conn = data?.products;
        if (!conn) break;
        for (const node of conn.nodes ?? []) {
          const productRowId = rowIdByGid.get(node.id);
          const mediaNodes: any[] = node.media?.nodes ?? [];
          mediaNodes.forEach((m, i) => {
            const img = m?.image;
            if (!img?.url) return;
            collected.push({
              url: img.url,
              source: "product_media",
              width: img.width ?? null,
              height: img.height ?? null,
              position: i + 1,
              productIds: productRowId ? [productRowId] : [],
            });
          });
        }
        if (!conn.pageInfo?.hasNextPage) break;
        after = conn.pageInfo.endCursor ?? null;
      }
    } catch (e) {
      console.warn(`[BrandLibrary] product media fetch failed for ${shopDomain}:`, (e as Error).message);
    }
  }

  // Source 4 (DB, cheap): variant images written by catalog sync.
  try {
    const variants = await loadVariantsWithImages(products.map((p) => p.id));
    for (const v of variants) {
      if (!v.image_url) continue;
      collected.push({
        url: v.image_url,
        source: "variant_image",
        width: null,
        height: null,
        position: null,
        productIds: [v.product_id],
      });
    }
  } catch (e) {
    console.warn(`[BrandLibrary] variant image load failed for ${shopDomain}:`, (e as Error).message);
  }

  // Source 2: collection banner images.
  if (opts?.admin && timeLeft() > 3000) {
    try {
      const data: any = await opts.admin(COLLECTIONS_QUERY, { first: 100 });
      for (const c of data?.collections?.nodes ?? []) {
        const img = c?.image;
        if (!img?.url) continue;
        collected.push({
          url: img.url,
          source: "collection_banner",
          width: img.width ?? null,
          height: img.height ?? null,
          position: null,
          productIds: [],
        });
      }
    } catch (e) {
      console.warn(`[BrandLibrary] collections fetch failed for ${shopDomain}:`, (e as Error).message);
    }
  }

  // Source 3a: Brand API assets (logo + cover).
  if (opts?.admin && timeLeft() > 2000) {
    try {
      const data: any = await opts.admin(BRAND_ASSETS_QUERY);
      const brand = data?.shop?.brand;
      for (const img of [brand?.logo?.image, brand?.coverImage?.image]) {
        if (!img?.url) continue;
        collected.push({
          url: img.url,
          source: "brand_api",
          width: img.width ?? null,
          height: img.height ?? null,
          position: null,
          productIds: [],
        });
      }
    } catch (e) {
      console.warn(`[BrandLibrary] brand API fetch failed for ${shopDomain}:`, (e as Error).message);
    }
  }

  // Source 3b: homepage og:image + hero img candidates. Best-effort.
  if (timeLeft() > 3000) {
    try {
      const res = await fetchWithTimeout(`https://${shopDomain}/`, Math.min(6000, timeLeft() - 1000));
      if (res?.ok) {
        const html = await res.text();
        const isPassword = /\/password/.test(res.url) || /<body[^>]*class="[^"]*password/i.test(html);
        if (!isPassword) {
          for (const cand of extractHomepageImageCandidates(html)) {
            collected.push({
              url: cand.url,
              source: "homepage",
              width: cand.width,
              height: null,
              position: null,
              productIds: [],
            });
          }
        }
      }
    } catch (e) {
      console.warn(`[BrandLibrary] homepage fetch failed for ${shopDomain}:`, (e as Error).message);
    }
  }

  // Dedupe by url (first source wins — collection order IS the spec's
  // priority order), merging product associations.
  const byUrl = new Map<string, CollectedImage>();
  for (const img of collected) {
    const existing = byUrl.get(img.url);
    if (!existing) {
      byUrl.set(img.url, { ...img, productIds: [...new Set(img.productIds)] });
    } else {
      existing.productIds = [...new Set([...existing.productIds, ...img.productIds])];
      if (existing.width === null && img.width !== null) {
        existing.width = img.width;
        existing.height = img.height;
      }
    }
  }
  const unique = [...byUrl.values()];
  if (unique.length === 0) return done(0, 0);

  // Tag + optional dominant colors (capped, only while time remains).
  const wantColors = opts?.dominantColors !== false;
  let colorBudget = 40;
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  let tagged = 0;
  for (const img of unique) {
    const filename = filenameFromUrl(img.url);
    const tag = tagLibraryImage({
      source: img.source,
      filename,
      width: img.width,
      height: img.height,
      position: img.position,
    });
    if (tag.role !== "unknown") tagged++;
    let dominant: string[] | null = null;
    if (wantColors && colorBudget > 0 && timeLeft() > 5000) {
      colorBudget--;
      dominant = await extractDominantColor(img.url);
    }
    rows.push({
      shop_id: shop.id,
      url: img.url,
      source: img.source,
      role: tag.role,
      width: img.width,
      height: img.height,
      ratio: tag.ratio,
      dominant_colors: dominant,
      product_ids: img.productIds,
      filename,
      position: img.position,
      updated_at: now,
    });
  }

  // Batched additive upserts on (shop_id, url) — uniform keys per batch.
  let written = 0;
  for (const batch of chunk(rows, 200)) {
    const { data, error } = await supabase
      .from("brand_library")
      .upsert(batch, { onConflict: "shop_id,url" })
      .select("id");
    if (error) {
      if (isMissingTableError(error)) {
        warnMissingTableOnce();
        return done(0, 0);
      }
      console.warn(`[BrandLibrary] upsert batch failed for ${shopDomain}:`, error.message);
      continue;
    }
    written += data?.length ?? 0;
  }

  const taggedPct = rows.length ? Math.round((tagged / rows.length) * 100) : 0;
  console.log(
    `[BrandLibrary] built for ${shopDomain}: ${written} images, ${taggedPct}% tagged, ${Date.now() - t0}ms`
  );
  return done(written, taggedPct);
}

// ---------------------------------------------------------------------
// listLibrary — picker data (spec 4.5 filter chips)
// ---------------------------------------------------------------------

export type LibraryFilter = "products" | "lifestyle" | "banners" | "logos";

const FILTER_ROLES: Record<LibraryFilter, LibraryRole[]> = {
  products: ["packshot", "swatch", "texture", "on-model"],
  lifestyle: ["lifestyle", "hero"],
  banners: ["banner"],
  logos: ["logo"],
};

export async function listLibrary(
  shopDomain: string,
  filter?: LibraryFilter,
  search?: string
): Promise<LibraryImage[]> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return [];

  let query = supabase
    .from("brand_library")
    .select("id, url, role, width, height, ratio, source, product_ids, filename, position")
    .eq("shop_id", shop.id)
    .order("source", { ascending: true })
    .order("position", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (filter && FILTER_ROLES[filter]) {
    query = query.in("role", FILTER_ROLES[filter]);
  }
  if (search && search.trim()) {
    // Escape PostgREST or()/ilike metacharacters, then match filename OR url.
    const term = search.trim().replace(/[%_,()]/g, (c) => `\\${c}`);
    query = query.or(`filename.ilike.%${term}%,url.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) warnMissingTableOnce();
    else console.warn(`[BrandLibrary] listLibrary failed for ${shopDomain}:`, error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    url: r.url as string,
    role: (r.role as LibraryRole) ?? "unknown",
    width: (r.width as number | null) ?? null,
    height: (r.height as number | null) ?? null,
    ratio: r.ratio == null ? null : Number(r.ratio),
    source: r.source as LibrarySource,
    productIds: Array.isArray(r.product_ids) ? (r.product_ids as string[]) : [],
    filename: (r.filename as string | null) ?? null,
    position: (r.position as number | null) ?? null,
  }));
}

// ---------------------------------------------------------------------
// libraryStats — TemplateSignals inputs (consumed by brand-profile)
// ---------------------------------------------------------------------

/** Question-count denominator for the store-level bannerCoverage
 * approximation: T3's max question count (spec Part 3). */
const BANNER_COVERAGE_QUESTIONS = 8;

export async function libraryStats(shopDomain: string): Promise<{
  heroImageCount: number;
  lifestyleImageCount: number;
  bannerCoverage: number | null;
  variantImageCoverage: number | null;
}> {
  const out = {
    heroImageCount: 0,
    lifestyleImageCount: 0,
    bannerCoverage: null as number | null,
    variantImageCoverage: null as number | null,
  };
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return out;

  // Library-derived stats (tolerate a missing table → zeros/nulls).
  const { data, error } = await supabase
    .from("brand_library")
    .select("role, width, ratio")
    .eq("shop_id", shop.id)
    .limit(5000);
  if (error) {
    if (isMissingTableError(error)) warnMissingTableOnce();
  } else {
    let banners = 0;
    for (const r of data ?? []) {
      const role = r.role as LibraryRole;
      const width = (r.width as number | null) ?? 0;
      if (role === "hero" || ((role === "lifestyle" || role === "banner") && width >= 1200)) {
        out.heroImageCount++;
      }
      if (role === "lifestyle") out.lifestyleImageCount++;
      if (role === "banner") banners++;
    }
    if (banners > 0) {
      out.bannerCoverage = Math.min(1, banners / BANNER_COVERAGE_QUESTIONS);
    }
  }

  // variantImageCoverage comes from the catalog mirror (exists pre-075).
  try {
    const products = await loadShopProducts(shop.id);
    if (products.length > 0) {
      const variants = await loadVariantsWithImages(products.map((p) => p.id));
      if (variants.length > 0) {
        const withImage = variants.filter((v) => !!v.image_url).length;
        out.variantImageCoverage = withImage / variants.length;
      }
    }
  } catch (e) {
    console.warn(`[BrandLibrary] variant coverage failed for ${shopDomain}:`, (e as Error).message);
  }
  return out;
}

// ---------------------------------------------------------------------
// Uploads (spec 4.5 footer — post-Reveal only; route enforces surface)
// ---------------------------------------------------------------------

export async function addUploadedImage(
  shopDomain: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ ok: true; image: LibraryImage } | { ok: false; error: string }> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return { ok: false, error: "Shop not found" };

  // Reuse the existing reference-images storage bucket/pattern.
  let url: string;
  try {
    url = await uploadReferenceImage(shopDomain, "brand-library", fileBuffer, fileName, contentType);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Dimensions via sharp (best-effort; already a dependency).
  let width: number | null = null;
  let height: number | null = null;
  let dominant: string[] | null = null;
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(fileBuffer);
    const meta = await img.metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
    const { dominant: d } = await img.stats();
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    dominant = [`#${hex(d.r)}${hex(d.g)}${hex(d.b)}`];
  } catch {
    // metadata is optional — the upload still succeeds
  }

  const tag = tagLibraryImage({ source: "upload", filename: fileName, width, height });
  const { data, error } = await supabase
    .from("brand_library")
    .upsert(
      {
        shop_id: shop.id,
        url,
        source: "upload",
        role: tag.role,
        width,
        height,
        ratio: tag.ratio,
        dominant_colors: dominant,
        product_ids: [],
        filename: fileName,
        position: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,url" }
    )
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingTableError(error)) {
      warnMissingTableOnce();
      return { ok: false, error: "Brand library is not set up yet (migration 075 pending)." };
    }
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  return {
    ok: true,
    image: {
      id: data.id as string,
      url,
      role: tag.role,
      width,
      height,
      ratio: tag.ratio,
      source: "upload",
      productIds: [],
      filename: fileName,
      position: null,
    },
  };
}
