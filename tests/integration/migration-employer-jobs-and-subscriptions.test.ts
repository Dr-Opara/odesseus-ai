import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION =
  "supabase/migrations/20260928000000_employer_jobs_and_subscriptions.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make the file regexes and statement splitting
// line-ending agnostic without altering the content under test.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("employer jobs + subscription quota migration (M4 backend slice)", () => {
  it("is additive: no table/column drops, no deletions, no data deletes", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    // No RLS weakening: every public table keeps RLS enabled and member-scoped.
    expect(sql).toMatch(/ALTER TABLE public\.employer_jobs ENABLE ROW LEVEL SECURITY;/);
  });

  it("creates employer_jobs as an org-scoped, RLS-protected posting table", () => {
    expect(sql).toMatch(/CREATE TABLE public\.employer_jobs \(/);
    expect(sql).toMatch(/org_id\s+uuid NOT NULL REFERENCES public\.employer_organizations\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/status\s+text NOT NULL DEFAULT 'draft'/);
    expect(sql).toMatch(/'draft', 'published', 'closed'/);
    // Members read; only admins/owners write; service_role has full access.
    expect(sql).toMatch(/CREATE POLICY "employer_jobs_select_member"/);
    expect(sql).toMatch(/CREATE POLICY "employer_jobs_insert_admin_owner"/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.employer_jobs TO authenticated;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.employer_jobs TO postgres, service_role;/);
  });

  it("enforces the job-post quota with an idempotent claim trigger", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION odesseus_private\.claim_job_post_credit\(\)/);
    // SECURITY DEFINER so the trigger can write billing-owned rows on behalf of
    // the member performing the publish; search_path pinned against hijack.
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public', 'odesseus_private', 'pg_temp'/);
    expect(sql).toMatch(/raise exception 'no job post credits available for this employer'/);
    // Exactly-once semantics: unique ledger ref per job id.
    expect(sql).toMatch(/'job_post:' \|\| new\.id::text/);
    expect(sql).toMatch(/CREATE TRIGGER trg_employer_jobs_claim_credit/);
  });

  it("adds an idempotent, service-role-only subscription sync RPC", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_sync_employer_subscription \(/);
    expect(sql).toMatch(/unknown employer tier: %/);
    expect(sql).toMatch(/unknown subscription status: %/);
    // Grant is keyed on the paid period so replays of the same webhook event
    // never double-grant.
    expect(sql).toMatch(/'tier_grant:' \|\| p_org_id::text \|\| ':' \|\| p_tier \|\| ':' \|\| p_period_start::text/);
    expect(sql).toMatch(/on conflict \(external_reference\) do nothing/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_sync_employer_subscription/u);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.odesseus_sync_employer_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) TO postgres, service_role;"
    );
  });

  it("resolves the deferred featured_listings.job_id FK to employer_jobs", () => {
    expect(sql).toMatch(/ADD CONSTRAINT featured_listings_job_id_fkey/);
    expect(sql).toMatch(/FOREIGN KEY \(job_id\) REFERENCES public\.employer_jobs\(id\)/);
  });

  it("matches the approved employer pricing and quotas", () => {
    // Starter 3 / Growth 10 / Business 25 job posts per paid month.
    expect(sql).toMatch(/when 'starter'\s+then 3/);
    expect(sql).toMatch(/when 'growth'\s+then 10/);
    expect(sql).toMatch(/when 'business'\s+then 25/);
  });
});