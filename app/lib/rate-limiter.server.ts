/**
 * In-memory rate limiter for API protection
 * 
 * Features:
 * - Per-key rate limiting (IP, shop, etc.)
 * - Sliding window algorithm
 * - Jitter to prevent thundering herd on retry
 * - Automatic cleanup of expired entries
 * - No external dependencies
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

// In-memory store for rate limit entries
const store = new Map<string, RateLimitEntry>();

/**
 * Add random jitter to a value (±25% by default)
 * Prevents thundering herd when multiple clients retry simultaneously
 */
function addJitter(value: number, jitterPercent: number = 0.25): number {
  const jitterRange = value * jitterPercent;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random between -jitterRange and +jitterRange
  return Math.max(1, Math.round(value + jitter));
}

/**
 * Check if a request is within rate limits
 * 
 * @param key - Unique identifier for the rate limit (e.g., "ip:192.168.1.1" or "shop:mystore.myshopify.com")
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @param cost - Hits this request consumes (default 1). Multi-variant
 *   transforms pass the variant count so one request can't hide N paid
 *   generations behind a single hit.
 * @returns Object with allowed status, remaining requests, and reset time
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  cost: number = 1
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // Window expired or no entry - start fresh
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: cost, resetAt });
    return {
      allowed: cost <= limit,
      remaining: Math.max(0, limit - cost),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  // Within window - check if limit exceeded
  if (entry.count + cost > limit) {
    const baseRetrySeconds = Math.ceil((entry.resetAt - now) / 1000);
    // Add jitter to prevent all rate-limited clients from retrying at the exact same time
    const retryAfterSeconds = addJitter(baseRetrySeconds);
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterSeconds,
    };
  }

  // Within limit - increment and allow
  entry.count += cost;
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
    retryAfterSeconds: 0,
  };
}

export interface RateLimitCheck {
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
}

/**
 * Check multiple windows together, consuming quota ONLY when every window
 * allows the request. Calling checkRateLimit per window unconditionally
 * burns the sibling window's quota even when one window blocks (e.g. a
 * merchant retrying while hourly-blocked drains their daily allowance with
 * zero work done). Returns the first blocking window's result when denied,
 * otherwise the tightest (lowest-remaining) allowed result.
 */
export function checkRateLimits(checks: RateLimitCheck[]): RateLimitResult {
  const now = Date.now();

  // Pass 1: peek every window without consuming.
  for (const { key, limit, windowMs, cost = 1 } of checks) {
    const entry = store.get(key);
    const active = entry !== undefined && now <= entry.resetAt;
    const count = active ? entry.count : 0;
    if (count + cost > limit) {
      const resetAt = active ? entry.resetAt : now + windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds: addJitter(Math.max(1, Math.ceil((resetAt - now) / 1000))),
      };
    }
  }

  // Pass 2: all windows allow — consume each, report the tightest.
  let tightest: RateLimitResult = {
    allowed: true,
    remaining: Number.MAX_SAFE_INTEGER,
    resetAt: now,
    retryAfterSeconds: 0,
  };
  for (const { key, limit, windowMs, cost = 1 } of checks) {
    const result = checkRateLimit(key, limit, windowMs, cost);
    if (result.remaining < tightest.remaining) tightest = result;
  }
  return tightest;
}

/**
 * Get client IP address from request headers
 * Handles proxied requests (x-forwarded-for) common in cloud deployments
 */
export function getClientIP(request: Request): string {
  // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2".
  // Take the RIGHTMOST entry: the app runs behind Render's proxy, which
  // APPENDS the connecting client's real IP to whatever the client sent.
  // Any earlier entries are attacker-controlled — keying on the first one
  // let callers mint a fresh rate-limit bucket per request by rotating a
  // fake X-Forwarded-For value.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',');
    const lastIP = parts[parts.length - 1].trim();
    if (lastIP) return lastIP;
  }

  // Fallback headers used by various proxies
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  // If no proxy headers, we can't determine the IP
  // Return a fallback that still provides some protection
  return 'unknown';
}

/**
 * Clean up expired entries to prevent memory leaks
 * Call this periodically (e.g., every 5 minutes)
 */
export function cleanupExpiredEntries(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get current store size (for monitoring)
 */
export function getRateLimitStoreSize(): number {
  return store.size;
}

// ============================================
// RATE LIMIT CONFIGURATIONS
// ============================================

// Transform image API - expensive (costs money)
export const RATE_LIMITS = {
  // Per IP limits for transform endpoint
  TRANSFORM_PER_IP_MINUTE: {
    limit: 20,
    windowMs: 60 * 1000, // 1 minute
  },
  TRANSFORM_PER_IP_HOUR: {
    limit: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Per shop limit for transform endpoint
  TRANSFORM_PER_SHOP_HOUR: {
    limit: 1000,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Track event API - lightweight (just DB writes)
  TRACK_PER_IP_MINUTE: {
    limit: 100,
    windowMs: 60 * 1000, // 1 minute
  },
  // Quiz lead capture — cheap DB write, but each row is merchant-visible
  // (analytics/export), so keep spam bounded per IP and per shop.
  QUIZ_LEAD_PER_IP_MINUTE: {
    limit: 5,
    windowMs: 60 * 1000,
  },
  QUIZ_LEAD_PER_SHOP_HOUR: {
    limit: 500,
    windowMs: 60 * 60 * 1000,
  },
  // Analyze-skin API - vision LLM call, more expensive than transform per call
  // but feature is gated to allowlisted shops so volume is bounded. Stricter
  // per-IP limits to discourage casual abuse on the public endpoint.
  // NOTE: limits raised for conference booth use. At a venue, every attendee
  // shares one public IP (NAT) — or a single kiosk device is the only client —
  // so the original per-IP caps (5/min, 20/hr) locked out the whole booth.
  // Revert to 5 / 20 / 200 after the event if cost becomes a concern.
  ANALYZE_SKIN_PER_IP_MINUTE: {
    limit: 60,
    windowMs: 60 * 1000,
  },
  ANALYZE_SKIN_PER_IP_HOUR: {
    limit: 1000,
    windowMs: 60 * 60 * 1000,
  },
  ANALYZE_SKIN_PER_SHOP_HOUR: {
    limit: 3000,
    windowMs: 60 * 60 * 1000,
  },
  // Project-skin API — runs 2× Gemini image generations per call (one per
  // projection), so each request costs roughly 2× a try-on transform. Same
  // gating chain as analyze-skin but tighter ceilings to keep cost bounded.
  // Also raised for the conference (shared IP / kiosk). Kept lower than
  // analyze-skin because each call = 2× Gemini image generations ($$). If
  // cost runs hot at the booth, drop these or disable the projections row.
  PROJECT_SKIN_PER_IP_MINUTE: {
    limit: 40,
    windowMs: 60 * 1000,
  },
  PROJECT_SKIN_PER_IP_HOUR: {
    limit: 500,
    windowMs: 60 * 60 * 1000,
  },
  PROJECT_SKIN_PER_SHOP_HOUR: {
    limit: 1500,
    windowMs: 60 * 60 * 1000,
  },
  // AI quiz creator (Claude, admin-authenticated). Generation is the
  // expensive call (~$0.50); copilot messages are cheap (~$0.10) thanks to
  // prompt caching. Keys are per shop, not per IP — these endpoints sit
  // behind authenticate.admin.
  QUIZ_GENERATE_PER_SHOP_HOUR: {
    limit: 4,
    windowMs: 60 * 60 * 1000,
  },
  QUIZ_GENERATE_PER_SHOP_DAY: {
    limit: 10,
    windowMs: 24 * 60 * 60 * 1000,
  },
  QUIZ_COPILOT_PER_SHOP_MINUTE: {
    limit: 10,
    windowMs: 60 * 1000,
  },
  QUIZ_COPILOT_PER_SHOP_DAY: {
    limit: 200,
    windowMs: 24 * 60 * 60 * 1000,
  },
  // Recommendation-logic guidance compiler (Claude, admin-authenticated).
  // Roughly quiz-generation cost per call; merchants iterate a few times
  // while tuning their notes, so slightly looser than QUIZ_GENERATE.
  GUIDANCE_GENERATE_PER_SHOP_HOUR: {
    limit: 6,
    windowMs: 60 * 60 * 1000,
  },
  GUIDANCE_GENERATE_PER_SHOP_DAY: {
    limit: 20,
    windowMs: 24 * 60 * 60 * 1000,
  },
} as const;

// ============================================
// AUTO-CLEANUP
// ============================================

// Clean up expired entries every 5 minutes
// This runs in the background to prevent memory buildup
let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupInterval(): void {
  if (cleanupInterval) return; // Already running
  
  cleanupInterval = setInterval(() => {
    const cleaned = cleanupExpiredEntries();
    if (cleaned > 0) {
      console.log(`[RateLimiter] Cleaned up ${cleaned} expired entries. Store size: ${store.size}`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Housekeeping only — never keep the event loop alive for it, so the
  // process can exit cleanly on shutdown. Optional chaining: Node returns a
  // Timeout with unref(), but browser-typed environments return a number.
  cleanupInterval.unref?.();
}

export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Start cleanup on module load
startCleanupInterval();
