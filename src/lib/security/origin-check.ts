// Defense-in-depth CSRF check for state-changing API routes called via
// client-side fetch() (not Server Actions, which Next.js already protects
// with its own built-in origin check). SameSite=Lax cookies already stop
// cross-site fetch() from carrying the session cookie in modern browsers;
// this is a second, explicit layer for routes that debit credits, move
// money, or trigger real-world side effects.

export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  // No Origin header at all (some same-origin requests, non-browser
  // clients) — nothing to compare against, so don't block on it alone;
  // this check is a supplement to cookie SameSite behavior, not the only
  // line of defense.
  if (!origin) return true;

  if (!siteUrl) return false;

  try {
    return new URL(origin).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}
