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

type Entry = { at: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();

/**
 * Memoize `load` for TTL_MS under (shopDomain, key). Concurrent requests share
 * one in-flight promise; a rejected load is dropped so the next request
 * retries instead of replaying the failure.
 */
export function storefrontCached<T>(shopDomain: string, key: string, load: () => Promise<T>): Promise<T> {
  const cacheKey = `${shopDomain.toLowerCase()}|${key}`;
  const now = Date.now();
  const hit = entries.get(cacheKey);
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;

  const value = load();
  entries.set(cacheKey, { at: now, value });
  value.catch(() => {
    if (entries.get(cacheKey)?.value === value) entries.delete(cacheKey);
  });
  if (entries.size > MAX_ENTRIES) {
    // Map iteration is insertion order: drop the oldest entry.
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  return value;
}

/** Drop every cached storefront payload for a shop (call after config writes). */
export function invalidateStorefrontCache(shopDomain: string): void {
  const prefix = `${shopDomain.toLowerCase()}|`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** Test hook. */
export function clearStorefrontCache(): void {
  entries.clear();
}
