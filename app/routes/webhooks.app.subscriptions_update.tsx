import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { adminGraphql, getActiveSubscription } from "../lib/shopify-billing.server";
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
 *   not cancel a shop that still has an older ACTIVE sub. With no stored
 *   id (untracked Mantle-era sub), live state is checked first so a
 *   replacement-cancel can't downgrade a shop whose NEW sub is ACTIVE.
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
      // No stored id to compare (e.g. a Mantle-era sub the app never
      // tracked): this event may be STANDARD replacement cancelling the
      // old sub while a NEW one is (or just went) ACTIVE — mirror the
      // cron's reconciliation and check reality before pulling access. On
      // any doubt (no admin, query failure) fall through to the downgrade;
      // the cron reconciles both directions as a backstop.
      if (!current.shopify_subscription_id && auth.admin) {
        try {
          const live = await getActiveSubscription(adminGraphql(auth.admin));
          if (live?.status === "ACTIVE" && live.id !== subId) {
            console.log(`[billing] ${shop}: ignoring ${status} for untracked ${subId} — ${live.id} is ACTIVE`);
            return new Response("OK", { status: 200 });
          }
        } catch (checkError) {
          console.error(`[billing] ${shop}: live subscription check failed, proceeding with downgrade:`, checkError);
        }
      }
      const ok = (await updateShopSubscriptionStatus(shop, "cancelled", null)).ok;
      return new Response(ok ? "OK" : "Retry", { status: ok ? 200 : 500 });
    }

    // PENDING / DECLINED / anything else: no state change.
    return new Response("OK", { status: 200 });
  } catch (e) {
    // authenticate.webhook throws a Response (401) on HMAC verification
    // failure; it MUST propagate. Returning 200 for forged/unverified
    // payloads fails Shopify's webhook security checks and hides a
    // misconfigured secret behind healthy-looking deliveries.
    if (e instanceof Response) throw e;
    console.error(`[billing] app_subscriptions/update webhook failed for ${shop}:`, e);
    // Parse failures must not retry-storm; genuine handler crashes
    // above already returned 500 where retry helps.
    return new Response("OK", { status: 200 });
  }
};
