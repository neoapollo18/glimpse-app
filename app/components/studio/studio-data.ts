/**
 * POST to the studio ACTION as a Remix data request.
 *
 * A raw fetch("/studio") without ?_data is a DOCUMENT request: Remix runs the
 * action, then re-runs every loader and responds with the full HTML page.
 * The action succeeds server-side, but the caller gets 200 text/html, so
 * res.json() yields null and successful saves/drafts read as failures
 * ("Drafting failed (200)", phantom save errors). Setting ?_data=routes/studio
 * routes the POST through handleDataRequest, which runs only the action and
 * returns its JSON alone.
 *
 * Current query params (shop/host/embedded) ride along so authenticate.admin
 * sees the shop context instead of {shop: null}.
 */
export function postStudioAction(body: FormData): Promise<Response> {
  const url = new URL("/studio", window.location.origin);
  url.search = window.location.search;
  url.searchParams.set("_data", "routes/studio");
  return fetch(url.toString(), { method: "POST", body });
}
