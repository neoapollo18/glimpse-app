/**
 * SSRF-safe fetch for server-side URL fetching.
 * Blocks private/internal IPs and non-HTTP protocols.
 */

import { lookup } from "node:dns/promises";
import { fetch as undiciFetch } from "undici";

// Fetches to merchant- or attacker-chosen hosts go through undici directly.
// Under remix-serve the global fetch is @remix-run/web-fetch, which parses a
// redirect's Location inside a socket event handler: a malformed one
// ("http://[") throws there, uncaught, and takes the whole process down for
// every shop (reproduced 2026-10-16). undici hands the 3xx back untouched and
// the redirect loops below parse Location inside their own try.
const outboundFetch = undiciFetch as unknown as typeof fetch;

const PRIVATE_IP_PATTERNS = [
  /^127\./,                    // Loopback
  /^10\./,                     // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,               // Class C private
  /^169\.254\./,               // Link-local / AWS metadata
  /^0\./,                      // "This" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // Carrier-grade NAT (100.64.0.0/10)
  /^192\.0\.0\./,              // IETF protocol assignments
  /^198\.1[89]\./,             // Benchmarking (198.18.0.0/15)
  /^(22[4-9]|2[3-5]\d)\./,     // Multicast + reserved (224.0.0.0/3)
  /^::1$/,                     // IPv6 loopback
  /^::$/,                      // IPv6 unspecified (connects to local services on Linux)
  /^f[cd][0-9a-f]{2}:/i,       // IPv6 unique local (fc00::/7)
  /^fe[89ab][0-9a-f]:/i,       // IPv6 link-local (fe80::/10)
];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.google",
];

/**
 * Validates that a URL is safe to fetch (public HTTPS/HTTP, no private IPs).
 * Returns null if unsafe, or the validated URL string if safe.
 * The host is only checked as written (IP literals, known internal names):
 * pair it with resolvesToPublicAddresses, as safeFetch and
 * boundedPublicFetch do, to catch names that resolve to a private address.
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

    // Block private IP literals. The URL parser rewrites every numeric host
    // form (2130706433, 0x7f000001, 10.1) to a dotted quad and keeps IPv6 in
    // brackets, so only those two shapes are addresses. Testing the patterns
    // against ordinary names would also block a store like "fd-beauty";
    // names that RESOLVE to a private IP are caught by the DNS check.
    const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
      ? hostname
      : hostname.startsWith("[") ? hostname.slice(1, -1) : null;
    if (ipLiteral !== null && isPrivateAddress(ipLiteral)) {
      return null;
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
// ::ffff:127.0.0.1, or its hex spelling ::ffff:7f00:1, is normalized to its
// v4 form first).
function isPrivateAddress(address: string): boolean {
  let normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice("::ffff:".length);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      normalized = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    }
  }
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

      const response = await outboundFetch(validatedUrl, {
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

const BOUNDED_MAX_REDIRECTS = 5;

export interface BoundedFetchResult {
  /** Final URL after redirects (what Response.url reports with redirect: "follow"). */
  url: string;
  status: number;
  body: Buffer;
}

/**
 * GET a public URL whose body the server parses (brand profile and brand
 * library homepage and image fetches). Same per-hop hostname AND DNS checks
 * as safeFetch, but up to 5 redirects: myshopify.com -> primary domain ->
 * www -> market subfolder already takes 3. Unlike safeFetch it reads the
 * body itself, so ONE timeout covers headers and body, and the body is
 * streamed against maxBytes: past it the download is cancelled and the call
 * fails, or with `truncate` keeps the first maxBytes. With `httpsOnly`
 * every hop must be https, so a name that rebinds to a private address
 * between the DNS check and the connect fails TLS unless that address
 * serves a certificate valid for the name. null when the URL is blocked,
 * the answer is not 2xx, the timeout fires, or the body is too big.
 */
export async function boundedPublicFetch(
  url: string,
  opts: {
    timeoutMs: number;
    maxBytes: number;
    truncate?: boolean;
    httpsOnly?: boolean;
    headers?: Record<string, string>;
  }
): Promise<BoundedFetchResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= BOUNDED_MAX_REDIRECTS; hop++) {
      const validatedUrl = validatePublicUrl(currentUrl);
      if (!validatedUrl || (opts.httpsOnly && new URL(validatedUrl).protocol !== "https:")) {
        console.warn("Blocked SSRF attempt or invalid URL:", currentUrl);
        return null;
      }
      if (!(await resolvesToPublicAddresses(new URL(validatedUrl).hostname))) {
        console.warn("Blocked URL resolving to private address:", currentUrl);
        return null;
      }

      const response = await outboundFetch(validatedUrl, {
        signal: controller.signal,
        headers: opts.headers,
        redirect: "manual",
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        discardBody(response);
        const location = response.headers.get("location");
        if (!location || hop === BOUNDED_MAX_REDIRECTS) return null;
        currentUrl = new URL(location, validatedUrl).toString();
        continue;
      }
      if (!response.ok) {
        discardBody(response);
        return null;
      }

      const read = await readBodyCapped(response, opts.maxBytes);
      if (read.truncated && !opts.truncate) return null;
      return { url: validatedUrl, status: response.status, body: read.bytes };
    }
    return null;
  } catch {
    // Network error, or the timeout aborted the request or the body read.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {});
}

// Stream the body and stop at maxBytes, so a host that answers with an
// endless body costs one chunk past the cap instead of all of memory.
async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<{ bytes: Buffer; truncated: boolean }> {
  if (!response.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: Buffer.concat(chunks, total), truncated: false };
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      reader.cancel().catch(() => {});
      return { bytes: Buffer.concat(chunks, maxBytes), truncated: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
}
