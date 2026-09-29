import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261118000000_public_job_feed.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("public job feed migration (homepage feed slice)", () => {
  it("is additive: no drops, deletions, or grants to anon", () => {
    expect(sql).not.toMatch(/^DROP TABLE/im);
    expect(sql).not.toMatch(/^DROP COLUMN/im);
    expect(sql).not.toMatch(/^DELETE FROM/im);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/GRANT .* TO anon/i);
  });

  it("creates the shared feed store deduped by source identity", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.public_job_posts/i);
    expect(sql).toMatch(/unique \(source_key, external_id\)/i);
    expect(sql).toMatch(/salary_text text/i);
    expect(sql).toMatch(/is_active boolean not null default true/i);
    expect(sql).toMatch(/last_seen_at timestamptz not null default now\(\)/i);
  });

  it("serves reads through the API only, with no direct privileges", () => {
    expect(sql).toMatch(/ALTER TABLE public\.public_job_posts ENABLE ROW LEVEL SECURITY;/i);
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.public_job_posts FROM anon, authenticated;/i
    );
    // No policies at all: deny-by-default for every client role.
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
