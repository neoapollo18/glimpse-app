import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { trackTransformationEvent } from "../lib/supabase.server";

// Simple event tracking endpoint for widget views and add-to-cart events
export const action = async ({ request }: ActionFunctionArgs) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { 
      status: 405,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const body = await request.json();
    const { shopDomain, productId, eventType, widgetType } = body;

    if (!shopDomain || !productId || !eventType) {
      return json({ error: "Missing required fields" }, { 
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Only allow specific event types
    const allowedEvents = ['widget_view', 'add_to_cart'];
    if (!allowedEvents.includes(eventType)) {
      return json({ error: "Invalid event type" }, { 
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Track the event (fire and forget for speed)
    trackTransformationEvent(shopDomain, productId, eventType, widgetType || 'unknown').catch(err => {
      console.error('Failed to track event:', err);
    });

    return json({ success: true }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  } catch (error) {
    console.error('Track event error:', error);
    return json({ error: "Internal error" }, { 
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};

// Handle OPTIONS for CORS - Remix needs this as a loader for preflight
export const loader = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    },
  });
};
