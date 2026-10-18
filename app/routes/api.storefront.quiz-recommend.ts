import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  trackAssistantEvent,
  type MultiCriteria,
} from "../lib/supabase.server";
import { checkRateLimit, getClientIP } from "../lib/rate-limiter.server";
import { computeQuizRecommendations } from "../lib/quiz-recommend.server";
import { JSON_BODY_LIMIT_BYTES, rejectOversizedBody } from "../lib/storefront-api.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

/**
 * Fast, criteria-only recommendations for the quiz page. No image, no
 * transforms — the quiz renders result cards immediately from product
 * imagery (fetched client-side via /products/{handle}.js) and streams
 * try-on previews in separately via /api/storefront/quiz-tryon.
 *
 * Request:  JSON { shopDomain, criteria: { axis_key: axis_value | [axis_value, ...] }, resultKey? }
 *           (arrays come from multi-select questions; resultKey = a columnar
 *           shop's results permalink, which alone re-serves that result)
 * Response: {
 *   matches: [{ productId, variantId, variantNumericId, productHandle,
 *               productName, variantTitle, title, tagline, whyFits, rank,
 *               quantity, reasons: string[] }],
 *   (whyFits = the merchant's "why this fits" line, migration 092; reasons
 *    = authored answer copy or the AI ranker's reason, never an answer echo)
 *   matrixApplied: boolean,
 *   partial: boolean   // true when matched via containment (e.g. shade
 *                      // still unanswered) — the quiz shows the shade gate
 *   columnar?: {...}   // columnar shops only, see columnar/engine.server.ts
 * }
 */
// CORS preflight — Remix routes OPTIONS to the LOADER, not the action (same
// pattern as track-event). The quiz widget posts JSON, so unlike the chat's
// FormData posts, every browser call here is preceded by a preflight.
export const loader = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }
  const oversized = rejectOversizedBody(request, JSON_BODY_LIMIT_BYTES, CORS_HEADERS);
  if (oversized) return oversized;

  try {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
    }
    const { shopDomain, criteria: rawCriteria, cartToken, deviceType, storePreview, resultKey: rawResultKey } = (body ?? {}) as {
      shopDomain?: string;
      criteria?: unknown;
      cartToken?: unknown;
      deviceType?: unknown;
      storePreview?: unknown;
      resultKey?: unknown;
    };
    // Shape-checked here; the engine decodes it strictly (pipeline.ts).
    const resultKey =
      typeof rawResultKey === "string" && /^[a-z0-9.]{1,64}$/.test(rawResultKey) ? rawResultKey : null;

    if (!shopDomain || typeof shopDomain !== "string") {
      return json({ error: "Missing required field: shopDomain" }, { status: 400, headers: CORS_HEADERS });
    }

    // Defensive criteria validation, extended for multi-select: keys must be
    // lower snake_case identifiers; values a matching string OR an array of
    // them (deduped, capped). Anything else is dropped. Null prototype +
    // explicit blocklist: "__proto__"/"constructor"/"prototype" pass the
    // identifier regex, and on a plain object `criteria["__proto__"] = [...]`
    // is a setter call, not a key write — this is a public endpoint.
    const criteria: MultiCriteria = Object.create(null);
    if (rawCriteria && typeof rawCriteria === "object" && !Array.isArray(rawCriteria)) {
      // Length-capped: identifiers here can reach an LLM prompt (as lookup
      // keys only, but a megabyte "identifier" would still be a paid-token
      // amplifier) and unbounded keys would bloat the rules matcher.
      const ID_RE = /^[a-z_][a-z0-9_]{0,63}$/;
      const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
      const MAX_VALUES_PER_AXIS = 16;
      const MAX_AXES = 32;
      for (const [k, v] of Object.entries(rawCriteria as Record<string, unknown>)) {
        if (Object.keys(criteria).length >= MAX_AXES) break;
        if (!ID_RE.test(k) || PROTO_KEYS.has(k)) continue;
        if (typeof v === "string" && ID_RE.test(v)) {
          criteria[k] = v;
        } else if (Array.isArray(v)) {
          const values = [...new Set(v.filter(
            (s): s is string => typeof s === "string" && ID_RE.test(s)
          ))].slice(0, MAX_VALUES_PER_AXIS);
          if (values.length > 0) criteria[k] = values;
        }
      }
    }

    // Verify shop
    const verifiedShop = await findShopByDomain(shopDomain);
    if (!verifiedShop) {
      return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
    }
    const verifiedDomain = verifiedShop.shop_domain;

    // Billing check
    const hasAccess = await shopHasValidAccess(verifiedDomain);
    if (!hasAccess) {
      return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
    }

    // Rate limit. The shade merge-and-rerun flow legitimately calls this
    // twice per session. Note: in ai/hybrid modes this endpoint can make a
    // Gemini call — that path has its own tighter limiter below which
    // degrades to the shuffle fallback instead of erroring.
    const clientIP = getClientIP(request);
    const ipLimit = checkRateLimit(`quiz-recommend:ip:${clientIP}:minute`, 20, 60_000);
    if (!ipLimit.allowed) {
      return json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": ipLimit.retryAfterSeconds.toString() } }
      );
    }

    // Assistant kill switch is shared with chat.
    const chatConfig = await getChatAssistantConfig(verifiedDomain);
    if (!chatConfig.enabled) {
      return json({ error: "Assistant not enabled" }, { status: 403, headers: CORS_HEADERS });
    }

    const result = await computeQuizRecommendations({ verifiedShop, verifiedDomain, chatConfig, criteria, clientIP, resultKey });

    // Analytics (2026-10-15 revamp): what this shopper answered and what the
    // quiz recommended, for every finished quiz (not only email leads).
    // Server-built from validated criteria and our own matches. Merchant
    // test runs on the on-store preview send storePreview and stay out, and
    // so does a results permalink reload (no quiz was finished).
    const permalinkReload = Object.keys(criteria).length === 0 && resultKey !== null && Boolean(result.columnar);
    if (storePreview !== true && !permalinkReload && Array.isArray(result.matches) && result.matches.length > 0) {
      const token = typeof cartToken === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(cartToken.trim().split("?")[0])
        ? cartToken.trim().split("?")[0]
        : undefined;
      const device = deviceType === "mobile" || deviceType === "desktop" ? deviceType : undefined;
      const numeric = (v: unknown) => {
        const m = /(\d{1,20})$/.exec(String(v ?? ""));
        return m ? m[1] : null;
      };
      trackAssistantEvent(verifiedDomain, "quiz_recommendations_served", "quiz", token, device, {
        criteria,
        partial: Boolean(result.partial),
        n: result.matches.length,
        // Columnar shops (brief section 8): the relaxation rung used and the
        // permalink key, so results can be grouped by answer path.
        ...(result.columnar ? { rung: result.columnar.rung, rk: result.columnar.resultKey } : {}),
        recs: result.matches.slice(0, 12).map((m, i) => ({
          h: m.productHandle,
          p: numeric(m.productId),
          v: m.variantNumericId != null ? String(m.variantNumericId) : null,
          r: i + 1,
        })),
      }).catch((err) => console.error("quiz_recommendations_served log failed:", err));
    }
    return json(result, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Quiz recommend error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
};
