/**
 * SSRF-safe fetch for server-side URL fetching.
 * Blocks private/internal IPs and non-HTTP protocols.
 */

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

/**
 * Fetch a URL with SSRF protection and timeout.
 * Returns the Response, or null if the URL is blocked or fetch fails.
 */
export async function safeFetch(
  url: string,
  timeoutMs: number = 10000
): Promise<Response | null> {
  const validatedUrl = validatePublicUrl(url);
  if (!validatedUrl) {
    console.warn("Blocked SSRF attempt or invalid URL:", url);
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(validatedUrl, { signal: controller.signal });
    return response;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("Fetch timed out for URL:", url);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
