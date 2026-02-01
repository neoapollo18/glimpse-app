import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { recordOrder } from "../lib/supabase.server";

// Webhooks only accept POST - return 405 for GET requests
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

/**
 * Orders Webhook Handler
 * 
 * Handles orders/create webhook to track purchases for conversion attribution.
 * Links orders to widget usage via cart_token.
 */

interface OrderPayload {
  id: number;
  name: string;
  cart_token: string | null;
  total_price: string;
  currency: string;
  customer?: {
    id: number;
  };
  created_at: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`[Orders] Received ${topic} webhook for ${shop}`);

    if (topic !== "ORDERS_CREATE" && topic !== "orders/create") {
      console.log(`[Orders] Ignoring webhook topic: ${topic}`);
      return new Response("OK", { status: 200 });
    }

    const order = payload as OrderPayload;
    
    console.log(`[Orders] Processing order:`, {
      shop,
      orderId: order.id,
      orderNumber: order.name,
      hasCartToken: !!order.cart_token,
      totalPrice: order.total_price,
    });

    // Record order for conversion tracking
    const result = await recordOrder(shop, {
      shopifyOrderId: String(order.id),
      cartToken: order.cart_token || undefined,
      orderNumber: order.name,
      totalPrice: parseFloat(order.total_price) || 0,
      currency: order.currency || 'USD',
      customerId: order.customer?.id ? String(order.customer.id) : undefined,
      createdAt: order.created_at,
    });

    if (result) {
      console.log(`[Orders] Order recorded successfully:`, result.id);
    } else {
      console.log(`[Orders] Failed to record order (shop may not be in system)`);
    }

    return new Response("OK", { status: 200 });
    
  } catch (error) {
    console.error("[Orders] Webhook processing error:", error);
    
    // Return 401 for HMAC verification failures
    if (error instanceof Error && error.message.includes("HMAC")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // For other errors, still return 200 to prevent infinite retries
    return new Response("OK", { status: 200 });
  }
};
