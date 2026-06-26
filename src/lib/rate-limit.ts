import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Not suitable for multi-instance deployments — for production with
 * multiple replicas, swap the Map for a Redis-backed store.
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

// Periodically purge expired entries to prevent unbounded memory growth.
const PURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastPurge = Date.now();

function purgeExpired(windowMs: number) {
  const now = Date.now();
  if (now - lastPurge < PURGE_INTERVAL_MS) return;
  lastPurge = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check whether a request should be allowed under the given rate limit.
 * Records the request timestamp if allowed.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  purgeExpired(config.windowMs);
  const now = Date.now();
  const cutoff = now - config.windowMs;

  const entry = store.get(key);
  if (entry) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  }

  const currentCount = entry?.timestamps.length ?? 0;

  if (currentCount >= config.maxRequests) {
    const oldest = entry!.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + config.windowMs,
    };
  }

  if (!entry) {
    store.set(key, { timestamps: [now] });
  } else {
    entry.timestamps.push(now);
  }

  return {
    allowed: true,
    remaining: config.maxRequests - currentCount - 1,
    resetAt: now + config.windowMs,
  };
}

/**
 * Extracts a rate-limit key from the request: prefers the authenticated
 * user ID, falls back to the client IP.
 *
 * NOTE: x-forwarded-for can be spoofed by the client. In production behind
 * a trusted reverse proxy (e.g. Vercel), the proxy overwrites the header
 * so the first entry is the real client IP. If running without a trusted
 * proxy, consider combining this with an authenticated user ID.
 */
export function getRateLimitKey(
  request: NextRequest,
  userId?: string
): string {
  if (userId) return `user:${userId}`;
  // x-forwarded-for: "client, proxy1, proxy2" — the first entry is the
  // original client. Subsequent entries are proxies and are not trustworthy.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) {
    const trimmed = xri.trim();
    if (trimmed) return `ip:${trimmed}`;
  }
  return "ip:anonymous";
}

/**
 * Convenience wrapper: checks the rate limit and returns a 429 response
 * if the limit is exceeded. Returns null if the request is allowed.
 */
export function enforceRateLimit(
  request: NextRequest,
  key: string,
  config: RateLimitConfig
): NextResponse | null {
  const result = checkRateLimit(key, config);
  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      {
        error: "Rate limit exceeded. Please slow down and try again shortly.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(retryAfter, 1)),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.resetAt),
        },
      }
    );
  }
  return null;
}

// Pre-configured limits for common AI endpoint categories.
export const RATE_LIMITS = {
  /** Heavy AI operations: ingestion, comparison, review (costly, infrequent). */
  heavy: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 per minute
  /** Lighter AI operations: Q&A, node explanation (frequent, cheaper). */
  light: { maxRequests: 30, windowMs: 60 * 1000 }, // 30 per minute
  /**
   * Read-only status polling (e.g. job status checks). The KG pipeline
   * itself takes 1-2 minutes, during which the client polls every 3s;
   * a strict 30/min cap would throttle the poll loop and surface as
   * "Job poll failed (429)" right when the user is most likely to be
   * watching the import page.
   */
  polling: { maxRequests: 120, windowMs: 60 * 1000 }, // 120 per minute
} as const;
