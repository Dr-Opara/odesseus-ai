import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Application credits are the active candidate currency: 1 credit ($0.99 USD,
 * cheaper in packs) pays for 1 verified successful submission, Apply or Smart
 * Apply. `credit_balances.wallet_balance_cents` survives only as a legacy
 * balance that stays spendable at the single-credit price; wallet top-ups are
 * no longer sold, so no candidate surface may offer one.
 *
 * These are static checks. The e2e suite proves what actually renders, but it
 * only sees live routes, so a stale top-up form is invisible to it.
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

describe("candidate surfaces use application credits, not wallet top-ups", () => {
  it("finds candidate surfaces to audit (guard against a broken glob)", () => {
    expect(uiFiles.length).toBeGreaterThan(15);
  });

  it.each(uiFiles.map((file) => [relative(file), file] as const))(
    "%s never offers a wallet top-up",
    (_label, file) => {
      const text = stripComments(readFileSync(file, "utf8")).toLowerCase();
      expect(text).not.toMatch(/\btop up\b|add funds|"wallet_(10|20|50)"/);
    },
  );

  it("AppShell shows application credits alongside the legacy wallet", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain("applicationCredits");
    expect(shell).toContain("applicationsAvailable(");
  });

  it("the shared CreditBalance contract exposes applicationCredits", () => {
    const code = stripComments(readFileSync(join(process.cwd(), "src/lib/candidate/types.ts"), "utf8"));
    expect(code).toContain("applicationCredits: number");
    expect(code).toContain("walletBalanceCents: number");
  });
});

describe("one eligibility rule everywhere", () => {
  it("the apply start gate uses canStartApply over credits and legacy wallet", () => {
    const route = stripComments(readFileSync(join(APP_DIR, "api", "apply", "start", "route.ts"), "utf8"));
    expect(route).toContain('"application_credits,wallet_balance_cents"');
    expect(route).toContain("canStartApply(balance)");
  });

  it("the candidate balance reader selects both balances", () => {
    const service = readFileSync(join(process.cwd(), "src/lib/candidate/service.ts"), "utf8");
    expect(stripComments(service)).toContain('"application_credits,wallet_balance_cents,interview_passes,live_unlimited_until"');
  });

  it("finalization spends a credit before falling back to the wallet", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20261123000000_spec_candidate_pricing.sql"),
      "utf8"
    );
    expect(migration).toMatch(/v_charge := case when coalesce\(v_credits, 0\) >= 1 then 'application_credit' else 'wallet' end/);
    expect(migration).toContain("'application',\n      -1,");
  });
});
