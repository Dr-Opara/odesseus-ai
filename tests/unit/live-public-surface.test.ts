import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Odesseus Live is private to signed-in applicants. The e2e suite
 * (tests/e2e/live-visibility.spec.ts) proves this against a running server,
 * but it only sees what is actually rendered — a dead component or an unused
 * export is invisible to it, and either becomes a one-import public leak.
 *
 * This is the static half of the same contract: it walks the source of every
 * public route plus the shared public chrome and fails if Live naming, Live
 * workflow copy, or the banned Live prices appear there, or if a public module
 * reaches for the auth-gated billing catalogue that holds them.
 */

/**
 * publicExactPaths in src/lib/supabase/proxy.ts, plus /employers/dashboard.
 *
 * The dashboard is session-gated rather than public, but it is audited here
 * anyway: it is a marketing-styled employer surface and an unauthenticated
 * leak there would be just as damaging. Auditing a superset of the public list
 * can only widen coverage, never narrow it. Keep the real list in sync when
 * the proxy changes — and if the lists ever need to diverge beyond that, fix
 * the proxy rather than this list.
 */
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/check-email",
  "/how-it-works",
  "/apply",
  "/live",
  "/agents",
  "/pricing",
  "/about",
  "/faq",
  "/support",
  "/terms",
  "/privacy",
  "/legal",
  "/accessibility",
  "/licenses",
  "/partners",
  "/partners/apply",
  "/partners/terms",
  "/preview/job-showcase",
  "/employers",
  "/employers/pricing",
  "/employers/login",
  "/employers/signup",
  "/employers/post-job",
  "/employers/dashboard",
] as const;

const APP_DIR = join(process.cwd(), "src", "app");
const COMPONENTS_DIR = join(process.cwd(), "src", "components");

/**
 * Tokens that must never appear in public source. "$24.99" / "$59.99" /
 * "$499" are the Live session, 3-pass and annual prices.
 */
const BANNED = ["odesseus live", "$24.99", "$59.99", "$499"] as const;

/** Live workflow vocabulary, to catch copy that renames the feature. */
const BANNED_LIVE_COPY = [
  "live interview",
  "interview pass",
  "live pass",
  "realtime guidance",
  "real-time guidance",
  "start odesseus live",
] as const;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

function publicRouteFiles(): string[] {
  const files: string[] = [];
  for (const route of PUBLIC_ROUTES) {
    // "/" is the single src/app/page.tsx, not the whole app tree.
    if (route === "/") {
      files.push(join(APP_DIR, "page.tsx"));
      continue;
    }
    const dir = join(APP_DIR, route.replace(/^\//, ""));
    // Only the route's own module tree — a nested route segment under a public
    // prefix (e.g. /employers/dashboard) is included, but siblings are not.
    files.push(...sourceFiles(dir));
  }
  return [...new Set(files)];
}

/** Shared chrome that renders on public pages regardless of route. */
const PUBLIC_CHROME = [
  join(COMPONENTS_DIR, "marketing-nav.tsx"),
  join(COMPONENTS_DIR, "marketing-footer.tsx"),
  join(COMPONENTS_DIR, "employer-nav.tsx"),
  join(COMPONENTS_DIR, "mobile", "mobile-splash.tsx"),
  join(COMPONENTS_DIR, "mobile", "mobile-pricing.tsx"),
  join(COMPONENTS_DIR, "mobile", "mobile-about.tsx"),
  join(COMPONENTS_DIR, "mobile", "mobile-onboarding-wizard.tsx"),
  join(COMPONENTS_DIR, "mobile", "mobile-signup-wizard.tsx"),
  join(COMPONENTS_DIR, "mobile-route-experience.tsx"),
].filter((file) => existsSync(file));

const publicFiles = [...publicRouteFiles(), ...PUBLIC_CHROME];

function relative(file: string) {
  return file.slice(process.cwd().length + 1).replace(/\\/g, "/");
}

/**
 * Strips comments so the audit only sees strings a user could actually be
 * shown. Several public modules carry explicit "Live is intentionally not
 * mentioned here" comments, and those must not fail the audit.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("public surfaces carry no Odesseus Live", () => {
  it("finds public route sources to audit (guard against a broken glob)", () => {
    expect(publicFiles.length).toBeGreaterThan(20);
  });

  it.each(publicFiles.map((file) => [relative(file), file] as const))(
    "%s contains no Odesseus Live name or price",
    (_label, file) => {
      const text = stripComments(readFileSync(file, "utf8")).toLowerCase();
      for (const token of BANNED) {
        expect(text, `${relative(file)} must not contain "${token}"`).not.toContain(token);
      }
    },
  );

  it.each(publicFiles.map((file) => [relative(file), file] as const))(
    "%s contains no Live interview workflow copy",
    (_label, file) => {
      const text = stripComments(readFileSync(file, "utf8")).toLowerCase();
      for (const token of BANNED_LIVE_COPY) {
        expect(text, `${relative(file)} must not contain "${token}"`).not.toContain(token);
      }
    },
  );

  it.each(publicFiles.map((file) => [relative(file), file] as const))(
    "%s does not import the auth-gated billing catalogue",
    (_label, file) => {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/@\/lib\/billing\/catalog/);
    },
  );
});

describe("the applicant-only Live surface is preserved", () => {
  // The ban is on *public* visibility, not on the feature. These assertions
  // fail if a later pass "helpfully" deletes Live along with its leak.
  const APPLICANT_FILES = [
    join(APP_DIR, "interviews", "page.tsx"),
    join(APP_DIR, "interviews", "[id]", "page.tsx"),
    join(APP_DIR, "interviews", "[id]", "live", "page.tsx"),
    join(APP_DIR, "interviews", "[id]", "analysis", "page.tsx"),
    join(APP_DIR, "billing", "page.tsx"),
    join(COMPONENTS_DIR, "odesseus-live-client.tsx"),
    join(process.cwd(), "src", "lib", "live", "session-state.ts"),
  ];

  it.each(APPLICANT_FILES.map((file) => [relative(file), file] as const))(
    "%s still exists for signed-in applicants",
    (_label, file) => {
      expect(existsSync(file)).toBe(true);
    },
  );

  it("keeps the Live session/pass prices in the backend billing catalogue", () => {
    const catalog = readFileSync(join(process.cwd(), "src", "lib", "billing", "catalog.ts"), "utf8");
    expect(catalog).toContain("interview_1");
    expect(catalog).toContain("2499");
  });
});
