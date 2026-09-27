import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static checks on the careers migrations.
 *
 * The properties asserted here are not visible from TypeScript: whether a
 * storage bucket is public, which table grants reach a browser role, and
 * whether a bucket has any policy at all are all decided in SQL. A route test
 * that mocks the service client cannot see them, so they are pinned here
 * against the migration file, and the same privacy posture is asserted again
 * against the running database in `supabase/tests/rls-audit.test.sql`.
 */
const MIGRATION_DIR = join(process.cwd(), "supabase", "migrations");

function readMigration(file: string) {
  return readFileSync(join(MIGRATION_DIR, file), "utf8");
}

const BUCKET_MIGRATION = "20261017000000_career_resume_storage.sql";

describe("career resume storage migration", () => {
  const sql = readMigration(BUCKET_MIGRATION);

  it("creates the career-resumes bucket as private", () => {
    expect(sql).toMatch(/insert into storage\.buckets/);
    // `public` is the flag that makes every object in the bucket world-readable
    // to anyone holding the key. It appears as a column list and again in the
    // upsert conflict clause; both must be false.
    expect(sql).toMatch(/'career-resumes',\s*\n\s*'career-resumes',\s*\n\s*false,/);
    expect(sql).toMatch(/set public = false/);
  });

  it("adds no storage policy at all", () => {
    // Only the service role mints a signed URL for these objects. A policy here
    // would be a second, unrelated answer to "who may read this", and would
    // also break the RLS audit's four-resume_files-policy assertion.
    // Statement-scoped patterns, not bare words: the prose above explains why
    // there is no policy, and "grant" appears in that explanation.
    expect(sql).not.toMatch(/^\s*create\s+policy\b/im);
    expect(sql).not.toMatch(/^\s*on\s+storage\.objects\b/im);
    expect(sql).not.toMatch(/^\s*grant\b/im);
  });

  it("caps size and pins the document types", () => {
    expect(sql).toContain("5242880");
    for (const mime of [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(sql).toContain(mime);
    }
    // An executable or an html document in the same trust domain as a hiring
    // pipeline is the risk the whitelist exists to prevent.
    expect(sql).not.toMatch(/application\/x-msdownload|image\/svg|text\/html/);
  });

  it("is idempotent, so a re-run cannot fail or silently change the bucket", () => {
    expect(sql).toMatch(/on conflict \(id\) do update/);
  });

  it("does not touch any public table", () => {
    // A bucket is storage. A careers migration that also granted table
    // privileges would be doing the job of a different migration, and the
    // RLS audit's grant inventory is what proves it did not.
    expect(sql).not.toMatch(/^\s*alter\s+table\b/im);
    expect(sql).not.toMatch(/^\s*(revoke|grant)\b/im);
  });
});

describe("careers tables are the Phase 14B ones, not a second definition", () => {
  // The reconciliation kept a single careers schema. The `career_roles` /
  // `career_applications` prototype from the pricing branch is superseded: it
  // would be a second `career_applications` with different columns. This test
  // exists so nobody re-imports it and quietly ends up with two.
  const sql = readMigration(BUCKET_MIGRATION);

  it("introduces no table at all", () => {
    expect(sql).not.toMatch(/create\s+table/i);
  });

  it("never names the superseded career_roles table", () => {
    expect(sql).not.toContain("career_roles");
    expect(sql).not.toContain("application_limit");
    expect(sql).not.toContain("enforce_career_application_limit");
  });

  it("uses the bucket name the service module reads", async () => {
    const { CAREER_RESUME_BUCKET } = await import("@/lib/careers/service");
    expect(CAREER_RESUME_BUCKET).toBe("career-resumes");
    expect(sql).toContain(`'${CAREER_RESUME_BUCKET}'`);
  });
});
