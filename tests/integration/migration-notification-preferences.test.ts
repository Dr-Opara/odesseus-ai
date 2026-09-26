import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261002000000_notification_preferences.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("notification preferences migration (M8 backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    expect(sql).toMatch(/ALTER TABLE public\.notification_preferences ENABLE ROW LEVEL SECURITY;/);
  });

  it("creates a one-row-per-user preferences table with the contract channels", () => {
    expect(sql).toMatch(/CREATE TABLE public\.notification_preferences/);
    expect(sql).toMatch(/user_id\s+uuid\s+NOT NULL/);
    expect(sql).toMatch(/notification_preferences_pkey PRIMARY KEY \(user_id\)/);
    expect(sql).toMatch(/applications\s+boolean\s+NOT NULL DEFAULT true/);
    expect(sql).toMatch(/documents\s+boolean\s+NOT NULL DEFAULT true/);
    expect(sql).toMatch(/matches\s+boolean\s+NOT NULL DEFAULT true/);
    expect(sql).toMatch(/activity\s+boolean\s+NOT NULL DEFAULT true/);
    expect(sql).toMatch(/product\s+boolean\s+NOT NULL DEFAULT false/);
  });

  it("adds the four own-row CRUD policies scoped by auth.uid()", () => {
    for (const name of ["select_own", "insert_own", "update_own", "delete_own"]) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY "notification_preferences_${name}"`));
    }
    expect(sql).toMatch(/USING \(\(SELECT auth\.uid\(\)\) = user_id\)/);
    expect(sql).toMatch(/WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)/);
  });

  it("restricts grants to authenticated CRUD and gives service_role full access", () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.notification_preferences FROM anon, authenticated;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.notification_preferences TO authenticated;/);
    expect(sql).toMatch(/GRANT ALL PRIVILEGES ON TABLE public\.notification_preferences TO postgres, service_role;/);
  });

  it("cascades on user deletion", () => {
    expect(sql).toMatch(/FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });
});