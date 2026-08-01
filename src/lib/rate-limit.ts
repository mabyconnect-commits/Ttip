import { ApiError } from "./api";

/**
 * A small fixed-window rate limiter.
 *
 * This is an in-process limiter: on a single long-running server it is exact,
 * and on serverless (Vercel) it applies per warm instance — best-effort but
 * still a meaningful brake on credential-stuffing and PIN brute-force. For a
 * hard, cluster-wide guarantee, swap the `hits` map below for a shared store
 * (Upstash/Redis) keeping the same `check()` signature.
 */

interface Window {
  count: number;
  resetAt: number;
}

const hits = new Map<string, Window>();

// Opportunistic cleanup so the map can't grow without bound.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of hits) {
    if (w.resetAt <= now) hits.delete(key);
  }
}

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Throws a 429 ApiError when `key` exceeds `limit` within `windowMs`.
 * Call once at the top of a sensitive route.
 */
export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): void {
  const now = Date.now();
  sweep(now);

  const existing = hits.get(key);
  if (!existing || existing.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > limit) {
    const retrySec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw new ApiError(`Too many attempts. Try again in ${retrySec}s.`, 429);
  }
}

/** Best-effort client identifier from proxy headers, falling back to a constant. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
