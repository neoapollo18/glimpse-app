/**
 * SSRF-safe fetch for server-side URL fetching.
 * Blocks private/internal IPs and non-HTTP protocols.
 */

import { lookup } from "node:dns/promises";

const PRIVATE_IP_PATTERNS = [
  /^127\./,                    // Loopback
  /^10\./,                     // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,               // Class C private
  /^169\.254\./,               // Link-local / AWS metadata
  /^0\./,                      // "This" network
  /^::1$/,                     // IPv6 loopback
  /^fc00:/i,                   // IPv6 unique local
  /^fd/i,                      // IPv6 unique local
  /^fe80:/i,                   // IPv6 link-local
];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.google",
];

/**
 * Validates that a URL is safe to fetch (public HTTPS/HTTP, no private IPs).
 * Returns null if unsafe, or the validated URL string if safe.
 */
export function validatePublicUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block known internal hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return null;
    }

    // Block private IP ranges
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return null;
      }
    }

    // Block IPs encoded as decimal/octal/hex (e.g., 0x7f000001 = 127.0.0.1)
    // If hostname is purely numeric (no dots, no letters except hex), block it
    if (/^[0-9]+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

// The hostname-string check above can be bypassed by a public DNS name that
// RESOLVES to a private address. Resolve every address for the hostname and
// reject if any lands in a private/reserved range (IPv4-mapped IPv6 like
// ::ffff:127.0.0.1 is normalized to its v4 form first).
function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function resolvesToPublicAddresses(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    // NXDOMAIN etc. — nothing safe to fetch anyway.
    return false;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

/**
 * Fetch a URL with SSRF protection and timeout.
 * Redirects are followed manually (up to 3 hops) with the hostname-string
 * AND DNS checks re-run on every hop, so neither a 302 to an internal
 * address nor a public name resolving to a private IP gets fetched.
 * Returns the Response, or null if the URL is blocked or fetch fails.
 */
export async function safeFetch(
  url: string,
  timeoutMs: number = 10000
): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const validatedUrl = validatePublicUrl(currentUrl);
      if (!validatedUrl) {
        console.warn("Blocked SSRF attempt or invalid URL:", currentUrl);
        return null;
      }
      if (!(await resolvesToPublicAddresses(new URL(validatedUrl).hostname))) {
        console.warn("Blocked URL resolving to private address:", currentUrl);
        return null;
      }

      const response = await fetch(validatedUrl, {
        signal: controller.signal,
        redirect: "manual",
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) {
          console.warn("Blocked redirect (missing Location or too many hops):", currentUrl);
          return null;
        }
        currentUrl = new URL(location, validatedUrl).toString();
        continue;
      }

      return response;
    }
    return null;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("Fetch timed out for URL:", url);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
