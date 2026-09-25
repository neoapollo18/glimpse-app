import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  findShopByDomain,
  shopHasValidAccess,
  getChatAssistantConfig,
  saveQuizLead,
  type QuizLeadAnswer,
} from "../lib/supabase.server";
import { checkRateLimits, getClientIP, RATE_LIMITS } from "../lib/rate-limiter.server";
import { CORS_HEADERS } from "../lib/storefront-api.server";

// Practical shapes, not RFC exhaustiveness: something@something.tld.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Phone after stripping separators: optional +, 7-15 digits (E.164 range).
const PHONE_RE = /^\+?\d{7,15}$/;

const MAX_ANSWERS = 40;

/**
 * Quiz lead capture (migration 067). The widget's lead step posts an email
 * and/or phone plus a [{question, answer}] snapshot of the shopper's quiz
 * answers. Same shop verification / anti-spoofing posture as the other
 * storefront endpoints; per-IP and per-shop rate limits keep spam bounded.
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
  if (!shopDomain) {
    return json({ error: "Missing shopDomain" }, { status: 400, headers: CORS_HEADERS });
  }

  // ---- Contact validation (before any DB work) ----
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const email = rawEmail && rawEmail.length <= 254 && EMAIL_RE.test(rawEmail) ? rawEmail : null;
  if (rawEmail && !email) {
    return json({ error: "That email doesn't look right." }, { status: 400, headers: CORS_HEADERS });
  }
  const rawPhone = typeof body.phone === "string" ? body.phone.replace(/[\s().-]/g, "") : "";
  const phone = rawPhone && PHONE_RE.test(rawPhone) ? rawPhone : null;
  if (rawPhone && !phone) {
    return json({ error: "That phone number doesn't look right." }, { status: 400, headers: CORS_HEADERS });
  }
  if (!email && !phone) {
    return json({ error: "Enter an email or phone number." }, { status: 400, headers: CORS_HEADERS });
  }

  // Rate limit BEFORE any DB work so an over-limit caller can't use this
  // endpoint as a free query amplifier. The per-shop key uses the claimed
  // domain string — verification happens below, and a spoofed claim only
  // burns the attacker's own IP budget alongside it.
  const clientIP = getClientIP(request);
  const rate = checkRateLimits([
    {
      key: `quiz-lead:ip:${clientIP}:minute`,
      limit: RATE_LIMITS.QUIZ_LEAD_PER_IP_MINUTE.limit,
      windowMs: RATE_LIMITS.QUIZ_LEAD_PER_IP_MINUTE.windowMs,
    },
    {
      key: `quiz-lead:shop:${shopDomain.toLowerCase()}:hour`,
      limit: RATE_LIMITS.QUIZ_LEAD_PER_SHOP_HOUR.limit,
      windowMs: RATE_LIMITS.QUIZ_LEAD_PER_SHOP_HOUR.windowMs,
    },
  ]);
  if (!rate.allowed) {
    return json(
      { error: "Too many requests — please try again shortly." },
      {
        status: 429,
        headers: { ...CORS_HEADERS, "Retry-After": String(rate.retryAfterSeconds ?? 30) },
      }
    );
  }

  const verifiedShop = await findShopByDomain(shopDomain);
  if (!verifiedShop) {
    return json({ error: "Unknown shop" }, { status: 403, headers: CORS_HEADERS });
  }

  // Anti-spoofing (same policy as track-event): an Origin that RESOLVES to a
  // different shop than the body claims is a spoofed submission — accept
  // opaquely, store nothing. Unknown origins (custom domains never added to
  // alternate_domains) keep the verified body claim.
  const origin = request.headers.get("Origin") ?? request.headers.get("Referer");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      originHost = null;
    }
    if (originHost && originHost !== shopDomain.toLowerCase()) {
      const originShop = await findShopByDomain(originHost);
      if (originShop && originShop.shop_domain !== verifiedShop.shop_domain) {
        return json({ success: true }, { headers: CORS_HEADERS });
      }
    }
  }

  const hasAccess = await shopHasValidAccess(verifiedShop.shop_domain);
  if (!hasAccess) {
    return json({ error: "Subscription inactive" }, { status: 403, headers: CORS_HEADERS });
  }

  // The merchant may have turned the step off after this shopper loaded the
  // (60s-cached) config — accept without storing rather than erroring at a
  // shopper who did nothing wrong.
  const config = await getChatAssistantConfig(verifiedShop.shop_domain);
  if (!config.quiz_lead_enabled) {
    return json({ success: true }, { headers: CORS_HEADERS });
  }

  // ---- Answers snapshot: bounded, strings only ----
  const answers: QuizLeadAnswer[] = Array.isArray(body.answers)
    ? body.answers
        .filter((a: any) => a && typeof a.question === "string" && typeof a.answer === "string")
        .slice(0, MAX_ANSWERS)
        .map((a: any) => ({
          question: a.question.slice(0, 300),
          answer: a.answer.slice(0, 500),
        }))
    : [];

  // Cart token: same acceptance rule as track-event.
  let cartToken: string | null = null;
  if (typeof body.cartToken === "string") {
    const trimmed = body.cartToken.trim();
    if (/^[a-zA-Z0-9-_]+$/.test(trimmed) && trimmed.length <= 64) cartToken = trimmed;
  }
  const deviceType =
    body.deviceType === "mobile" || body.deviceType === "desktop" ? body.deviceType : null;

  const result = await saveQuizLead(verifiedShop.id, {
    email,
    phone,
    answers,
    cartToken,
    deviceType,
  });
  if (!result.ok) {
    console.error(`quiz-lead: save failed for ${verifiedShop.shop_domain}:`, result.error);
    return json({ error: "Could not save — please try again." }, { status: 500, headers: CORS_HEADERS });
  }

  // Discount reveal (migration 077): the code is disclosed ONLY here, after
  // a stored lead — never in the public cached quiz-config GET, where any
  // scraper could read it without giving an email.
  if (config.quiz_lead_discount_code) {
    return json(
      {
        success: true,
        discountCode: config.quiz_lead_discount_code,
        discountMessage: config.quiz_lead_discount_message.replace(
          /\{assistant_name\}/g,
          config.assistant_name
        ),
      },
      { headers: CORS_HEADERS }
    );
  }

  return json({ success: true }, { headers: CORS_HEADERS });
};

// CORS preflight can arrive as GET-adjacent loader traffic in Remix.
export const loader = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
