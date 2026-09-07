import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  isCatalogSyncEnabled,
  markProductDeleted,
  syncSingleProduct,
} from "../lib/catalog-sync.server";
import { findShopByDomain, supabase } from "../lib/supabase.server";

/**
 * Shopify does not guarantee webhook ordering: a retried products/update (or
 * products/create) can land AFTER products/delete for the same product, and
 * syncing it would re-upsert the soft-deleted mirror row as status 'active' —
 * resurrecting a deleted product into the recommendation pool. Shopify never
 * reuses product ids and product rows only become 'deleted' via
 * products/delete, so any create/update for an already-soft-deleted row is
 * by definition stale. On lookup errors we return false (proceed with the
 * sync), preserving the old behavior for normal ordering.
 */
async function isProductSoftDeleted(shopDomain: string, shopifyProductId: number): Promise<boolean> {
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return false;
  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("status", "deleted")
    .in("shopify_id", [`gid://shopify/Product/${shopifyProductId}`, String(shopifyProductId)])
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// Webhooks only accept POST - return 405 for GET requests
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

/**
 * Products Webhook Handler (products/create, products/update, products/delete)
 *
 * Keeps the Supabase catalog mirror fresh for shops that opted into catalog
 * sync. Fires for EVERY installed shop, so the very first check is the
 * per-shop catalog_sync_enabled gate: shops that never enabled sync (all
 * pre-overhaul merchants) are a guaranteed no-op with zero writes.
 *
 * Always returns 200 (per webhooks.orders.tsx convention) so Shopify doesn't
 * retry-storm us; failures are logged instead.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    if (!(await isCatalogSyncEnabled(shop))) {
      return new Response("OK", { status: 200 });
    }

    console.log(`[Products] Received ${topic} webhook for ${shop}`);

    switch (topic) {
      case "PRODUCTS_CREATE":
      case "products/create":
      case "PRODUCTS_UPDATE":
      case "products/update": {
        const shopifyProductId = (payload as { id: number }).id;
        if (await isProductSoftDeleted(shop, shopifyProductId)) {
          console.log(
            `[Products] Skipping stale ${topic} for soft-deleted product ${shopifyProductId} (${shop})`,
          );
          break;
        }
        const result = await syncSingleProduct(shop, payload as any);
        if (!result.ok) console.error(`[Products] sync errors for ${shop}:`, result.errors);
        break;
      }
      case "PRODUCTS_DELETE":
      case "products/delete": {
        const result = await markProductDeleted(shop, (payload as { id: number }).id);
        if (!result.ok) console.error(`[Products] delete errors for ${shop}:`, result.errors);
        break;
      }
      default:
        console.log(`[Products] Ignoring webhook topic: ${topic}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    // authenticate.webhook throws a Response (401) on HMAC verification
    // failure — that MUST propagate. Returning 200 for forged/unverified
    // payloads fails Shopify's webhook security checks and hides a
    // misconfigured secret behind healthy-looking deliveries.
    if (error instanceof Response) throw error;
    console.error("[Products] Webhook processing failed:", error);
    // 200 for processing bugs: a retry storm can't fix a code bug, and sync
    // self-heals on the next full page sync.
    return new Response("OK", { status: 200 });
  }
};
