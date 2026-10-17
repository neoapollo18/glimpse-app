import crypto from "crypto";

/**
 * Founders-admin auth tokens.
 *
 * The /admin pages are plain Polaris (no App Bridge), so their fetcher POSTs
 * can't carry a Shopify session token, and authenticate.admin on those POSTs
 * triggers the session-token bounce that destroys the page. Previously the
 * actions "authenticated" by trusting a ?shop= query param against this
 * allowlist — which is no authentication at all (myshopify domains are
 * public), leaving every founders mutation open to the internet.
 *
 * Instead: the loader (which DOES run authenticate.admin and the allowlist
 * check) mints a short-lived HMAC token bound to the authenticated shop.
 * The client includes it with every POST; actions verify it here. Knowing a
 * shop domain is no longer enough — you must have loaded the page through
 * real Shopify auth within the TTL.
 */

export const ADMIN_ALLOWED_SHOPS = [
  "testingaaronandevansaas.myshopify.com",
  "hx5hqt-na.myshopify.com",
];

/**
 * What a token may be used for. "actions" (the default) authorizes the
 * founders POSTs. "csv" only downloads the skin-uploads export: that link
 * carries its token in the URL, where access logs and browser history keep
 * it, so it gets a short-lived purpose of its own that can never drive a
 * mutation (and an action token can never pull the export).
 */
export type AdminTokenPurpose = "actions" | "csv";

const TOKEN_TTL_MS: Record<AdminTokenPurpose, number> = {
  actions: 12 * 60 * 60 * 1000, // 12h, outlives any admin session tab
  csv: 10 * 60 * 1000, // 10 min; the open /admin page re-mints it
};

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET is required for admin tokens");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function mintAdminToken(shop: string, purpose: AdminTokenPurpose = "actions"): string {
  const payload = Buffer.from(
    JSON.stringify({ shop, exp: Date.now() + TOKEN_TTL_MS[purpose], purpose })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the authenticated shop domain, or null if the token is missing/invalid/expired
 * or was minted for a different purpose. */
export function verifyAdminToken(
  token: string | null | undefined,
  purpose: AdminTokenPurpose = "actions"
): string | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { shop, exp, purpose: minted } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof shop !== "string" || typeof exp !== "number" || Date.now() > exp) return null;
    // Tokens minted before purposes existed carry none: those are action tokens.
    if ((minted ?? "actions") !== purpose) return null;
    if (!ADMIN_ALLOWED_SHOPS.includes(shop)) return null;
    return shop;
  } catch {
    return null;
  }
}
