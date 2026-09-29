import { readFileSync } from "node:fs";
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
    // The guard is a single `if (!data?.claims && !isPublic)`, so anything in
    // either list is exempt. A second, narrower check would be a bug.
    expect(source).toMatch(/if \(!data\?\.claims && !isPublic\)/);
  });
});
