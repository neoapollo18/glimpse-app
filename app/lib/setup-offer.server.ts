// "Want us to set it up for you?" popup (Oct 2026). Offers organic
// installers a free done-for-you setup so the team gets a conversation
// with them (and, later, a review).
//
// Shown once per shop: any answer (including closing it) writes a
// setup_offer_* row to analytics_events (same sink as the overhaul funnel
// events, so no migration), and the loaders stop offering once one exists.
//
// Who sees it: every quiz-less shop on the onboarding scope screen (where
// new installs land), and on the dashboard only shops whose quiz isn't
// live AND that came through self-serve onboarding (a scope_selected
// event). Team-built brands never ran that screen, so they're never asked.

import { supabase } from "./supabase.server";
import { sendSetupRequestEmail } from "./email.server";

export const SETUP_OFFER_EVENTS = ["setup_offer_requested", "setup_offer_dismissed"] as const;
export type SetupOfferEvent = (typeof SETUP_OFFER_EVENTS)[number];

// Positive cache: once a shop has answered it never needs the query again.
const answered = new Set<string>();

async function countEvents(shopId: string, types: readonly string[]): Promise<number | null> {
  const { count, error } = await supabase
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .in("event_type", types as string[]);
  if (error) {
    console.warn(`[setup-offer] lookup failed for shop ${shopId}:`, error.message);
    return null;
  }
  return count ?? 0;
}

/** True when the shop hasn't answered the offer yet (and, with
 * selfServeOnly, went through self-serve onboarding). Errors hide the
 * popup: a missed offer is cheaper than one that won't go away. */
export async function shouldOfferSetup(
  shopId: string | null | undefined,
  opts: { selfServeOnly?: boolean } = {},
): Promise<boolean> {
  if (!shopId || answered.has(shopId)) return false;
  const [answers, selfServe] = await Promise.all([
    countEvents(shopId, SETUP_OFFER_EVENTS),
    opts.selfServeOnly ? countEvents(shopId, ["scope_selected"]) : Promise.resolve(1),
  ]);
  if (answers === null || selfServe === null) return false;
  if (answers > 0) {
    answered.add(shopId);
    return false;
  }
  return selfServe > 0;
}

/** Merchant contact for prefilling the popup. Never throws. */
export async function getSetupOfferContact(admin: {
  graphql: (q: string) => Promise<Response>;
}): Promise<{ email: string; shopName: string; ownerName: string }> {
  try {
    const res = await admin.graphql(`query GleameSetupOfferContact { shop { name email shopOwnerName } }`);
    const shop = (await res.json())?.data?.shop;
    return {
      email: String(shop?.email ?? ""),
      shopName: String(shop?.name ?? ""),
      ownerName: String(shop?.shopOwnerName ?? ""),
    };
  } catch {
    return { email: "", shopName: "", ownerName: "" };
  }
}

export async function recordSetupOffer(
  shopDomain: string,
  event: SetupOfferEvent,
  details: {
    email?: string;
    phone?: string;
    notes?: string;
    shopName?: string;
    ownerName?: string;
    source?: string;
  } = {},
): Promise<{ ok: boolean; error?: string }> {
  const shop = await supabase
    .from("shops")
    .select("id, install_id")
    .eq("shop_domain", shopDomain)
    .single();
  if (shop.error || !shop.data) return { ok: false, error: "Shop not found" };

  let emailed = false;
  if (event === "setup_offer_requested") {
    emailed = await sendSetupRequestEmail({
      shopDomain,
      shopName: details.shopName ?? "",
      ownerName: details.ownerName ?? "",
      email: details.email ?? "",
      phone: details.phone ?? "",
      notes: details.notes ?? "",
      source: details.source ?? "",
    });
  }

  const { error } = await supabase.from("analytics_events").insert({
    shop_id: shop.data.id,
    product_id: null,
    event_type: event,
    widget_type: "overhaul",
    properties: { ...details, emailed, install_id: shop.data.install_id },
  });
  if (error) {
    console.error(`[setup-offer] ${event} insert failed for ${shopDomain}:`, error.message);
    // The team was still emailed; only a failed request with no email is lost.
    if (event === "setup_offer_requested" && !emailed) {
      return { ok: false, error: "Couldn't send your request. Try again in a moment." };
    }
    return { ok: true };
  }
  answered.add(shop.data.id);
  console.log(`[setup-offer] ${shopDomain}: ${event}${event === "setup_offer_requested" ? ` (emailed: ${emailed})` : ""}`);
  return { ok: true };
}
