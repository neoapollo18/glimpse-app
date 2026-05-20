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
 * @returns Object with allowed status, remaining requests, and reset time
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // Window expired or no entry - start fresh
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  // Within window - check if limit exceeded
  if (entry.count >= limit) {
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
  entry.count++;
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
    retryAfterSeconds: 0,
  };
}

/**
 * Get client IP address from request headers
 * Handles proxied requests (x-forwarded-for) common in cloud deployments
 */
export function getClientIP(request: Request): string {
  // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
  // The first one is the original client
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIP = forwardedFor.split(',')[0].trim();
    if (firstIP) return firstIP;
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
  // Analyze-skin API - vision LLM call, more expensive than transform per call
  // but feature is gated to allowlisted shops so volume is bounded. Stricter
  // per-IP limits to discourage casual abuse on the public endpoint.
  ANALYZE_SKIN_PER_IP_MINUTE: {
    limit: 5,
    windowMs: 60 * 1000,
  },
  ANALYZE_SKIN_PER_IP_HOUR: {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  },
  ANALYZE_SKIN_PER_SHOP_HOUR: {
    limit: 200,
    windowMs: 60 * 60 * 1000,
  },
  // Project-skin API — runs 2× Gemini image generations per call (one per
  // projection), so each request costs roughly 2× a try-on transform. Same
  // gating chain as analyze-skin but tighter ceilings to keep cost bounded.
  PROJECT_SKIN_PER_IP_MINUTE: {
    limit: 3,
    windowMs: 60 * 1000,
  },
  PROJECT_SKIN_PER_IP_HOUR: {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  },
  PROJECT_SKIN_PER_SHOP_HOUR: {
    limit: 100,
    windowMs: 60 * 60 * 1000,
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
}

export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Start cleanup on module load
startCleanupInterval();
