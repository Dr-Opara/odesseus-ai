// Best-effort, single-instance in-memory rate limiter. Serverless functions
// are not guaranteed to stay warm or share state across instances/regions,
// so this does not provide hard guarantees under distributed load -- it
// only slows down a single warm instance being hammered. A real deployment
// should back this with Upstash Redis (@upstash/ratelimit) or similar; no
// such store is configured in this environment, so this is the safety net
// available without fabricating a credential.

const buckets = new Map<string, { count: number; resetAt: number }>();

const MAX_BUCKETS = 5000;

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
