import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  countOrderEmailsForCustomer,
  deleteShopData,
  findQuizLeadsForCustomer,
  redactOrderEmailsForCustomer,
  redactQuizLeadsForCustomer,
} from "../lib/supabase.server";

/**
 * GDPR Compliance Webhooks
 *
 * These webhooks are REQUIRED by Shopify for all apps.
 * Failure to implement them can result in app rejection/removal.
 *
 * Data stored by Glimpse:
 * - Shop configurations (shop domain, product prompts)
 * - Aggregate analytics (transformation counts per product)
 * - Quiz leads (migration 067): shopper email/phone + quiz answers,
 *   captured only when the shopper opts in via the quiz's lead step.
 *   Covered below for customer data_request/redact; shop-level deletion
 *   cascades from the shops row (deleteShopData).
 * - Buyer email on order rows (migration 078): joins purchases to quiz
 *   leads for attribution. Redacted (nulled) on customers/redact, along
 *   with customer_id on the payload's orders_to_redact and customer.id.
 * - Klaviyo (migration 086): when a merchant connects Klaviyo, quiz leads
 *   are forwarded to the MERCHANT's own Klaviyo account (they are the
 *   controller there). Gleame keeps no copy beyond quiz_leads, which the
 *   redact below deletes; the merchant's key is stored encrypted in
 *   shop_integrations and deleted with the shop.
 * - Skin-analysis selfies (migration 028, founder-enabled shops only): kept
 *   in the private skin-analysis-photos bucket with an optional typed
 *   visitor name. Not tied to a Shopify customer, so customers/* can't
 *   match them; deleteShopData removes them on uninstall and shop/redact.
 *   Try-on photos are processed in memory only, never persisted.
 */

// Type definitions for webhook payloads
interface CustomerDataRequestPayload {
  shop_domain: string;
  customer: {
    id: number;
    email: string;
    phone?: string;
  };
  orders_requested: number[];
}

interface CustomerRedactPayload {
  shop_domain: string;
  customer: {
    id: number;
    email: string;
    phone?: string;
  };
  orders_to_redact: number[];
}

interface ShopRedactPayload {
  shop_domain: string;
  shop_id: number;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
      case "customers/data_request": {
        // Customer requested their data. Customer-identifiable data Glimpse
        // stores: quiz leads (email/phone + quiz answers, opt-in) and buyer
        // email / customer id on order rows (migration 078). Skin-analysis
        // selfies carry only a typed name, so they can't be matched to a
        // customer (see header); analytics are aggregate.
        const data = payload as CustomerDataRequestPayload;
        console.log(`[GDPR] Customer data request:`, {
          shop,
          customerId: data?.customer?.id,
          customerEmail: data?.customer?.email ? '***@***' : 'none', // Don't log actual email
          ordersRequested: data?.orders_requested?.length || 0,
        });

        const [leads, orderEmailCount] = await Promise.all([
          findQuizLeadsForCustomer(
            shop,
            data?.customer?.email ?? null,
            data?.customer?.phone ?? null
          ),
          countOrderEmailsForCustomer(shop, data?.customer?.email ?? null, {
            orderIds: data?.orders_requested,
            customerId: data?.customer?.id,
          }),
        ]);
        // Compliance audit trail. The merchant fulfills the request to the
        // customer; this records exactly what Glimpse holds for them.
        // (Contact values themselves stay out of the logs.)
        console.log(
          `[GDPR] Response: ${leads.length} quiz lead record(s) stored for customer ${data?.customer?.id}` +
            (leads.length > 0
              ? ` — fields: email/phone, quiz answer snapshot, matches shown, device type, captured-at (row ids: ${leads.map((l) => l.id).join(', ')})`
              : '') +
            `; ${orderEmailCount} order record(s) holding the customer's email or id (widget_orders.customer_email / customer_id)`
        );
        break;
      }

      case "CUSTOMERS_REDACT":
      case "customers/redact": {
        // Customer requested deletion of their data — remove any quiz leads
        // matching their email/phone for this shop.
        const data = payload as CustomerRedactPayload;
        console.log(`[GDPR] Customer redact request:`, {
          shop,
          customerId: data?.customer?.id,
          ordersToRedact: data?.orders_to_redact?.length || 0,
        });

        // Independent tables; run in parallel (GDPR webhooks have a tight
        // response budget and each helper does its own shop lookup).
        const [result, orderResult] = await Promise.all([
          redactQuizLeadsForCustomer(
            shop,
            data?.customer?.email ?? null,
            data?.customer?.phone ?? null
          ),
          // Buyer email on order rows (migration 078) is PII too: strip it,
          // plus customer_id on the payload's orders and customer id.
          redactOrderEmailsForCustomer(shop, data?.customer?.email ?? null, {
            orderIds: data?.orders_to_redact,
            customerId: data?.customer?.id,
          }),
        ]);
        if (!orderResult.ok) {
          console.error(`[GDPR] Order email redact failed:`, orderResult.error);
          return new Response("Redact failed", { status: 500 });
        }
        if (result.ok) {
          console.log(
            `[GDPR] Response: deleted ${result.deleted} quiz lead record(s), redacted ${orderResult.redacted} order email(s) for customer ${data?.customer?.id}`
          );
        } else {
          // 500 so Shopify retries — acknowledging a redact we failed to
          // perform would silently retain data the customer asked us to
          // delete. (Returned directly: the catch below maps thrown Errors
          // to 200.)
          console.error(`[GDPR] Quiz lead redact failed:`, result.error);
          return new Response("Redact failed", { status: 500 });
        }
        break;
      }

      case "SHOP_REDACT":
      case "shop/redact": {
        // Shop requested deletion of ALL their data
        // This is sent 48 hours after app uninstall as a final cleanup
        // We should delete everything, just like the uninstall webhook
        
        const data = payload as ShopRedactPayload;
        console.log(`[GDPR] Shop redact request:`, {
          shop,
          shopId: data?.shop_id,
        });
        
        // Delete all shop data from Supabase
        const cleanupResult = await deleteShopData(shop);
        
        if (!cleanupResult.success) {
          // "Already deleted by the uninstall webhook" reports success, so a
          // failure here is real: 500 so Shopify retries, like customers/redact.
          console.error(`[GDPR] Shop data deletion failed:`, cleanupResult.error);
          return new Response("Redact failed", { status: 500 });
        }
        console.log(`[GDPR] Shop data deletion completed:`, cleanupResult.deleted);
        break;
      }

      default:
        console.log(`[GDPR] Unhandled webhook topic: ${topic}`);
    }

    // IMPORTANT: Return 200 OK to acknowledge receipt. Shopify retries on an
    // error and may flag the app, so only a failed redact returns 500 (above).
    return new Response("OK", { status: 200 });
    
  } catch (error) {
    // authenticate.webhook throws a Response (401) on HMAC verification
    // failure; it MUST propagate. Returning 200 for forged/unverified
    // payloads fails Shopify's webhook security checks (mandatory for the
    // GDPR endpoints) and hides a misconfigured secret.
    if (error instanceof Response) throw error;
    console.error("[GDPR] Webhook processing error:", error);

    // For other errors, still return 200 to prevent infinite retries
    // Log the error for investigation
    return new Response("OK", { status: 200 });
  }
};
