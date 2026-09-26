import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261007000000_job_report_status_new.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");
const sqlOnly = sql.replace(/--[^\n]*/g, "");

describe("job report status rename migration", () => {
  it("establishes the approved four-state domain", () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT job_reports_status_check\s+CHECK \(status IN \('new', 'reviewing', 'resolved', 'dismissed'\)\)/
    );
    // The retired name must not survive in the new constraint. It does still
    // appear once in the conversion UPDATE, which is the point of that
    // statement, so this is scoped to the constraint rather than the file.
    const constraint = sql.slice(
      sql.indexOf("ADD CONSTRAINT job_reports_status_check")
    );
    expect(constraint).not.toMatch(/'open'/);
    expect(sql).toMatch(/ALTER COLUMN status SET DEFAULT 'new'/);
  });

  it("converts existing rows in place rather than dropping data", () => {
    // Data-preserving: a report keeps its id, its reporting user, its created_at,
    // and any moderation note. The UPDATE is the whole conversion and is a
    // no-op on an empty table, which is the normal pre-production case.
    expect(sql).toMatch(/UPDATE public\.job_reports SET status = 'new' WHERE status = 'open';/);
    // No rebuild: dropping the table, truncating, or cascading the user's
    // reports would all be destructive and none is warranted.
    expect(sqlOnly).not.toMatch(/DROP TABLE/i);
    expect(sqlOnly).not.toMatch(/TRUNCATE/i);
    expect(sqlOnly).not.toMatch(/DROP COLUMN/i);
    expect(sqlOnly).not.toMatch(/DELETE FROM/i);
  });

  it("swaps the CHECK rather than weakening it", () => {
    expect(sql).toMatch(/DROP CONSTRAINT job_reports_status_check;/);
    // Order matters: the old CHECK has to go before the replacement is added.
    const dropAt = sql.indexOf("DROP CONSTRAINT job_reports_status_check");
    const addAt = sql.indexOf("ADD CONSTRAINT job_reports_status_check");
    expect(dropAt).toBeGreaterThan(-1);
    expect(addAt).toBeGreaterThan(dropAt);
  });

  it("pins the birth status so a filer cannot pre-judge their own report", () => {
    // `authenticated` holds INSERT on job_reports, and the original policy
    // constrained only user_id -- so a direct PostgREST call could file a report
    // already marked resolved. This is a tightening, and the service has always
    // sent the filing status explicitly, so no legitimate path changes.
    expect(sql).toMatch(/DROP POLICY "job_reports_insert_own" ON public\.job_reports;/);
    expect(sql).toMatch(
      /CREATE POLICY "job_reports_insert_own" ON public\.job_reports\s+FOR INSERT\s+TO authenticated\s+WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id AND status = 'new'\);/
    );
    // Ownership must survive the rewrite: dropping it would let anyone file a
    // report as any other user.
    expect(sql).toMatch(/auth\.uid\(\)\) = user_id/);
  });

  it("keeps report RLS own-row scoped and moderation server-side", () => {
    // Only the insert policy is touched. The select policy is untouched, so
    // candidates still read only their own reports.
    expect(sqlOnly).not.toMatch(/DROP POLICY "job_reports_select_own"/);
    expect(sqlOnly).not.toMatch(/CREATE POLICY "job_reports_select_own"/);
    // Candidates still get no UPDATE or DELETE path.
    expect(sqlOnly).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON TABLE public\.job_reports/i);
    expect(sqlOnly).not.toMatch(/GRANT[^;]*DELETE[^;]*ON TABLE public\.job_reports/i);
    // The moderation RPC keeps its exact guard and its service-role-only grant;
    // this migration re-documents it rather than redefining it, so the set of
    // states a moderator may reach is unchanged.
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.odesseus_update_job_report_status\(uuid, text, text\)/);
    expect(sqlOnly).not.toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_update_job_report_status/);
  });

  it("adds a partial index for the new-reports queue view", () => {
    // job_reports_status_idx already covers status; this one serves the common
    // "newest unreviewed first" queue query without scanning resolved history.
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS job_reports_new_idx\s+ON public\.job_reports \(created_at\)\s+WHERE status = 'new';/
    );
    // And the name is unique, so re-running cannot collide.
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS job_reports_new_idx/);
  });

  it("does not touch candidate money, apply settlement, or employer billing", () => {
    for (const table of [
      "credit_balances",
      "wallet_transactions",
      "pricing_products",
      "employer_members",
      "recruiter_seats",
      "employer_subscriptions",
      "featured_listings",
      "applications",
      "application_runs",
    ]) {
      expect(sqlOnly).not.toMatch(new RegExp(`ALTER TABLE public\\.${table}`));
      expect(sqlOnly).not.toMatch(new RegExp(`INSERT INTO public\\.${table}`));
      expect(sqlOnly).not.toMatch(new RegExp(`UPDATE public\\.${table}`));
    }
    expect(sqlOnly).not.toMatch(/GRANT[^;]*ON TABLE public\.(?!job_reports)/i);
  });
});
