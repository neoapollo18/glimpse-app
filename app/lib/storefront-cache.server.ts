/**
 * Short-lived in-process cache for the public quiz endpoints the storefront
 * widget calls on every quiz page view (quiz-config, recommendation-config).
 *
 * Both endpoints answer the same payload to every shopper of a shop, but each
 * request paid 2-3 sequential Supabase round trips (300-430 ms warm TTFB,
 * measured 2026-10-16), and Render's Cloudflare never caches dynamic routes.
 * A 20 s TTL keeps hot shops on memory reads while bounding staleness well
 * under the 60 s browser max-age these responses already carry.
 *
 * Writers invalidate explicitly (saveChatAssistantConfig, the Studio action),
 * so a merchant who flips the quiz on or saves in Studio sees it on the next
 * storefront load from this instance. Other writers (background generation,
 * scripts) and other instances fall back to the TTL.
 *
 * Signed store previews never come through here: they're per-request and
 * served no-store.
 */

const TTL_MS = 20_000;
const MAX_ENTRIES = 2_000;

// shop: the verified shop_domain the payload resolved to, recorded once the
// load settles, so invalidating that shop also drops an entry keyed by a
// custom domain (a theme block's manual_shop_domain).
type Entry = { at: number; value: Promise<unknown>; shop?: string | null };
const entries = new Map<string, Entry>();

type CacheOptions<T> = {
  /** Keep a resolved value only when this returns true (default: keep all). */
  keep?: (value: T) => boolean;
  /** The verified shop_domain a resolved value belongs to. */
  shopOf?: (value: T) => string | null | undefined;
};

/**
 * Memoize `load` for TTL_MS under (shopDomain, key). Concurrent requests share
 * one in-flight promise; a rejected load, or a value `keep` turns down, is
 * dropped so the next request retries instead of replaying the failure.
 *
 * The key is the exact claimed domain, not a lowercased one: the loader
 * resolves that exact string (findShopByDomain is case-sensitive), so a case
 * variant that fails to resolve must never share the entry real storefronts
 * read.
 */
export function storefrontCached<T>(
  shopDomain: string,
  key: string,
  load: () => Promise<T>,
  opts: CacheOptions<T> = {},
): Promise<T> {
  const cacheKey = `${shopDomain}|${key}`;
  const now = Date.now();
  const hit = entries.get(cacheKey);
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;

  const value = load();
  const entry: Entry = { at: now, value };
  entries.set(cacheKey, entry);
  const drop = () => {
    if (entries.get(cacheKey) === entry) entries.delete(cacheKey);
  };
  // One chain ending in catch: a rejected load (or a throwing predicate)
  // must never become an unhandled rejection.
  value
    .then((v) => {
      if (opts.keep && !opts.keep(v)) drop();
      else entry.shop = opts.shopOf?.(v);
    })
    .catch(drop);
  if (entries.size > MAX_ENTRIES) {
    // Map iteration is insertion order: drop the oldest entry.
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  return value;
}

/**
 * Drop every cached storefront payload for a shop (call after config writes):
 * entries keyed by any casing of the domain, plus entries that resolved to
 * this shop under another domain.
 */
export function invalidateStorefrontCache(shopDomain: string): void {
  const shop = shopDomain.toLowerCase();
  const prefix = `${shop}|`;
  for (const [key, entry] of entries) {
    if (key.toLowerCase().startsWith(prefix) || entry.shop?.toLowerCase() === shop) {
      entries.delete(key);
    }
  }
}

/** Test hook. */
export function clearStorefrontCache(): void {
  entries.clear();
}
