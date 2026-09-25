import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { findShopByDomain, recordOrder, supabase, type OrderJourneyData } from "../lib/supabase.server";

// Webhooks only accept POST - return 405 for GET requests
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

/**
 * Orders Webhook Handler
 *
 * Handles orders/create webhook to track purchases for conversion attribution.
 * Links orders to widget usage via cart_token and enriches with
 * Order.customerJourneySummary (traffic source / repeat-purchase / time-to-buy).
 */

interface OrderPayload {
  id: number;
  name: string;
  cart_token: string | null;
  total_price: string;
  currency: string;
  email?: string | null;
  contact_email?: string | null;
  customer?: { id: number; email?: string | null };
  created_at: string;
}

interface CustomerVisitNode {
  source?: string | null;
  sourceType?: string | null;
  landingPage?: string | null;
  occurredAt?: string | null;
  utmParameters?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
}

interface JourneyQueryResponse {
  data?: {
    order?: {
      customerJourneySummary?: {
        customerOrderIndex?: number | null;
        daysToConversion?: number | null;
        firstVisit?: CustomerVisitNode | null;
        lastVisit?: CustomerVisitNode | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

const JOURNEY_QUERY = `#graphql
  query OrderJourney($id: ID!) {
    order(id: $id) {
      customerJourneySummary {
        customerOrderIndex
        daysToConversion
        firstVisit {
          source
          sourceType
          landingPage
          occurredAt
          utmParameters { source medium campaign }
        }
        lastVisit {
          source
          sourceType
          landingPage
          occurredAt
          utmParameters { source medium campaign }
        }
      }
    }
  }
`;

function visitToFields(visit: CustomerVisitNode | null | undefined): {
  source: string | null;
  sourceType: string | null;
  landingPage: string | null;
  utm: Record<string, string | null> | null;
  at: string | null;
} {
  if (!visit) return { source: null, sourceType: null, landingPage: null, utm: null, at: null };
  const utm = visit.utmParameters
    ? {
        source: visit.utmParameters.source ?? null,
        medium: visit.utmParameters.medium ?? null,
        campaign: visit.utmParameters.campaign ?? null,
      }
    : null;
  // Drop the UTM object entirely if every field is null — keeps JSONB tidy.
  const utmHasValue = utm && (utm.source || utm.medium || utm.campaign);
  return {
    source: visit.source ?? null,
    sourceType: visit.sourceType ?? null,
    landingPage: visit.landingPage ?? null,
    utm: utmHasValue ? utm : null,
    at: visit.occurredAt ?? null,
  };
}

async function fetchOrderJourney(
  admin: { graphql: (q: string, opts: { variables: Record<string, unknown> }) => Promise<Response> },
  shopifyOrderId: string,
): Promise<OrderJourneyData | null> {
  try {
    const gid = shopifyOrderId.startsWith('gid://')
      ? shopifyOrderId
      : `gid://shopify/Order/${shopifyOrderId}`;
    const response = await admin.graphql(JOURNEY_QUERY, { variables: { id: gid } });
    const result = (await response.json()) as JourneyQueryResponse;

    if (result.errors && result.errors.length > 0) {
      console.error('[Orders] customerJourneySummary GraphQL errors:', result.errors);
      return null;
    }

    const summary = result.data?.order?.customerJourneySummary;
    if (!summary) return null;

    const first = visitToFields(summary.firstVisit);
    const last = visitToFields(summary.lastVisit);
    return {
      firstTouchSource: first.source,
      firstTouchSourceType: first.sourceType,
      firstTouchLandingPage: first.landingPage,
      firstTouchUtm: first.utm,
      firstTouchAt: first.at,
      lastTouchSource: last.source,
      lastTouchSourceType: last.sourceType,
      lastTouchLandingPage: last.landingPage,
      lastTouchUtm: last.utm,
      lastTouchAt: last.at,
      customerOrderIndex: summary.customerOrderIndex ?? null,
      daysToConversion: summary.daysToConversion ?? null,
    };
  } catch (error) {
    console.error('[Orders] Failed to fetch customerJourneySummary:', error);
    return null;
  }
}

/**
 * Redelivery guard: recordOrder upserts the FULL row, so a retried delivery
 * whose journey enrichment fails (GraphQL error/timeout, or no admin context)
 * would overwrite previously captured attribution with nulls. Re-read what an
 * earlier delivery stored so the upsert re-writes the same values instead.
 */
async function fetchStoredJourney(
  shopDomain: string,
  shopifyOrderId: string,
): Promise<OrderJourneyData | null> {
  try {
    const shopRow = await findShopByDomain(shopDomain);
    if (!shopRow) return null;
    const { data, error } = await supabase
      .from('widget_orders')
      .select('first_touch_source, first_touch_source_type, first_touch_landing_page, first_touch_utm, first_touch_at, last_touch_source, last_touch_source_type, last_touch_landing_page, last_touch_utm, last_touch_at, customer_order_index, days_to_conversion')
      .eq('shop_id', shopRow.id)
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();
    if (error || !data) return null;
    // Nothing to preserve if every journey column is already null.
    if (!Object.values(data).some((v) => v !== null)) return null;
    return {
      firstTouchSource: data.first_touch_source,
      firstTouchSourceType: data.first_touch_source_type,
      firstTouchLandingPage: data.first_touch_landing_page,
      firstTouchUtm: data.first_touch_utm,
      firstTouchAt: data.first_touch_at,
      lastTouchSource: data.last_touch_source,
      lastTouchSourceType: data.last_touch_source_type,
      lastTouchLandingPage: data.last_touch_landing_page,
      lastTouchUtm: data.last_touch_utm,
      lastTouchAt: data.last_touch_at,
      customerOrderIndex: data.customer_order_index,
      daysToConversion: data.days_to_conversion,
    };
  } catch (error) {
    console.error('[Orders] Failed to read stored journey:', error);
    return null;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic, payload, admin } = await authenticate.webhook(request);

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

    // Enrich with customerJourneySummary when we have an admin context.
    // Webhooks fire from uninstalled shops too — admin will be undefined then.
    let journey: OrderJourneyData | null = null;
    if (admin) {
      journey = await fetchOrderJourney(admin, String(order.id));
    } else {
      console.log('[Orders] No admin context available, skipping journey enrichment');
    }

    // If enrichment came back empty, fall back to any attribution a previous
    // delivery of this order already captured (see fetchStoredJourney).
    if (!journey) {
      journey = await fetchStoredJourney(shop, String(order.id));
    }

    // Buyer email (migration 078): joins to quiz_leads.email for lead →
    // purchase attribution. Payload exposes it in up to three places
    // depending on checkout type; first non-empty wins.
    const customerEmail =
      (order.email || order.contact_email || order.customer?.email || '').trim().toLowerCase() ||
      undefined;

    const result = await recordOrder(shop, {
      shopifyOrderId: String(order.id),
      cartToken: order.cart_token || undefined,
      orderNumber: order.name,
      totalPrice: parseFloat(order.total_price) || 0,
      currency: order.currency || 'USD',
      customerId: order.customer?.id ? String(order.customer.id) : undefined,
      customerEmail,
      createdAt: order.created_at,
      journey: journey ?? undefined,
    });

    if (result) {
      console.log(`[Orders] Order recorded successfully:`, result.id);
    } else {
      console.log(`[Orders] Failed to record order (shop may not be in system)`);
    }

    return new Response("OK", { status: 200 });

  } catch (error) {
    // authenticate.webhook throws a Response (401) on HMAC verification
    // failure; it MUST propagate. Returning 200 for forged/unverified
    // payloads fails Shopify's webhook security checks and hides a
    // misconfigured secret behind healthy-looking deliveries.
    if (error instanceof Response) throw error;
    console.error("[Orders] Webhook processing error:", error);

    // For other errors, still return 200 to prevent infinite retries
    return new Response("OK", { status: 200 });
  }
};
