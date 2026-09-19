// Admin-side funnel event sink (Overhaul Part 6). The install-flow and
// Reveal screens report their own milestones; names are whitelisted so
// this can't become a generic event injector.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { trackOverhaulEvent, type OverhaulEvent } from "../lib/overhaul-events.server";

const ALLOWED: OverhaulEvent[] = [
  "install_completed",
  "scope_selected",
  "reveal_viewed",
  "reveal_quiz_played",
  "store_preview_opened",
  "studio_opened",
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const event = String(form.get("event") ?? "") as OverhaulEvent;
  if (!ALLOWED.includes(event)) {
    return json({ ok: false, error: "Unknown event" }, { status: 400 });
  }
  let properties: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(form.get("properties") ?? "{}"));
    if (parsed && typeof parsed === "object") properties = parsed;
  } catch {
    /* no properties */
  }
  trackOverhaulEvent(session.shop, event, properties);
  return json({ ok: true });
};
