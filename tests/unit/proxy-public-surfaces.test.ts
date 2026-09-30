import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Which surfaces the proxy lets past without a session.
 *
 * The proxy redirects any unmatched, unauthenticated request to `/login`. That
 * makes a mistake here invisible in every other test -- a route can be fully
 * implemented, fully unit-tested, and still be entirely unreachable in a
 * browser. Guest Live was exactly that: every guest page and every guest API
 * call redirected to `/login`, so the product did not work at all.
 *
 * So the list is asserted directly, in both directions. Adding a path here
 * widens the unauthenticated surface and must be a deliberate act; a path that
 * is *not* here and is meant to be public is a product that cannot be opened.
 *
 * Source-reading on purpose: the proxy's behaviour is a property of its
 * configuration, and reading the list is the only way to see it without
 * standing up a server.
 */

const ROOT = join(__dirname, "..", "..");
const source = readFileSync(join(ROOT, "src/lib/supabase/proxy.ts"), "utf8");

/** The public prefix list, parsed out of the module. */
function publicPrefixes(): string[] {
  const block = source.match(/const publicPrefixPaths = \[([\s\S]*?)\]/);
  if (!block) throw new Error("publicPrefixPaths not found in the proxy");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The public exact-match list, parsed out of the module. */
function publicExactPaths(): string[] {
  const block = source.match(/const publicExactPaths = \[([\s\S]*?)\]/);
  if (!block) throw new Error("publicExactPaths not found in the proxy");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The machine-to-machine list, parsed out of the module.
 *
 * Kept separate from the public list in the source on purpose, so it is parsed
 * separately here: if the two are ever merged, the difference stops being
 * visible in the tests as well as in the code.
 */
function machinePrefixes(): string[] {
  const block = source.match(/const machineApiPrefixPaths = \[([\s\S]*?)\]/);
  if (!block) throw new Error("machineApiPrefixPaths not found in the proxy");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Mirrors the proxy's own prefix test: `pathname.startsWith(prefix + "/")`. */
function isPublicPrefix(pathname: string): boolean {
  return publicPrefixes().some((p) => pathname.startsWith(p + "/"));
}

describe("proxy public prefixes", () => {
  it("lets a guest open their link without an account", () => {
    // A guest has no account, no session, and no way to get one. If either of
    // these is not public, the product is unreachable rather than restricted.
    expect(isPublicPrefix("/guest-live/abc123")).toBe(true);
    expect(isPublicPrefix("/guest-live/abc123/analysis")).toBe(true);
  });

  it("lets a guest call their own token-scoped API without an account", () => {
    expect(isPublicPrefix("/api/live/guest-access/abc123")).toBe(true);
    expect(isPublicPrefix("/api/live/guest-access/abc123/setup")).toBe(true);
    expect(isPublicPrefix("/api/live/guest-access/abc123/session")).toBe(true);
    expect(isPublicPrefix("/api/live/guest-access/abc123/session/transcript")).toBe(true);
  });

  it("keeps minting a link behind a session", () => {
    // The owner side is not public. Anyone could otherwise mint a link on
    // someone else's plan.
    expect(isPublicPrefix("/api/live/guest-links")).toBe(false);
  });

  it("keeps the Live entitlement read behind a session", () => {
    // It reports another user's plan and guest relationships.
    expect(isPublicPrefix("/api/live/entitlement")).toBe(false);
  });

  it("does not expose the applicant's Live routes", () => {
    for (const path of [
      "/api/interviews/abc/live/prepare",
      "/api/interviews/abc/live/activate",
      "/api/interviews/abc/live/transcript",
      "/api/interviews/abc/live/webrtc",
      "/api/interviews/abc/live/end",
    ]) {
      expect(isPublicPrefix(path), path).toBe(false);
    }
  });

  it("does not expose the owner-only guest administration routes", () => {
    for (const path of [
      "/api/live/guests",
      "/api/live/guests/accept",
      "/api/live/guests/invite/abc",
    ]) {
      expect(isPublicPrefix(path), path).toBe(false);
    }
  });

  it("widens nothing under /api beyond what is listed", () => {
    // A bare "/api/live" entry would be catastrophic; the prefix must stay
    // specific enough that only the token-scoped guest routes are open.
    expect(publicPrefixes()).not.toContain("/api");
    expect(publicPrefixes()).not.toContain("/api/live");
  });

  it("keeps the existing public surfaces public", () => {
    // A refactor of the list must not quietly close a surface that works today.
    for (const path of ["/auth/callback", "/api/partners/apply", "/api/referrals/x"]) {
      expect(isPublicPrefix(path), path).toBe(true);
    }
    for (const path of ["/", "/pricing", "/login", "/robots.txt"]) {
      expect(publicExactPaths(), path).toContain(path);
    }
  });
});

describe("proxy redirects", () => {
  it("sends an unauthenticated applicant somewhere that demands a session", () => {
    expect(source).toContain('url.pathname = effectivePathname.startsWith("/employers/")');
    // The candidate fallback.
    expect(source).toContain('"/login"');
  });

  it("never redirects a public surface", () => {
    // The guard is a single `if`, so anything in any of the three lists is
    // exempt. A second, narrower check would be a bug.
    expect(source).toMatch(
      /if \(!data\?\.claims && !isPublic && !isMachineApi\)/
    );
  });
});

describe("machine-to-machine API paths", () => {
  /**
   * Scheduled and provider-originated calls have no Supabase session, by
   * design. The proxy redirecting them to `/login` meant every one of them was
   * unreachable, which is indistinguishable from broken: no wallet top-ups, no
   * subscription sync, no job discovery, no notification emails.
   *
   * They are exempt from the *session* check, not from authentication. These
   * assertions exist so that exemption can never quietly become an exemption
   * from the guard that actually protects them.
   */
  it("exempts cron and webhook prefixes from the session redirect", () => {
    expect(machinePrefixes()).toEqual(["/api/cron", "/api/webhooks"]);
  });

  it("keeps the machine list separate from the public list", () => {
    // A `publicPrefixPaths` entry means "a signed-out browser may fetch this
    // and be served". These mean "authenticated by a shared secret, not by a
    // session". Folding one into the other misdescribes it to the next reader.
    for (const prefix of machinePrefixes()) {
      expect(publicPrefixes(), prefix).not.toContain(prefix);
      expect(publicExactPaths(), prefix).not.toContain(prefix);
    }
  });

  it("does not exempt anything else", () => {
    expect(machinePrefixes()).not.toContain("/api");
    expect(machinePrefixes()).not.toContain("/api/live");
    expect(machinePrefixes()).not.toContain("/api/employer");
    expect(machinePrefixes()).not.toContain("/api/cron/../");
  });

  it("still requires the route's own shared secret or signature", () => {
    // The proxy exemption is worthless if the route behind it is not guarded.
    // Asserted on the source because this is the load-bearing pair: the proxy
    // stops judging the caller, so the route must judge it instead.
    const crons = ["job-discovery", "refresh-job-feed", "process-retry-jobs",
                   "process-notification-emails", "process-interview-reminders",
                   "expire-featured-listings"];
    for (const name of crons) {
      const p = join(ROOT, `src/app/api/cron/${name}/route.ts`);
      const t = readFileSync(p, "utf8");
      expect(t, name).toContain("CRON_SECRET");
      // Fail-closed: an unset secret denies everyone rather than admitting all.
      expect(t, name).toMatch(/!process\.env\.CRON_SECRET/);
      expect(t, name).toMatch(/Bearer \$\{process\.env\.CRON_SECRET\}/);
    }

    const webhook = readFileSync(
      join(ROOT, "src/app/api/webhooks/stripe/route.ts"),
      "utf8"
    );
    expect(webhook).toContain("stripe-signature");
    expect(webhook).toContain("constructEvent");
    expect(webhook).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("keeps every scheduled cron reachable by the scheduler", () => {
    // A cron listed in vercel.json but blocked by the proxy never runs, and
    // nothing fails loudly -- the job simply never happens. So the two lists
    // must agree.
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const scheduled: string[] = (vercel.crons ?? []).map((c: { path: string }) => c.path);
    expect(scheduled.length).toBeGreaterThan(0);
    for (const path of scheduled) {
      const exempted = machinePrefixes().some((prefix) => path.startsWith(prefix + "/"));
      expect(exempted, `${path} is scheduled but the proxy would redirect it`).toBe(true);
      // And the route it points at must actually exist.
      const routePath = path.replace("/api/cron/", "src/app/api/cron/") + "/route.ts";
      expect(existsSync(join(ROOT, routePath)), `${path} has no route file`).toBe(true);
    }
  });
});
