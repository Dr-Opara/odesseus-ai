import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the employer portal (Phase 5).
 *
 * Four rules that are cheap to state and easy to break by accident:
 *
 * 1. No employer surface shows a fabricated figure. The previous employer
 *    dashboard was entirely hardcoded ("4 Active Jobs", "156 Applicants",
 *    "31 Strong Matches", "Credits Remaining 3 / 5", "AI Starter Bundle"). A
 *    static check cannot prove a number came from a query, but it can pin the
 *    specific invented figures and the old vocabulary that produced them.
 * 2. Odesseus Live is never reachable from an employer session. Live is a
 *    candidate product; a link or price in the employer portal would expose it
 *    to the wrong audience.
 * 3. Employer sign-up is desktop-only. The phone flow is Business Login to the
 *    portal, so a mobile-visible employer sign-up form or link is a regression.
 * 4. Employer pricing is the approved set, and the retired $0.99
 *    per-application price never appears in an employer surface.
 *
 * These are static checks. The e2e suite proves what actually renders; these
 * catch the unused-but-imported variant, which no route visit will ever see.
 */

const EMPLOYER_ROUTE_ROOTS = ["employers"] as const;

const EMPLOYER_CHROME = [
  "src/components/employer-nav.tsx",
  "src/components/employer/employer-portal-header.tsx",
  "src/components/employer/employer-mobile-screen.tsx",
  "src/components/employer/employer-mobile-portal.tsx",
  "src/components/employer/employer-cards.tsx",
].map((rel) => join(process.cwd(), rel));

const LIB_FILES = [
  "src/lib/employer/plans.ts",
  "src/lib/employer/service.ts",
  "src/lib/employer/types.ts",
].map((rel) => join(process.cwd(), rel));

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const employerRouteFiles = EMPLOYER_ROUTE_ROOTS.flatMap((root) =>
  sourceFiles(join(process.cwd(), "src", "app", root))
);

const employerFiles = [
  ...new Set([...employerRouteFiles, ...EMPLOYER_CHROME]),
].filter((file) => existsSync(file));

const employerLibFiles = LIB_FILES.filter((file) => existsSync(file));

function relative(file: string) {
  return file.slice(process.cwd().length + 1).replace(/\\/g, "/");
}

/**
 * Strips comments so the audit only sees strings a user could be shown. The
 * employer service carries explicit notes about what it deliberately does not
 * read, and those notes must not fail the audit.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const employerCode = new Map(
  [...employerFiles, ...employerLibFiles].map((file) => [file, stripComments(readFileSync(file, "utf8"))])
);

describe("employer portal audit (sanity)", () => {
  it("finds employer surfaces to audit (guard against a broken glob)", () => {
    expect(employerFiles.length).toBeGreaterThanOrEqual(10);
    expect(employerLibFiles.length).toBe(3);
  });
});

describe("no employer surface fabricates hiring data", () => {
  /**
   * These are the exact figures and labels the old hardcoded dashboard
   * rendered. They are pinned individually because "4" or "3 / 5" are not
   * distinctive enough to grep for, but the phrases around them are.
   */
  const FABRICATED = [
    "156 Applicants",
    "31 Strong Matches",
    "83 Applicants",
    "14 Strong Matches",
    "7 Reviewed",
    "3 Shortlisted",
    "AI Starter Bundle",
    "Credits Remaining",
    "Here’s how your hiring is going",
  ];

  it.each(FABRICATED)("no employer surface renders the old placeholder %s", (phrase) => {
    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      if (source.includes(phrase)) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it("renders job counts from the overview, not from literals in the page", () => {
    // The dashboard must read the counts off the overview object. A hardcoded
    // number in the JSX is the failure this whole phase replaced.
    const dashboard = readFileSync(
      join(process.cwd(), "src", "app", "employers", "dashboard", "page.tsx"),
      "utf8"
    );
    expect(dashboard).toContain("overview.jobCounts");
    expect(dashboard).not.toMatch(/<h2>\{?\d+\}?<\/h2>/);
  });

  it("renders applicant and match counts from real backend data, never from a default", () => {
    // This assertion used to be "no employer surface may mention Applicants or
    // Shortlisted", on the grounds that the schema had no employer->applicant
    // link at all. That is no longer true: `odesseus_get_employer_applicants`
    // and `employer_pipeline_stages` give an organization a real view of the
    // applicants on its own jobs, and the analytics aggregate reports
    // applicant totals, strong-fit counts, and pipeline distribution.
    //
    // So the rule is restated as the invariant that actually matters now: a
    // count may be shown, but only if it came from a read. The specific
    // failure being guarded against is the one the old test was reaching for
    // — a screen that cannot load the data and renders `0` as though that were
    // a measurement.
    //
    // The pattern targets a count read off a value that may be absent *and*
    // rendered directly. Accumulation into a map (`counts.get(x) ?? 0 + 1`)
    // and a lookup guarded by a presence check are not fabrications and are
    // deliberately not matched: `0` is the right answer for a key no applicant
    // has been counted against.
    const FABRICATED_DEFAULT = /(?:applicantCount|applicantVolume|strongFit|planLimit|seatLimit|activeJobCount)\s*\?\?\s*0/gi;

    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      if (FABRICATED_DEFAULT.test(source)) offenders.push(relative(file));
    }
    FABRICATED_DEFAULT.lastIndex = 0;
    expect(
      offenders,
      "a count must not fall back to 0 when the read that supplies it may have failed"
    ).toEqual([]);
  });

  it("shows an explicit unavailable state rather than a zero when a read fails", () => {
    // The positive half of the rule above: the screens that consume these
    // counts must have a way to say "not available". Without it, the only
    // thing left to render on failure is a number.
    //
    // The canonical paths are the `/employers/dashboard/*` routes; the older
    // `/employers/jobs` and friends are redirects to them.
    for (const file of [
      "src/app/employers/dashboard/jobs/page.tsx",
      "src/app/employers/analytics/page.tsx",
      "src/app/employers/jobs/[id]/page.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, `${file} must have a not-available path`).toMatch(
        /Not available|Not enough data|unavailable|Unavailable|unrecognised/
      );
    }
  });

  it("consolidates jobs, team, and billing onto one canonical route each", () => {
    // Two live pages for one feature means two reads of the same data and no
    // way to tell which one is stale. The older paths must be redirects.
    for (const [oldPath, canonical] of [
      ["src/app/employers/jobs/page.tsx", "/employers/dashboard/jobs"],
      ["src/app/employers/team/page.tsx", "/employers/dashboard/team"],
      ["src/app/employers/billing/page.tsx", "/employers/dashboard/billing"],
    ]) {
      const source = readFileSync(join(process.cwd(), oldPath), "utf8");
      expect(source, `${oldPath} must redirect to ${canonical}`).toContain(
        `redirect("${canonical}")`
      );
    }
  });

  it("no employer surface fabricates an applicant, fit, or pipeline number from a literal", () => {
    // A count written into the JSX is a fabricated measurement no matter what
    // it says. The counts must be expressions over read data.
    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      // `<h2>12</h2>`, `{12}`, or a bare numeric prop on a count-bearing row.
      if (/<h2>\s*\{?\d+\}?\s*<\/h2>/.test(source)) offenders.push(relative(file));
      if (/(Applicants|Strong Fits?|Interviews|Pipeline)\D{0,20}\{\s*\d+\s*\}/i.test(source)) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the employer applicant and pipeline reads go through the real hiring backend", () => {
    // The counts above are only trustworthy if they are the backend's. Assert
    // the wiring rather than the rendering: the adapters read the applicant
    // RPC and the append-only stage history, and never a fixture.
    const candidates = readFileSync(
      join(process.cwd(), "src", "lib", "employers", "candidates-adapter.ts"),
      "utf8"
    );
    expect(candidates).toContain("listApplicants");
    expect(candidates).toContain("getPipeline");

    const pipeline = readFileSync(
      join(process.cwd(), "src", "lib", "employers", "pipeline-adapter.ts"),
      "utf8"
    );
    expect(pipeline).toContain("listApplicants");
    expect(pipeline).toContain("getPipeline");
  });
});

describe("Odesseus Live is never exposed to employers", () => {
  const LIVE_TERMS = ["Odesseus Live", "live passes", "interview pass", "Live session"];

  it.each(LIVE_TERMS)("no employer surface mentions %s", (term) => {
    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      if (source.toLowerCase().includes(term.toLowerCase())) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it("no employer route links to a candidate Live surface", () => {
    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      if (/href=["'`][^"'`]*\/live(?:["'`/?#]|$)/.test(source)) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the portal navigation to employer sections only", () => {
    const header = readFileSync(
      join(process.cwd(), "src", "components", "employers", "app-nav.tsx"),
      "utf8"
    );
    const hrefs = [...header.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.every((href) => href.startsWith("/employers/"))).toBe(true);
  });
});

describe("employer sign-up is desktop-only", () => {
  const signupPage = join(process.cwd(), "src", "app", "employers", "signup", "page.tsx");
  const loginPage = join(process.cwd(), "src", "app", "employers", "login", "page.tsx");
  const pricingPage = join(process.cwd(), "src", "app", "employers", "pricing", "page.tsx");

  it("wraps the employer sign-up form in the desktop visibility toggle", () => {
    const source = readFileSync(signupPage, "utf8");
    // The form itself must live inside an `odesseus-desktop-only` section.
    expect(source).toContain("odesseus-desktop-only");
    const formIndex = source.indexOf("<form action={employerSignup}>");
    const desktopIndex = source.indexOf("odesseus-desktop-only");
    expect(desktopIndex).toBeGreaterThanOrEqual(0);
    expect(formIndex).toBeGreaterThan(desktopIndex);
  });

  it("gives a phone visitor Business Login instead of a sign-up form", () => {
    const source = readFileSync(signupPage, "utf8");
    const mobileSection = source.slice(source.indexOf("odesseus-mobile-only"));
    expect(mobileSection).toContain("/employers/login");
    expect(mobileSection).not.toContain("employerSignup");
  });

  it("keeps the sign-up link out of the phone employer sign-in page", () => {
    const source = readFileSync(loginPage, "utf8");
    const mobileSection = source.slice(source.indexOf("odesseus-mobile-only"));
    expect(mobileSection).not.toContain("/employers/signup");
    // The desktop-only section still offers it.
    expect(source.slice(0, source.indexOf("odesseus-mobile-only"))).toContain("/employers/signup");
  });

  it("points the employer pricing call to action at sign-in on a phone", () => {
    const source = readFileSync(pricingPage, "utf8");
    const signupLink = source.indexOf('href="/employers/signup"');
    const loginLink = source.indexOf('href="/employers/login"');
    expect(signupLink).toBeGreaterThanOrEqual(0);
    expect(loginLink).toBeGreaterThan(signupLink);
    // The sign-up call to action must be desktop-only.
    expect(source.slice(Math.max(0, signupLink - 120), signupLink)).toContain(
      "odesseus-desktop-only"
    );
  });

  it("keeps the marketing employer header free of a mobile hamburger", () => {
    // Comments are stripped: the header's own doc block explains *why* there is
    // no hamburger, and that explanation must not be read as a violation.
    const nav = stripComments(
      readFileSync(join(process.cwd(), "src", "components", "employer-nav.tsx"), "utf8")
    );
    expect(nav).toContain("odesseus-desktop-only");
    expect(nav.toLowerCase()).not.toContain("hamburger");
    expect(nav).not.toMatch(/<details/);
    expect(nav).not.toMatch(/aria-expanded/);
  });
});

describe("employer pricing is the approved set", () => {
  it("never shows the retired $0.99 per-application price", () => {
    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      if (source.includes("0.99")) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it("never reads the retired application-credit balance", () => {
    const offenders: string[] = [];
    for (const [file, source] of employerCode) {
      if (source.includes("application_credits")) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it("states the approved seat price on the seats surfaces", () => {
    const cards = stripComments(
      readFileSync(
        join(process.cwd(), "src", "components", "employer", "employer-cards.tsx"),
        "utf8"
      )
    );
    expect(cards).toContain("$20");
  });
});
