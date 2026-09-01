// Cross-frame navigation for the studio. The max-modal iframe's parent is
// the Shopify admin chrome, NOT our app page — a plain link here loads the
// target INSIDE the modal (complete with a mangled app layout). The hub
// page that hosts the modal listens on this channel (same origin, sibling
// iframes), closes the modal, and navigates the app frame properly.

export const STUDIO_NAV_CHANNEL = "gleame-studio-nav";

export function navigateParent(url: string) {
  try {
    // Scope to the hosting tab: the channel reaches every same-origin admin
    // tab; the host only acts on its own token (passed via the modal src).
    const token = new URLSearchParams(window.location.search).get("navtoken");
    const channel = new BroadcastChannel(STUDIO_NAV_CHANNEL);
    channel.postMessage({ url, token });
    channel.close();
  } catch {
    // BroadcastChannel unavailable: best effort full-frame navigation.
    window.open(url, "_top");
  }
}
