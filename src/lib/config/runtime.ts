/**
 * Shared production-runtime check. Extracted from the duplicated
 * `VERCEL_ENV`/`NODE_ENV` guard already used by
 * `src/app/api/health/config/route.ts` and `src/app/auth/config-check/route.ts`
 * — no new gating philosophy, just one place to read it from.
 *
 * Used to gate development-only fixtures: anything behind
 * `!isProductionRuntime()` must never be reachable in production.
 */
export function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}
