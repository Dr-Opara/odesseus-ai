import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261003000000_rls_audit_hardening.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

const SERVER_ONLY_TABLES = [
  "admin_users",
  "partner_applications",
  "partner_campaign_members",
  "partner_campaigns",
  "partner_content",
  "partner_conversions",
  "partner_earnings",
  "partner_payouts",
  "partner_referrals",
  "partner_social_accounts",
  "partners",
];

describe("RLS audit hardening migration (M9 backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT .* TO (anon|authenticated)/i);
  });

  it("revokes anon and authenticated grants on every server-only table", () => {
    for (const table of SERVER_ONLY_TABLES) {
      expect(sql).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM anon, authenticated;`
      );
    }
  });

  it("never touches candidate, employer, wallet, or storage tables", () => {
    for (const table of [
      "job_opportunities",
      "job_reports",
      "notification_preferences",
      "profiles",
      "resumes",
      "credit_balances",
      "credit_transactions",
      "employer_organizations",
      "employer_subscriptions",
      "featured_listings",
      "recruiter_seats",
      "billing_events",
    ]) {
      expect(sql).not.toMatch(new RegExp(`public\\.${table}\\b`));
    }
    expect(sql).not.toMatch(/^(CREATE|ALTER|DROP|GRANT|REVOKE).*storage\.objects/i);
    expect(sql).not.toMatch(/^ALTER TABLE storage\.objects/i);
  });

  it("keeps the deny-browser-access policies as a second RLS layer", () => {
    expect(sql).toMatch(/deny-browser-access policies stay in place/i);
    expect(sql).toMatch(/even if a future migration re-grants privileges/i);
  });
});