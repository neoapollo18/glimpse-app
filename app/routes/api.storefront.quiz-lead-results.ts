import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  attachQuizLeadResults,
  findShopByDomain,
  shopHasValidAccess,
  supabase,
  type QuizLeadProduct,
} from "../lib/supabase.server";
import { getShopCurrency } from "../lib/shop-currency.server";
import { formatMoneyDisplay } from "../lib/shop-currency-format";
import { checkRateLimits, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { CORS_HEADERS } from "../lib/storefront-api.server";
import { sendResultsToKlaviyo, verifyLeadToken } from "../lib/integrations.server";

const MAX_PRODUCTS = 12;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,254}$/i;

/**
 * Results callback for a captured lead (migration 086). The lead POST
 * returned a signed leadToken; once results load the widget reports the
 * matches it showed. They are stored on the lead (merchant CSV) and sent
 * to Klaviyo as "Gleame Quiz Results" when connected.
 *
 * The client sends product HANDLES only. Titles, images, prices and URLs
 * are resolved from this shop's own catalog rows: whatever lands in the
 * merchant's Klaviyo emails is the merchant's real product data, never
 * text or links a caller made up (anyone can mint a leadToken by
 * submitting the public lead form).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }
  const shopDomain = typeof body?.shopDomain === "string" ? body.shopDomain.trim() : "";
  const token = typeof body?.leadToken === "string" ? body.leadToken : "";
  if (!shopDomain || !token) {
    return json({ error: "Missing shopDomain or leadToken" }, { status: 400, headers: CORS_HEADERS });
  }

  const rate = checkRateLimits([
    {
      key: `quiz-lead-results:ip:${getClientIP(request)}:minute`,
      limit: RATE_LIMITS.QUIZ_LEAD_RESULTS_PER_IP_MINUTE.limit,
      windowMs: RATE_LIMITS.QUIZ_LEAD_RESULTS_PER_IP_MINUTE.windowMs,
    },
  ]);
  if (!rate.allowed) {
    return json(
      { error: "Too many requests" },
      { status: 429, headers: { ...CORS_HEADERS, "Retry-After": String(rate.retryAfterSeconds ?? 30) } },
    );
  }

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
  const leadId = verifyLeadToken(shop.id, token);
  if (!leadId) return json({ error: "Invalid token" }, { status: 403, headers: CORS_HEADERS });
  if (!(await shopHasValidAccess(shop.shop_domain))) {
    return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
  }

  const handles: string[] = [];
  for (const p of Array.isArray(body.products) ? body.products : []) {
    const h = typeof p?.handle === "string" ? p.handle.trim() : "";
    if (HANDLE_RE.test(h) && !handles.includes(h)) handles.push(h);
    if (handles.length >= MAX_PRODUCTS) break;
  }
  if (handles.length === 0) return json({ success: true }, { headers: CORS_HEADERS });

  const [{ data: rows }, currency] = await Promise.all([
    supabase
      .from("products")
      .select("handle, shopify_id, product_name, image_url, price, status")
      .eq("shop_id", shop.id)
      .in("handle", handles),
    getShopCurrency(shop.id).catch(() => null),
  ]);
  // myshopify.com URLs redirect to the store's primary domain.
  const storeBase = `https://${shop.shop_domain}`;
  const byHandle = new Map(((rows ?? []) as Array<Record<string, any>>).map((r) => [String(r.handle), r]));
  const products: QuizLeadProduct[] = handles
    .map((h) => byHandle.get(h))
    .filter((r): r is Record<string, any> => Boolean(r && r.product_name))
    .map((r) => ({
      productId: r.shopify_id != null ? String(r.shopify_id) : null,
      title: String(r.product_name).slice(0, 255),
      url: `${storeBase}/products/${encodeURIComponent(String(r.handle))}`,
      imageUrl: typeof r.image_url === "string" && /^https:\/\//.test(r.image_url) ? r.image_url : null,
      price: typeof r.price === "number" ? formatMoneyDisplay(r.price, currency) : null,
    }));
  if (products.length === 0) return json({ success: true }, { headers: CORS_HEADERS });

  const attached = await attachQuizLeadResults(shop.id, leadId, products);
  if (!attached.ok) {
    // Unknown lead after a valid signature = the lead was deleted (GDPR
    // redact / merchant cleanup). Nothing to do; never an error for the
    // shopper.
    if (attached.error !== "lead not found") {
      console.error(`quiz-lead-results: attach failed for ${shop.shop_domain}:`, attached.error);
    }
    return json({ success: true }, { headers: CORS_HEADERS });
  }
  void sendResultsToKlaviyo(shop.id, { leadId, ...attached.lead }, products);
  return json({ success: true }, { headers: CORS_HEADERS });
};

export const loader = async () => new Response(null, { status: 204, headers: CORS_HEADERS });
