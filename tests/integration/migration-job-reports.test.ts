import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261001000000_job_reports.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("job reports migration (M7 backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.job_opportunities/i);
    expect(sql).toMatch(/ALTER TABLE public\.job_reports ENABLE ROW LEVEL SECURITY;/);
  });

  it("creates the RLS-protected job_reports table with own-row policies", () => {
    expect(sql).toMatch(/CREATE TABLE public\.job_reports/);
    expect(sql).toMatch(/reason\s+text\s+NOT NULL/);
    expect(sql).toMatch(/job_reports_status_check CHECK \(status IN \('open', 'reviewing', 'resolved', 'dismissed'\)\)/);
    expect(sql).toMatch(/CREATE POLICY "job_reports_select_own"/);
    expect(sql).toMatch(/CREATE POLICY "job_reports_insert_own"/);
    expect(sql).toMatch(/USING \(\(SELECT auth\.uid\(\)\) = user_id\)/);
    expect(sql).toMatch(/WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)/);
  });

  it("restricts client grants to own-row SELECT/INSERT and gives full access to service_role", () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.job_reports FROM anon, authenticated;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON TABLE public\.job_reports TO authenticated;/);
    expect(sql).toMatch(/GRANT ALL PRIVILEGES ON TABLE public\.job_reports TO postgres, service_role;/);
  });

  it("constrains the reason set, details length, and moderation status", () => {
    expect(sql).toMatch(/'Scam'/);
    expect(sql).toMatch(/'Fake Company'/);
    expect(sql).toMatch(/'Phishing Attempt'/);
    expect(sql).toMatch(/'Duplicate Listing'/);
    expect(sql).toMatch(/char_length\(details\) <= 2000/);
    expect(sql).toMatch(/char_length\(moderation_note\) <= 2000/);
  });

  it("adds a service-role-only moderation status RPC that fails closed", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_update_job_report_status/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public', 'odesseus_private', 'pg_temp'/);
    expect(sql).toMatch(/unknown job report moderation status: %/);
    expect(sql).toMatch(/job report not found/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_update_job_report_status/u);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.odesseus_update_job_report_status(uuid, text, text) TO postgres, service_role;"
    );
  });

  it("wires referential behavior: user deletion cascades, job deletion nulls the reference", () => {
    expect(sql).toMatch(/FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/FOREIGN KEY \(job_id\) REFERENCES public\.job_opportunities\(id\) ON DELETE SET NULL/);
  });
});