// Store currency (migration 084). Shopify's shop.currencyCode, remembered
// on shops.currency_code so non-admin paths (storefront config, preview,
// generator prompts) can format prices in the store's currency.
//
// Every read tolerates the column missing (pre-084): it returns null and
// callers keep the previous USD formatting.

import { supabase } from "./supabase.server";

const CODE_RE = /^[A-Z]{3}$/;
const cache = new Map<string, { at: number; code: string | null }>();
const TTL_MS = 10 * 60 * 1000;

export async function getShopCurrency(shopId: string): Promise<string | null> {
  const hit = cache.get(shopId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.code;
  const { data, error } = await supabase.from("shops").select("currency_code").eq("id", shopId).limit(1);
  const raw = !error ? data?.[0]?.currency_code : null;
  const code = typeof raw === "string" && CODE_RE.test(raw) ? raw : null;
  cache.set(shopId, { at: Date.now(), code });
  return code;
}

type AdminGraphqlLike = (query: string) => Promise<{ json: () => Promise<any> }>;

/**
 * Fetch shop.currencyCode from the Admin API and store it when it's unknown
 * or changed. Best-effort and cheap: one tiny query, skipped while cached.
 */
export async function rememberShopCurrency(shopId: string, graphql: AdminGraphqlLike): Promise<string | null> {
  const known = await getShopCurrency(shopId);
  if (known) return known;
  try {
    const res = await graphql(`#graphql
      query GleameShopCurrency { shop { currencyCode } }`);
    const body = await res.json();
    const code = body?.data?.shop?.currencyCode;
    if (typeof code !== "string" || !CODE_RE.test(code)) return null;
    const { error } = await supabase.from("shops").update({ currency_code: code }).eq("id", shopId);
    if (error) {
      console.warn(`[shop-currency] store failed for ${shopId}: ${error.message}`);
      return code;
    }
    cache.set(shopId, { at: Date.now(), code });
    return code;
  } catch (e) {
    console.warn(`[shop-currency] lookup failed for ${shopId}: ${(e as Error).message}`);
    return null;
  }
}

export { formatShopPrice } from "./shop-currency-format";
