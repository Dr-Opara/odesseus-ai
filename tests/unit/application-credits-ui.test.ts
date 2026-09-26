import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The wallet is the only active candidate currency: Standard Apply costs 49c
 * and Smart Apply 199c, both drawn from `credit_balances.wallet_balance_cents`
 * (the same column the apply gate reads in
 * `src/app/api/apply/start/route.ts`).
 *
 * The legacy `application_credits` column still exists in Postgres — schema
 * is backend-owned and out of the frontend lane — but it must not appear in any
 * candidate-facing surface. Leaving a stale balance on screen is worse than
 * removing it: it advertises a number that can no longer buy anything.
 *
 * These are static checks. The e2e suite proves what actually renders, but it
 * only sees live routes, so an unused-but-imported credit prop is invisible to
 * it and becomes a one-edit regression.
 */

/** Candidate-facing route roots that render the authenticated app shell. */
const CANDIDATE_ROUTE_ROOTS = [
  "dashboard",
  "jobs",
  "match",
  "applications",
  "interviews",
  "billing",
  "profile",
  "settings",
  "resume-tailoring",
  "integrations",
  "onboarding",
] as const;

const APP_DIR = join(process.cwd(), "src", "app");

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

const candidateRouteFiles = CANDIDATE_ROUTE_ROOTS.flatMap((root) =>
  sourceFiles(join(APP_DIR, root))
);

/** Shared chrome rendered on every authenticated candidate page. */
const CANDIDATE_CHROME = [
  "src/components/app-shell.tsx",
  "src/components/mobile/mobile-home.tsx",
].map((rel) => join(process.cwd(), rel));

const uiFiles = [...new Set([...candidateRouteFiles, ...CANDIDATE_CHROME])];

function relative(file: string) {
  return file.slice(process.cwd().length + 1).replace(/\\/g, "/");
}

/**
 * Strips comments so the audit only sees strings a user could be shown. The
 * balance module and the billing page both carry explicit "the legacy column is
 * not surfaced" notes, and those must not fail this audit.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no candidate surface renders the legacy application-credit balance", () => {
  it("finds candidate surfaces to audit (guard against a broken glob)", () => {
    expect(uiFiles.length).toBeGreaterThan(15);
  });

  it.each(uiFiles.map((file) => [relative(file), file] as const))(
    "%s never reads the application_credits column",
    (_label, file) => {
      // Comments are stripped here too: the billing page carries a JSX note
      // naming the legacy column to explain why it is absent, and a comment
      // cannot read a column.
      expect(stripComments(readFileSync(file, "utf8"))).not.toMatch(/application_credits/);
    },
  );

  it.each(uiFiles.map((file) => [relative(file), file] as const))(
    "%s never shows application-credit copy",
    (_label, file) => {
      const text = stripComments(readFileSync(file, "utf8")).toLowerCase();
      expect(text).not.toMatch(/app credits|application credits|application-credit/);
    },
  );

  it("AppShell takes a wallet balance, not an application-credit count", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain("walletBalanceCents");
    expect(shell).not.toContain("applicationCredits");
  });

  it("the shared CreditBalance contract exposes no application_credits field", () => {
    const types = readFileSync(join(process.cwd(), "src/lib/candidate/types.ts"), "utf8");
    // Only a comment may mention it; the type itself must not declare it.
    const code = stripComments(types);
    expect(code).not.toContain("application_credits");
    expect(code).toContain("walletBalanceCents");
  });
});

describe("the wallet is the single source of spend truth", () => {
  it("the apply start gate spends from wallet_balance_cents", () => {
    const route = readFileSync(join(APP_DIR, "api", "apply", "start", "route.ts"), "utf8");
    expect(route).toContain("wallet_balance_cents");
    // The gate must not accept a legacy credit balance as an alternative.
    expect(stripComments(route)).not.toContain("application_credits");
  });

  it("the candidate balance reader selects wallet_balance_cents", () => {
    const service = readFileSync(join(process.cwd(), "src/lib/candidate/service.ts"), "utf8");
    expect(stripComments(service)).toContain('"wallet_balance_cents,interview_passes,live_unlimited_until"');
  });

  it("leaves the database schema untouched (backend-owned)", () => {
    // The column is still in the DB on purpose. This asserts we did not
    // "fix" the UI by editing schema, which is the backend lane's call.
    const schema = readFileSync(join(process.cwd(), "src/types/database.ts"), "utf8");
    expect(schema).toContain("application_credits");
    expect(schema).toContain("wallet_balance_cents");
  });
});
