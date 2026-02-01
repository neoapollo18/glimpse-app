import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { trackTransformationEvent } from "../lib/supabase.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";

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

  // Rate limiting - lighter limits since this is just analytics
  const clientIP = getClientIP(request);
  const ipLimit = checkRateLimit(
    `track:ip:${clientIP}:minute`,
    RATE_LIMITS.TRACK_PER_IP_MINUTE.limit,
    RATE_LIMITS.TRACK_PER_IP_MINUTE.windowMs
  );
  
  if (!ipLimit.allowed) {
    // Silently accept but don't process - don't expose rate limit to potential attackers
    return json({ success: true }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const body = await request.json();
    const { shopDomain, productId, eventType, widgetType, cartToken } = body;

    if (!shopDomain || !productId || !eventType) {
      return json({ error: "Missing required fields" }, { 
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Only allow specific event types
    const allowedEvents = ['widget_view', 'add_to_cart', 'transformation'];
    if (!allowedEvents.includes(eventType)) {
      return json({ error: "Invalid event type" }, { 
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Validate and sanitize cart token (Shopify tokens are alphanumeric, typically 32 chars)
    let sanitizedCartToken: string | undefined = undefined;
    if (cartToken && typeof cartToken === 'string') {
      const trimmed = cartToken.trim();
      // Only accept alphanumeric tokens up to 64 chars (Shopify tokens are ~32)
      if (/^[a-zA-Z0-9-_]+$/.test(trimmed) && trimmed.length <= 64) {
        sanitizedCartToken = trimmed;
      }
    }

    // Track the event with cart token for conversion attribution (fire and forget for speed)
    trackTransformationEvent(
      shopDomain, 
      productId, 
      eventType, 
      widgetType || 'unknown',
      sanitizedCartToken
    ).catch(err => {
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
