/**
 * Baseline security headers for HTML document responses (entry.server.tsx).
 *
 * Content-Security-Policy stays with addDocumentResponseHeaders, which owns
 * frame-ancestors for the embedded admin. X-Frame-Options is never sent: it
 * would stop Shopify admin from framing the app.
 *
 * A header a route already set wins, so a route can still pick its own value.
 */

const HSTS = "max-age=31536000; includeSubDomains";

export function addSecurityHeaders(
  request: Request,
  headers: Headers,
  production = process.env.NODE_ENV === "production",
): void {
  setDefault(headers, "X-Content-Type-Options", "nosniff");
  setDefault(headers, "Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS pins a host to HTTPS for a year, so only our own production host
  // gets it: not dev, where it would pin localhost, and not app proxy pages,
  // which shoppers load from the merchant's storefront domain.
  if (production && !isAppProxyPath(new URL(request.url).pathname)) {
    setDefault(headers, "Strict-Transport-Security", HSTS);
  }
}

// The [app_proxy] url in shopify.app.glimpse-app.toml.
function isAppProxyPath(pathname: string): boolean {
  return pathname === "/proxy" || pathname.startsWith("/proxy/");
}

function setDefault(headers: Headers, name: string, value: string): void {
  if (!headers.has(name)) headers.set(name, value);
}
