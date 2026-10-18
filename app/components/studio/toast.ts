// Success and Undo notes. Errors never use a toast: they stay on screen as
// a critical Banner until dismissed (Built for Shopify 4.2.4), so this has
// no error variant on purpose.
//
// App Bridge's toast (short, bottom centre, like the admin's own) is only
// used for shops opted in to the admin bars (STUDIO_ADMIN_BARS_SHOPS): it
// isn't verified inside the Studio's max-modal window yet, and Undo must
// never silently vanish. Every other shop keeps the Studio's own in-page
// toast (StudioToastHost).

type AppToast = { show?: (message: string, opts?: Record<string, unknown>) => unknown };

export const STUDIO_TOAST_EVENT = "gleame-studio-toast";
export type StudioToastDetail = { message: string; undo?: () => void };

let appBridgeToasts = false;

/** The Studio sets this from its loader's adminBars flag. */
export function setAppToastMode(useAppBridge: boolean): void {
  appBridgeToasts = useAppBridge;
}

/** Shows the toast and returns true, or false with no window (server). */
export function showAppToast(message: string, undo?: () => void): boolean {
  if (typeof window === "undefined") return false;
  if (appBridgeToasts) {
    const toast = (window as unknown as { shopify?: { toast?: AppToast } }).shopify?.toast;
    if (toast?.show) {
      toast.show(message, undo ? { action: "Undo", onAction: undo, duration: 7000 } : undefined);
      return true;
    }
  }
  window.dispatchEvent(new CustomEvent<StudioToastDetail>(STUDIO_TOAST_EVENT, { detail: { message, undo } }));
  return true;
}
