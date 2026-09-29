import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261117000000_employer_hiring.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("employer hiring migration (2R backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/im);
    expect(sql).not.toMatch(/^DROP COLUMN/im);
    expect(sql).not.toMatch(/^DELETE FROM/im);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/GRANT .* TO anon/i);
  });

  it("adds nullable hiring-evidence columns to employer jobs", () => {
    for (const column of ["requirements_text", "preferred_text", "work_arrangement"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, "i"));
    }
    expect(sql).not.toMatch(/SET NOT NULL/i);
  });

  it("creates the org-scoped applicant accessor, membership-gated", () => {
    expect(sql).toMatch(/odesseus_get_employer_applicants/i);
    expect(sql).toMatch(/Not permitted/i);
    expect(sql).toMatch(/employer_job_id/i);
    // Employer-safe payload only: no user ids, no Live/mock/prep content.
    expect(sql).not.toMatch(/user_id,/i);
    expect(sql).not.toMatch(/live_transcript/i);
    expect(sql).not.toMatch(/live_guidance/i);
    expect(sql).not.toMatch(/mock_interview/i);
    expect(sql).not.toMatch(/interview_readiness/i);
    expect(sql).not.toMatch(/post_interview/i);
  });

  it("creates fit scores with a per-application unique grant and member reads", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employer_fit_scores/i);
    expect(sql).toMatch(/unique \(job_id, application_id\)/i);
    expect(sql).toMatch(/score integer not null check \(score >= 0 and score <= 100\)/i);
    expect(sql).toMatch(/CREATE POLICY "employer_fit_scores_select_member"/i);
  });

  it("creates append-only pipeline history with the locked vocabulary", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employer_pipeline_stages/i);
    for (const stage of ["applied", "reviewing", "shortlisted", "interview", "offer", "hired", "rejected"]) {
      expect(sql).toContain(`'${stage}'`);
    }
    expect(sql).toMatch(/CREATE POLICY "employer_pipeline_select_member"/i);
    // No update/delete policies: history is insert-only.
    expect(sql).not.toMatch(/employer_pipeline_stages for update/i);
    expect(sql).not.toMatch(/employer_pipeline_stages for delete/i);
  });

  it("adds the hiring-manager helper for owner/admin/recruiter writes", () => {
    expect(sql).toMatch(/is_org_hiring_manager/i);
    expect(sql).toMatch(/'admin', 'recruiter'/i);
  });
});
