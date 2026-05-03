import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { findShopByDomain } from "../lib/supabase.server";
import { isSkinAnalysisEnabledByShopId } from "../lib/skin-analysis.server";
import { checkRateLimit, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";

/**
 * Storefront feedback endpoint for "Report a bad analysis" clicks.
 *
 * Stores nothing — logs structured records via console.error so they show
 * up in app log search. Acts as a free in-the-wild fairness signal: if a
 * pattern emerges (e.g. a particular shop reporting consistently inflated
 * scores), we know to revisit prompt calibration.
 *
 * Privacy posture: feedback bodies are merchant-scoped and contain only
 * the analysis JSON (which has no biometric data — just numeric scores
 * and skin-type classification). No photo, no client identifier.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

const MAX_BODY_BYTES = 8 * 1024; // ~8KB cap on the feedback body

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: "Body too large" }, { status: 413, headers: CORS_HEADERS });
    }

    let body: { shopDomain?: string; reason?: string; analysis?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
    }

    const shopDomain = typeof body.shopDomain === "string" ? body.shopDomain : "";
    if (!shopDomain) {
      return json({ error: "Missing shopDomain" }, { status: 400, headers: CORS_HEADERS });
    }

    // Verify shop exists (same 404 trick as analyze-skin so attackers can't
    // probe to enumerate which shops have the feature on).
    const shop = await findShopByDomain(shopDomain);
    if (!shop) {
      return json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
    }

    // Feature-flag gate. Rejecting reports from disabled shops both keeps
    // logs clean and stops random POSTs from polluting the report stream.
    const enabled = await isSkinAnalysisEnabledByShopId(shop.id);
    if (!enabled) {
      return json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
    }

    // Rate limit reports per IP — generous enough that genuine repeated
    // feedback works, tight enough to discourage spam.
    const clientIP = getClientIP(request);
    const ipMinute = checkRateLimit(
      `report-skin:ip:${clientIP}:minute`,
      RATE_LIMITS.TRACK_PER_IP_MINUTE.limit,
      RATE_LIMITS.TRACK_PER_IP_MINUTE.windowMs
    );
    if (!ipMinute.allowed) {
      return json(
        { error: "Too many reports" },
        {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": ipMinute.retryAfterSeconds.toString() },
        }
      );
    }

    // Console.error so it surfaces in any log-aggregator's "errors" view.
    // Prefixed with [REPORT] for easy grep. shop_domain first, then the
    // freeform reason (capped), then the analysis JSON.
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 1000) : "";
    console.error(
      `[skin-analysis][REPORT] shop=${shop.shop_domain} reason="${reason.replace(/\n/g, " ")}" analysis=${JSON.stringify(body.analysis ?? null).slice(0, 4000)}`
    );

    return json({ success: true }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[skin-analysis][REPORT] unexpected error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};

export const loader = async () => {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
};
