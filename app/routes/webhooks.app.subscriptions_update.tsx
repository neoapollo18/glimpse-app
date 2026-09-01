import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  getShopBillingState,
  updateShopBillingState,
  updateShopSubscriptionStatus,
} from "../lib/supabase.server";

// Webhooks only accept POST - return 405 for GET requests
export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

/**
 * app_subscriptions/update — subscription lifecycle sync for the
 * Shopify-native billing (Mantle replacement).
 *
 * Rules (each earned by a confirmed review finding):
 * - The subscription id is persisted ONLY on ACTIVE. Persisting it for
 *   PENDING/DECLINED made a declined first attempt look like a consumed
 *   trial, silently forfeiting the merchant's promised 14 days.
 * - DECLINED/PENDING never change access state: a sub that never went
 *   ACTIVE has nothing to downgrade.
 * - Downgrades (cancelled etc.) apply only when the event is about the
 *   subscription we consider current — a decline of a NEW attempt must
 *   not cancel a shop that still has an older ACTIVE sub.
 * - Grandfathered is permanent and never overwritten.
 * - DB write failures return 500 so Shopify RETRIES; returning 200 on a
 *   failed cancellation write left cancelled shops with storefront
 *   access forever (the cron also reconciles as a backstop).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";
  try {
    const auth = await authenticate.webhook(request);
    shop = auth.shop;
    const sub = (auth.payload as Record<string, any>)?.app_subscription;
    if (!sub) return new Response("OK", { status: 200 });

    const status = String(sub.status ?? "").toUpperCase();
    const subId = String(sub.admin_graphql_api_id ?? "");
    console.log(`[billing] ${shop}: subscription ${subId} → ${status}`);

    const current = await getShopBillingState(shop);
    if (!current) {
      // Shop row missing/unreadable: retry later rather than dropping a
      // lifecycle event on the floor.
      return new Response("Retry", { status: 500 });
    }
    const grandfathered = current.subscription_status === "grandfathered";

    if (status === "ACTIVE") {
      const wrote = await updateShopBillingState(shop, { shopify_subscription_id: subId || null });
      let ok = wrote.ok;
      if (!grandfathered) {
        ok = (await updateShopSubscriptionStatus(shop, "active", null)).ok && ok;
      }
      return new Response(ok ? "OK" : "Retry", { status: ok ? 200 : 500 });
    }

    if (["CANCELLED", "EXPIRED", "FROZEN"].includes(status)) {
      if (grandfathered) return new Response("OK", { status: 200 });
      // Only downgrade for the subscription we consider current.
      if (current.shopify_subscription_id && subId && current.shopify_subscription_id !== subId) {
        return new Response("OK", { status: 200 });
      }
      const ok = (await updateShopSubscriptionStatus(shop, "cancelled", null)).ok;
      return new Response(ok ? "OK" : "Retry", { status: ok ? 200 : 500 });
    }

    // PENDING / DECLINED / anything else: no state change.
    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error(`[billing] app_subscriptions/update webhook failed for ${shop}:`, e);
    // Auth/parse failures must not retry-storm; genuine handler crashes
    // above already returned 500 where retry helps.
    return new Response("OK", { status: 200 });
  }
};
