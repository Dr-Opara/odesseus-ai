import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261116000000_employer_provisioning.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("employer provisioning migration (2P backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/im);
    expect(sql).not.toMatch(/^DROP COLUMN/im);
    expect(sql).not.toMatch(/^DELETE FROM/im);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/GRANT .* TO anon/i);
  });

  it("adds nullable company-profile columns without touching existing rows", () => {
    for (const column of ["website", "industry", "company_size", "description"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column} text`, "i"));
    }
    expect(sql).not.toMatch(/SET NOT NULL/i);
    expect(sql).not.toMatch(/UPDATE public\.employer_organizations/i);
  });

  it("creates the idempotent provisioning function, service-role only", () => {
    expect(sql).toMatch(/odesseus_ensure_employer_organization/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/ON CONFLICT ON CONSTRAINT employer_members_pkey DO NOTHING/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_ensure_employer_organization\(uuid, text\) FROM authenticated/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_ensure_employer_organization\(uuid, text\) TO postgres, service_role/i
    );
  });

  it("leaves the deprecated credit-grant path alone", () => {
    // No function definitions for the deprecated path: it is referenced in
    // prose only, to document that it stays untouched history.
    expect(sql).not.toMatch(/^CREATE OR REPLACE FUNCTION public\.grant_employer_tier_job_posts/im);
    expect(sql).not.toMatch(/^CREATE OR REPLACE FUNCTION .*claim_job_post_credit/im);
  });
});
