// Quiz bundles (2026-10-20): the "Get the full set" / "Add all" button,
// Bundle & save with its discount, the routine template's "Add routine to
// cart" and the kit template's "Add all" are off for every store except
// these, after Shopify App Review hit failing bundle adds. Each product's
// own "Add to bag" is unaffected. Glamnetic keeps bundles (its quiz sells
// sets with a bundle discount).
//
// Merchant settings are left as they are, so lifting a store back in is
// one line here (or BUNDLE_SHOPS, comma-separated domains, which replaces
// the list without a deploy).

const DEFAULT_BUNDLE_SHOPS = ["glamrco.myshopify.com"];

export function bundlesAllowed(shopDomain: string | null | undefined): boolean {
  if (!shopDomain) return false;
  const raw = process.env.BUNDLE_SHOPS;
  const list = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_BUNDLE_SHOPS;
  return list.includes(shopDomain.trim().toLowerCase());
}
