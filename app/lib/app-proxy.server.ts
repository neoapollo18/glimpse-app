/**
 * App-proxy helpers (Overhaul Part 4 / D1).
 *
 * Shopify forwards storefront requests under /apps/gleame/* to this app
 * and signs every request with `signature` — hex HMAC-SHA256 over the
 * query params (minus signature), each serialized as key=value with
 * multi-values comma-joined, sorted, concatenated WITHOUT a separator,
 * keyed by the app secret. Distinct from the OAuth hmac format.
 *
 * Preview tokens are short JWTs (7-day expiry) minted for the merchant's
 * admin session; the tokenized URL is shareable with their team and
 * powers the win-back email screenshot. No token → 404 (not 401: the
 * route must not confirm it exists to scanners).
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export function verifyProxySignature(url: URL): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;
  const signature = url.searchParams.get("signature");
  if (!signature) return false;
  const byKey = new Map<string, string[]>();
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "signature") continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(v);
  }
  const message = [...byKey.entries()]
    .map(([k, vs]) => `${k}=${vs.join(",")}`)
    .sort()
    .join("");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

const PREVIEW_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Preview draft ids are plain ids ("live", uuids). The proxy route writes
 * the id into an application/liquid body, which Shopify renders as Liquid
 * before serving it on the storefront: a crafted id carrying `{{ }}` /
 * `{% %}` would be rendered into the inline script. Enforced at mint AND
 * at verify.
 */
export function isPreviewDraftId(draftId: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(draftId);
}

export function mintStorePreviewToken(shopDomain: string, draftId: string): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("preview token: SHOPIFY_API_SECRET unset");
  if (!isPreviewDraftId(draftId)) throw new Error("preview token: invalid draft id");
  return jwt.sign(
    { purpose: "store-preview", shopDomain, draftId },
    secret,
    { algorithm: "HS256", expiresIn: PREVIEW_TTL_SECONDS }
  );
}

export function verifyStorePreviewToken(
  token: string,
  expectedShopDomain: string,
  expectedDraftId: string
): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !token || !isPreviewDraftId(expectedDraftId)) return false;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as Record<string, unknown>;
    return (
      decoded.purpose === "store-preview" &&
      decoded.shopDomain === expectedShopDomain &&
      decoded.draftId === expectedDraftId
    );
  } catch {
    return false;
  }
}

/** The shareable storefront preview URL for a shop's draft. */
export function storePreviewUrl(shopDomain: string, draftId: string): string {
  const token = mintStorePreviewToken(shopDomain, draftId);
  return `https://${shopDomain}/apps/gleame/preview/${encodeURIComponent(draftId)}?token=${encodeURIComponent(token)}`;
}
