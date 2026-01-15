import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../lib/supabase.server";

/**
 * GDPR Compliance Webhooks
 * 
 * These webhooks are REQUIRED by Shopify for all apps.
 * Failure to implement them can result in app rejection/removal.
 * 
 * Data stored by Glimpse:
 * - Shop configurations (shop domain, product prompts)
 * - Aggregate analytics (transformation counts per product)
 * - NO customer-identifiable data (no emails, IDs, or photos stored)
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
        // Customer requested their data
        // Glimpse does NOT store any customer-identifiable data:
        // - No customer emails or IDs
        // - No customer photos (processed in memory only, never persisted)
        // - Analytics are aggregate only (counts per product, not per customer)
        
        const data = payload as CustomerDataRequestPayload;
        console.log(`[GDPR] Customer data request:`, {
          shop,
          customerId: data?.customer?.id,
          customerEmail: data?.customer?.email ? '***@***' : 'none', // Don't log actual email
          ordersRequested: data?.orders_requested?.length || 0,
        });
        
        // Log for compliance audit trail
        console.log(`[GDPR] Response: No customer-identifiable data stored for customer ${data?.customer?.id}`);
        
        // In a real scenario where you DO store customer data, you would:
        // 1. Query your database for data matching the customer email/ID
        // 2. Send that data to the merchant (via email or API)
        // For Glimpse, we have nothing to send.
        break;
      }

      case "CUSTOMERS_REDACT":
      case "customers/redact": {
        // Customer requested deletion of their data
        // Since we don't store customer-identifiable data, there's nothing to delete
        
        const data = payload as CustomerRedactPayload;
        console.log(`[GDPR] Customer redact request:`, {
          shop,
          customerId: data?.customer?.id,
          ordersToRedact: data?.orders_to_redact?.length || 0,
        });
        
        // Log for compliance audit trail
        console.log(`[GDPR] Response: No customer-identifiable data to redact for customer ${data?.customer?.id}`);
        
        // In a real scenario where you DO store customer data, you would:
        // 1. DELETE FROM your_table WHERE customer_id = X OR customer_email = Y
        // For Glimpse, we have nothing to delete.
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
    console.error("[GDPR] Webhook processing error:", error);
    
    // Return 401 for HMAC verification failures
    if (error instanceof Error && error.message.includes("HMAC")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // For other errors, still return 200 to prevent infinite retries
    // Log the error for investigation
    return new Response("OK", { status: 200 });
  }
};
