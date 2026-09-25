import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20260930000000_featured_listing_creation.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("featured listing creation migration (M6 backend slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    // featured_listings RLS/grants from the pricing contract stay untouched.
    expect(sql).not.toMatch(/ALTER TABLE public\.featured_listings ENABLE/i);
    expect(sql).not.toMatch(/GRANT .*featured_listings/i);
    expect(sql).not.toMatch(/REVOKE .*featured_listings/i);
  });

  it("adds a service-role-only featured listing creation RPC", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_create_featured_listing /);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public', 'odesseus_private', 'pg_temp'/);
    expect(sql).toMatch(/unknown featured tier: %/);
    expect(sql).toMatch(/featured job not found in this organization/);
    expect(sql).toMatch(/a stripe payment intent is required/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.odesseus_create_featured_listing/u);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.odesseus_create_featured_listing(uuid, uuid, text, text) TO postgres, service_role;"
    );
  });

  it("maps the three featured tiers to 7 / 14 / 30 day windows", () => {
    expect(sql).toMatch(/when 'featured_7d'  then v_days := 7;/);
    expect(sql).toMatch(/when 'featured_14d' then v_days := 14;/);
    expect(sql).toMatch(/when 'ai_30d'       then v_days := 30;/);
  });

  it("creates listings idempotently on the money-verified payment intent", () => {
    expect(sql).toMatch(/on conflict \(stripe_payment_intent\) do nothing/);
    expect(sql).toMatch(/insert into public\.featured_listings/);
    expect(sql).toMatch(/where fl\.stripe_payment_intent = p_stripe_payment_intent/);
  });

  it("gates creation on the job belonging to the paying organization", () => {
    expect(sql).toMatch(/from public\.employer_jobs/);
    expect(sql).toMatch(/where id = p_job_id and org_id = p_org_id/);
  });
});