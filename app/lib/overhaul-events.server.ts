/**
 * Overhaul funnel instrumentation (spec Part 6 / F1).
 *
 * Merchant-side funnel events, written server-side into analytics_events
 * with the shop's install_id and a jsonb payload. Fire-and-forget: an
 * analytics failure must never fail the flow that emitted it.
 *
 * Event names (spec Part 6, use exactly):
 *   install_completed, scope_selected, generation_completed,
 *   template_assigned, reveal_viewed, reveal_quiz_played,
 *   template_switched, store_preview_opened, studio_opened,
 *   publish_completed, first_shopper_completion
 */

import { supabase } from "./supabase.server";

export type OverhaulEvent =
  | "install_completed"
  | "scope_selected"
  | "generation_completed"
  | "template_assigned"
  | "reveal_viewed"
  | "reveal_quiz_played"
  | "template_switched"
  | "store_preview_opened"
  | "studio_opened"
  | "publish_completed"
  | "first_shopper_completion";

export function trackOverhaulEvent(
  shopDomain: string,
  event: OverhaulEvent,
  properties: Record<string, unknown> = {}
): void {
  void (async () => {
    try {
      const shop = await supabase
        .from("shops")
        .select("id, install_id")
        .eq("shop_domain", shopDomain)
        .single();
      if (shop.error || !shop.data) return;
      await supabase.from("analytics_events").insert({
        shop_id: shop.data.id,
        product_id: null,
        event_type: event,
        widget_type: "overhaul",
        properties: { ...properties, install_id: shop.data.install_id },
      });
    } catch (e) {
      console.warn(`[overhaul-events] ${event} failed for ${shopDomain}:`, (e as Error).message);
    }
  })();
}
