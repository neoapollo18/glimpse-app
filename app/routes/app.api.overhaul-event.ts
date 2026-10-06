// Admin-side funnel event sink (Overhaul Part 6). The onboarding screens
// and the Studio report their own milestones; names are whitelisted so
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
  // v3 (V3-CONTRACTS §11): the onboarding Build screen reports a failed or
  // timed-out generation {step, reason}.
  "generation_failed",
  // Recommendation Logic Spec v2 (client-side views on Check matches).
  "overview_viewed",
  "rule_viewed",
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
