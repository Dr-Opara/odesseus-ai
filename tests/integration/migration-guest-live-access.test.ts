import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261115000000_guest_live_access.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("guest live access migration (2O backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/im);
    expect(sql).not.toMatch(/^DROP COLUMN/im);
    expect(sql).not.toMatch(/^DELETE FROM/im);
    expect(sql).not.toMatch(/^DROP DATABASE/im);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/GRANT .* TO anon/i);
    expect(sql).toMatch(/ALTER TABLE public\.guest_access_records ENABLE ROW LEVEL SECURITY;/i);
  });

  it("extends the historical guest invites table without touching its columns", () => {
    expect(sql).toMatch(/ALTER TABLE public\.live_guest_invites/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS session_id uuid/i);
    expect(sql).not.toMatch(/DROP COLUMN/im);
  });

  it("creates the no-account guest record keyed by token hash only", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.guest_access_records/i);
    expect(sql).toMatch(/owner_user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/token_sha256 text NOT NULL UNIQUE/i);
    expect(sql).toMatch(/guest_name text/);
    expect(sql).toMatch(/guest_job_description text/);
    expect(sql).toMatch(/guest_resume_storage_path text/);
    expect(sql).toMatch(/interview_id uuid REFERENCES public\.interviews\(id\) ON DELETE SET NULL/i);
    expect(sql).toMatch(/live_session_id uuid REFERENCES public\.live_interview_sessions\(id\) ON DELETE SET NULL/i);
    // No guest account linkage in DDL: no guest_user_id column, and no
    // wallet/billing/stripe tables or columns (prose comments excluded).
    expect(sql).not.toMatch(/guest_user_id/);
    expect(sql).not.toMatch(/create\s+table[^;]*(wallet|billing|stripe)/i);
    expect(sql).not.toMatch(/^\s*(wallet|billing|stripe)[_\w]*\s+(text|uuid|bigint|integer|jsonb|boolean|numeric)/im);
  });

  it("adds owner-scoped RLS policies and no anonymous grants", () => {
    for (const verb of ["view", "insert", "update", "delete"]) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY "Owner can ${verb} own guest access records"`, "i"));
    }
    expect(sql).toMatch(/auth\.uid\(\) = owner_user_id/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.guest_access_records FROM anon, authenticated;/i);
  });

  it("extends the interview source domain with the guest-share value only", () => {
    expect(sql).toMatch(/interviews_source_check/);
    expect(sql).toMatch(/'guest_share_link'/);
    expect(sql).toMatch(/'email'/);
    expect(sql).toMatch(/'calendar'/);
    expect(sql).toMatch(/'manual'/);
  });

  it("keeps guest-share interviews out of dashboard counts", () => {
    expect(sql).toMatch(/odesseus_get_candidate_dashboard_counts/);
    expect(sql).toMatch(/source <> 'guest_share_link'/);
  });
});
