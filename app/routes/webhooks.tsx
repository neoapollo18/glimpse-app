import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
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
 *   leads for attribution. Redacted (nulled) on customers/redact.
 * - NO customer photos (processed in memory only, never persisted)
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
        // Customer requested their data. The only customer-identifiable data
        // Glimpse stores is quiz leads (email/phone + quiz answers, opt-in).
        // Photos are processed in memory only; analytics are aggregate.
        const data = payload as CustomerDataRequestPayload;
        console.log(`[GDPR] Customer data request:`, {
          shop,
          customerId: data?.customer?.id,
          customerEmail: data?.customer?.email ? '***@***' : 'none', // Don't log actual email
          ordersRequested: data?.orders_requested?.length || 0,
        });

        const leads = await findQuizLeadsForCustomer(
          shop,
          data?.customer?.email ?? null,
          data?.customer?.phone ?? null
        );
        // Compliance audit trail. The merchant fulfills the request to the
        // customer; this records exactly what Glimpse holds for them.
        // (Contact values themselves stay out of the logs.)
        console.log(
          `[GDPR] Response: ${leads.length} quiz lead record(s) stored for customer ${data?.customer?.id}` +
            (leads.length > 0
              ? ` — fields: email/phone, quiz answer snapshot, device type, captured-at (row ids: ${leads.map((l) => l.id).join(', ')})`
              : '')
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

        const result = await redactQuizLeadsForCustomer(
          shop,
          data?.customer?.email ?? null,
          data?.customer?.phone ?? null
        );
        // Buyer email on order rows (migration 078) is PII too — strip it.
        const orderResult = await redactOrderEmailsForCustomer(
          shop,
          data?.customer?.email ?? null
        );
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
        
        if (cleanupResult.success) {
          console.log(`[GDPR] Shop data deletion completed:`, cleanupResult.deleted);
        } else {
          // Log but don't fail - data may have been deleted by uninstall webhook already
          console.log(`[GDPR] Shop data deletion note:`, cleanupResult.error || 'No data found (may already be deleted)');
        }
        break;
      }

      default:
        console.log(`[GDPR] Unhandled webhook topic: ${topic}`);
    }

    // IMPORTANT: Always return 200 OK to acknowledge receipt
    // Shopify will retry if you return an error, and may flag your app
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
