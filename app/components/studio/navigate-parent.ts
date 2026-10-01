// Cross-frame navigation for the studio. The max-modal iframe's parent is
// the Shopify admin chrome, NOT our app page — a plain link here loads the
// target INSIDE the modal (complete with a mangled app layout). The hub
// page that hosts the modal listens on this channel (same origin, sibling
// iframes), closes the modal, and navigates the app frame properly.

export const STUDIO_NAV_CHANNEL = "gleame-studio-nav";

export function navigateParent(url: string) {
  // Scope to the hosting tab: the channel reaches every same-origin admin
  // tab; the host only acts on its own token (passed via the modal src).
  // No token = the Studio was opened directly (not inside the hub's
  // modal), so nobody is listening: broadcasting would do nothing at all.
  let token: string | null = null;
  try {
    token = new URLSearchParams(window.location.search).get("navtoken");
  } catch {
    token = null;
  }
  if (token) {
    try {
      const channel = new BroadcastChannel(STUDIO_NAV_CHANNEL);
      channel.postMessage({ url, token });
      channel.close();
      return;
    } catch {
      /* BroadcastChannel unavailable: fall through to the top-level nav */
    }
  }
  navigateTop(url);
}

/** Best-effort full-frame navigation. A relative URL opened with "_top"
 * resolves against OUR origin, which would navigate the Shopify admin to
 * the bare app host with no shop/host/embedded context. Rebuild the admin
 * deep link from the App Bridge global instead so the merchant stays
 * inside the admin. */
function navigateTop(url: string) {
  const cfg = (window as unknown as { shopify?: { config?: { shop?: string; apiKey?: string } } })
    .shopify?.config;
  const storeHandle =
    typeof cfg?.shop === "string" && cfg.shop ? cfg.shop.replace(".myshopify.com", "") : null;
  const dest =
    storeHandle && cfg?.apiKey
      ? `https://admin.shopify.com/store/${storeHandle}/apps/${cfg.apiKey}${url}`
      : url;
  window.open(dest, "_top");
}
