// Studio in the admin's own bars (Built for Shopify 4.1.5 / 4.1.6): a
// per-shop opt-in, OFF for every shop by default.
//
// Off, the Studio is exactly as before: it draws its own Publish and View
// on my store, Matching and the bundle discount keep their in-body Save
// buttons, and every other edit saves to the live quiz as the merchant
// types (live editing, 2026-09-16).
//
// On, Publish and View on my store move to the app window's title bar, and
// every editor holds its edits for ONE contextual save bar (Save /
// Discard) while the preview dry-runs them. Both bars are App Bridge
// elements the dashboard hangs on the Studio's max modal, which only a dev
// store can confirm, so nothing turns on until a shop is named here. An env
// allowlist, not a DB value, on purpose.
//
//   STUDIO_ADMIN_BARS_SHOPS=dev-store.myshopify.com,other.myshopify.com
//   STUDIO_ADMIN_BARS_SHOPS=*        (every shop)

export function studioAdminBarsEnabled(shopDomain: string, raw = process.env.STUDIO_ADMIN_BARS_SHOPS): boolean {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes("*") || list.includes(shopDomain.trim().toLowerCase());
}
