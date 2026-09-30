import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two things the proxy must get right, checked against the route tree rather
 * than against a hand-written list that could fall behind it.
 *
 *   1. Nothing sensitive is exempt. The proxy redirects every unmatched
 *      unauthenticated request to `/login`, so the *default* is closed and the
 *      only risk is a prefix added too broadly. These tests walk every route on
 *      disk and assert that only the three known-exempt families are exempt --
 *      which means a new private route is protected by default, and a new
 *      exemption has to be a deliberate edit that shows up here.
 *
 *   2. Odesseus Live stays off public marketing. Live is a private,
 *      auth-gated product; a page any visitor can load must not name it, price
 *      it, or import it.
 */

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const proxySource = readFileSync(join(ROOT, "src/lib/supabase/proxy.ts"), "utf8");

function listOf(name: string): string[] {
  const block = proxySource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  if (!block) throw new Error(`${name} not found in the proxy`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const publicPrefixes = listOf("publicPrefixPaths");
const machinePrefixes = listOf("machineApiPrefixPaths");

/**
 * A route file -> the URL path it serves, with dynamic segments collapsed.
 *
 * The full path rather than a "family", because the two lists do not line up
 * with the directory tree: `/api/live/guest-access` is exempt while
 * `/api/live/guest-links`, `/api/live/guests` and `/api/live/entitlement` sit
 * beside it and are not. Coarsening to `/api/live` would have made the check
 * either vacuous or wrong, and this is the check that matters.
 */
function routePath(file: string): string {
  const rel = relative(join(ROOT, "src/app"), file).replace(/\\/g, "/");
  const withoutRoute = rel.replace(/\/route\.ts$/, "");
  return (
    "/" +
    withoutRoute
      .split("/")
      .map((s) => (s.startsWith("[") ? "*" : s))
      .join("/")
  );
}

/** The proxy's own rule, verbatim: `startsWith(prefix + "/")`. */
function exemptedBy(pathname: string): string[] {
  return [...publicPrefixes, ...machinePrefixes].filter((p) =>
    pathname.startsWith(p + "/")
  );
}

const apiRoutes = walk(join(ROOT, "src/app/api"))
  .filter((f) => f.endsWith("route.ts"))
  .map((f) => ({ file: f, path: routePath(f) }));

describe("no private API route is exempt from the session check", () => {
  it("every route on disk is exempted by at most one prefix", () => {
    for (const { file, path } of apiRoutes) {
      const matched = exemptedBy(path);
      // Zero is the safe answer -- the proxy redirects it. One is a deliberate
      // exemption. Two would mean overlapping prefixes, where widening either
      // silently widens the other.
      expect(matched.length, `${file} exempted by ${matched.join(", ")}`).toBeLessThanOrEqual(1);
    }
    // Sanity: the walk actually found routes.
    expect(apiRoutes.length).toBeGreaterThan(50);
  });

  it("exempts only the prefixes that are exempt on purpose", () => {
    const actuallyExempted = new Set(
      apiRoutes.flatMap(({ path }) => exemptedBy(path))
    );
    // If this list has to grow, the growth is a decision and belongs in review.
    // It currently contains: the two public application endpoints, the guest
    // token surface, and the two machine-to-machine families.
    expect([...actuallyExempted].sort()).toEqual([
      "/api/cron",
      "/api/live/guest-access",
      "/api/partners",
      "/api/referrals",
      "/api/webhooks",
    ]);
  });

  it("exempts the guest token routes and nothing else under /api/live", () => {
    // The narrow distinction the whole Guest Live design turns on: the token is
    // the credential, so the token routes are reachable. Minting a link,
    // managing guests, and reading an entitlement all need a session.
    expect(exemptedBy("/api/live/guest-access/*")).toEqual(["/api/live/guest-access"]);
    for (const ownerSide of [
      "/api/live/guest-links",
      "/api/live/guests",
      "/api/live/guests/accept",
      "/api/live/entitlement",
    ]) {
      expect(exemptedBy(ownerSide), ownerSide).toEqual([]);
    }
  });

  it("keeps the applicant and employer surfaces session-gated", () => {
    for (const sensitive of [
      "/api/employer/orgs/*/billing",
      "/api/employer/orgs/*/candidates",
      "/api/employer/orgs/*/team",
      "/api/interviews/*/workspace",
      "/api/interviews/*/live/prepare",
      "/api/wallet",
      "/api/wallet/transactions",
      "/api/account/export",
      "/api/dashboard",
      "/api/match",
      "/api/tailor",
      "/api/apply/start",
      "/api/notifications",
      "/api/follow-ups/*",
      "/api/admin/careers",
    ]) {
      expect(exemptedBy(sensitive), `${sensitive} is exempt`).toEqual([]);
    }
  });
});

describe("Odesseus Live is absent from public marketing", () => {
  const publicExact = listOf("publicExactPaths");
  const publicPages = publicExact
    .filter((p) => p !== "/robots.txt")
    .map((p) => join(ROOT, "src/app", p.replace(/^\//, ""), "page.tsx"))
    .filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });

  /**
   * Source with block and line comments removed.
   *
   * A page is allowed to *document* that it does not mention Live, and one of
   * them does exactly that in a comment. Scanning raw source would flag the
   * comment as a leak and train a reader to expect false positives, which is how
   * a real one gets waved through. What ships is the rendered text.
   */
  function code(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("finds the public pages it can read", () => {
    // If this ever drops to a handful, the scan has stopped being meaningful.
    expect(publicPages.length).toBeGreaterThan(10);
  });

  it("names no Live product and no Live price in any public page's rendered text", () => {
    for (const file of publicPages) {
      const text = code(readFileSync(file, "utf8"));
      const name = relative(ROOT, file);
      for (const pattern of [
        /Odesseus Live/,
        /Guest Live/,
        /Share Annual/,
        /Personal Annual/,
        /\$14\.99/,
        /\$19\.99/,
        /\$499/,
        /\$129/,
      ]) {
        expect(pattern.test(text), `${name} renders ${pattern}`).toBe(false);
      }
    }
  });

  it("imports no Live module on any public page", () => {
    for (const file of publicPages) {
      const text = readFileSync(file, "utf8");
      const name = relative(ROOT, file);
      for (const imported of [
        "odesseus-live-client",
        "live-entry-card",
        "guest-link-card",
        "guest-link-button",
        "mobile-live",
        "@/lib/live/",
        "billing/catalog",
        "live-entitlement",
      ]) {
        expect(text.includes(imported), `${name} imports ${imported}`).toBe(false);
      }
    }
  });

  it("does expose the guest link landing, which is not marketing", () => {
    // The one public surface that does render "Odesseus Live" -- and it is
    // reachable only with a valid token, renders nothing until the server
    // confirms it, and is noindex. Asserted so the marketing scan above is not
    // mistaken for an oversight.
    const landing = join(ROOT, "src/app/guest-live/[token]/page.tsx");
    const text = readFileSync(landing, "utf8");
    expect(text).toContain("noindex");
  });
});
