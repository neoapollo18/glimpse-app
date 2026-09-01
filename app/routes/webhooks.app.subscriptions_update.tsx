import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  getShopBillingState,
  updateShopBillingState,
  updateShopSubscriptionStatus,
  type SubscriptionStatus,
} from "../lib/supabase.server";

// Webhooks only accept POST - return 405 for GET requests
export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

/**
 * app_subscriptions/update — the source of truth for subscription state
 * (Shopify-native billing, Mantle replacement). Fires on approve, decline,
 * cancel, freeze, and cycle changes for Billing-API subscriptions,
 * including ones Mantle created for this app before it shut down.
 *
 * Always returns 200 (repo convention) so Shopify doesn't retry-storm;
 * failures are logged.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, payload } = await authenticate.webhook(request);
    const sub = (payload as Record<string, any>)?.app_subscription;
    if (!sub) return new Response("OK", { status: 200 });

    const status = String(sub.status ?? "").toUpperCase();
    console.log(`[billing] ${shop}: subscription ${sub.admin_graphql_api_id} → ${status}`);

    // Keep the legacy subscription_status column in sync — the storefront
    // gate reads it (grandfathered stays untouched: only overwrite when
    // the shop is on a real subscription lifecycle).
    // FROZEN (store payment issues) maps to cancelled for access purposes;
    // PENDING (awaiting approval) maps to none — no access change either way
    // until the sub goes ACTIVE.
    const statusMap: Record<string, SubscriptionStatus> = {
      ACTIVE: "active",
      CANCELLED: "cancelled",
      DECLINED: "cancelled",
      EXPIRED: "cancelled",
      FROZEN: "cancelled",
      PENDING: "none",
    };

    await updateShopBillingState(shop, {
      shopify_subscription_id: String(sub.admin_graphql_api_id ?? "") || null,
    });
    const mapped = statusMap[status];
    const current = await getShopBillingState(shop);
    // Grandfathered is a permanent app-side grant — no subscription
    // lifecycle event may downgrade it.
    if (mapped && current?.subscription_status !== "grandfathered") {
      await updateShopSubscriptionStatus(shop, mapped, null);
    }
  } catch (e) {
    console.error("[billing] app_subscriptions/update webhook failed:", e);
  }
  return new Response("OK", { status: 200 });
};
