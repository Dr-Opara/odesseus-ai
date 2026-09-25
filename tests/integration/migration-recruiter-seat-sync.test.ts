import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20260929000000_recruiter_seat_sync.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("recruiter seat sync migration (M5 backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    // recruiter_seats RLS/grants from the pricing contract stay untouched.
    expect(sql).not.toMatch(/ALTER TABLE public\.recruiter_seats ENABLE/i);
    expect(sql).not.toMatch(/GRANT .*recruiter_seats/i);
    expect(sql).not.toMatch(/REVOKE .*recruiter_seats/i);
  });

  it("adds a service-role-only recruiter seat sync RPC", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_sync_recruiter_seat /);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public', 'odesseus_private', 'pg_temp'/);
    expect(sql).toMatch(/unknown subscription status: %/);
    expect(sql).toMatch(/recruiter seat count must be at least 1/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_sync_recruiter_seat/u);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.odesseus_sync_recruiter_seat(uuid, integer, text, text, text, timestamptz, timestamptz) TO postgres, service_role;"
    );
  });

  it("upserts one recruiter_seats row per subscription, idempotently", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stripe_customer_id text/);
    expect(sql).toMatch(/on conflict \(stripe_subscription_id\) do update/);
    expect(sql).toMatch(/set count = excluded\.count/);
    expect(sql).toMatch(/active_until = excluded\.active_until/);
    expect(sql).toMatch(/stripe_customer_id = excluded\.stripe_customer_id/);
    expect(sql).toMatch(/updated_at = now\(\)/);
  });

  it("voids lapsed seats and keeps past_due counts", () => {
    // canceled/incomplete -> count 0 with an immediate active_until.
    expect(sql).toMatch(/v_count := 0;/);
    expect(sql).toMatch(/elsif p_status = 'past_due' then/);
    expect(sql).toMatch(/v_count := greatest\(p_count, 0\);/);
  });
});