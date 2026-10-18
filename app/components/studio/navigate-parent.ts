// Cross-frame navigation for the studio. The max-modal iframe's parent is
// the Shopify admin chrome, NOT our app page — a plain link here loads the
// target INSIDE the modal (complete with a mangled app layout). The hub
// page that hosts the modal listens on this channel (same origin, sibling
// iframes), closes the modal, and navigates the app frame properly.

export const STUDIO_NAV_CHANNEL = "gleame-studio-nav";

/** Admin bars (per-shop opt-in, lib/studio-admin-bars.server): the host
 * draws the Studio's page actions in the app window's title bar (Built for
 * Shopify 4.1.6: modal actions belong in the title bar slots, not in a
 * header the Studio draws itself) and its save bar on the modal. The Studio
 * reports what to show; clicks come back as a StudioAction on the same
 * channel. "store-opened" tells the Studio the host opened the store tab. */
export type StudioAction = "publish" | "view-store" | "store-opened" | "save" | "discard";
const STUDIO_ACTIONS: readonly string[] = ["publish", "view-store", "store-opened", "save", "discard"];
export interface StudioHostState {
  showPublish: boolean;
  showViewStore: boolean;
  /** View on my store is greyed out until there is a quiz to show. */
  viewStoreDisabled: boolean;
  /** The store preview link, minted ahead so the host can open it in the
   * admin's own click (a relayed click can't open a tab). */
  storeUrl: string | null;
  /** Unsaved edits: the host shows the save bar. */
  dirty: boolean;
  saving: boolean;
}

/** The host's reading of a studio-state message: anything malformed is
 * off, and only an https store link is kept. */
export function readStudioState(d: Record<string, unknown>): StudioHostState {
  const url = typeof d.storeUrl === "string" && /^https:\/\//.test(d.storeUrl) ? d.storeUrl : null;
  return {
    showPublish: d.showPublish === true,
    showViewStore: d.showViewStore === true,
    viewStoreDisabled: d.viewStoreDisabled === true,
    storeUrl: url,
    dirty: d.dirty === true,
    saving: d.saving === true,
  };
}

/** The hosting tab's token from the modal src, or null when the Studio was
 * opened directly (no host is listening, so it draws its own actions). */
export function studioNavToken(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("navtoken");
  } catch {
    return null;
  }
}

function broadcast(message: Record<string, unknown>): boolean {
  try {
    const channel = new BroadcastChannel(STUDIO_NAV_CHANNEL);
    channel.postMessage(message);
    channel.close();
    return true;
  } catch {
    return false;
  }
}

/** Studio to host: which title bar actions to show. */
export function postStudioState(state: StudioHostState) {
  const token = studioNavToken();
  if (token) broadcast({ type: "studio-state", token, ...state });
}

/** Host to Studio: a title bar action was clicked. */
export function postStudioAction(token: string, action: StudioAction) {
  broadcast({ type: "studio-action", token, action });
}

/** Studio side: run `handler` for this tab's title bar clicks. Returns the
 * unsubscribe. A no-op outside the host modal. */
export function onStudioAction(handler: (action: StudioAction) => void): () => void {
  const token = studioNavToken();
  if (!token) return () => {};
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(STUDIO_NAV_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; token?: string; action?: string } | null;
      if (d?.type !== "studio-action" || d.token !== token) return;
      if (typeof d.action === "string" && STUDIO_ACTIONS.includes(d.action)) handler(d.action as StudioAction);
    };
  } catch {
    /* BroadcastChannel unavailable: the host never shows the actions */
  }
  return () => channel?.close();
}

export function navigateParent(url: string) {
  // Scope to the hosting tab: the channel reaches every same-origin admin
  // tab; the host only acts on its own token (passed via the modal src).
  // No token = the Studio was opened directly (not inside the hub's
  // modal), so nobody is listening: broadcasting would do nothing at all.
  const token = studioNavToken();
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
