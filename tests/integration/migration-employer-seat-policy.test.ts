import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const POLICY_MIGRATION = "supabase/migrations/20261006000000_seat_policy_member_roles.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, POLICY_MIGRATION), "utf8").replace(/\r\n/g, "\n");

/**
 * The migration with `--` comments removed. This file's header explains at
 * length which billing identifiers are deliberately left alone, so negative
 * assertions about those identifiers have to look at executable SQL only --
 * otherwise the documentation would fail its own guard.
 */
const sqlOnly = sql.replace(/--[^\n]*/g, "");

describe("employer seat policy migration", () => {
  it("meters every invitable role, so no role is a way to take a seat for free", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_metered_org_roles\(\)[\s\S]{0,400}select array\['admin', 'recruiter', 'viewer'\]::text\[\];/
    );
    // The owner is excluded by identity, so it must never be added to the
    // metered list: that would be a second, contradictory exclusion mechanism.
    expect(sql).not.toMatch(/select array\[[^\]]*'owner'/);
  });

  it("derives the required seat count from the roster, excluding the owner by identity", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_org_required_seat_count\(p_org_id uuid\)/
    );
    // "active organization members excluding the owner". The owner is compared
    // by identity rather than by the 'owner' role, because the owner need not
    // hold a member row at all and may hold one in a metered role.
    expect(sql).toMatch(/and em\.user_id <> o\.owner_user_id;/);
    expect(sql).not.toMatch(/em\.role <> 'owner'/);
    // Metered only, read through the single policy function.
    expect(sql).toMatch(/and em\.role = any \(public\.odesseus_metered_org_roles\(\)\)/);
    // Org-scoped: a count for one org can never include another org's members.
    expect(sql).toMatch(/where em\.org_id = p_org_id/);
    // Derivation is a pure read of current state. That is what makes a retried
    // seat synchronization safe: recomputing gives the same answer.
    expect(sql).toMatch(/select count\(\*\)::integer/);
    expect(sql).toMatch(/STABLE/);
    // employer_members is SELECT-only to authenticated behind RLS, so this
    // needs SECURITY DEFINER -- and it returns a count, never member data.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_org_required_seat_count[\s\S]{0,400}SECURITY DEFINER/
    );
  });

  it("keeps the required-count function invisible to anon", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_org_required_seat_count\(uuid\) FROM PUBLIC/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_org_required_seat_count\(uuid\) FROM anon/
    );
    // Authenticated may read it: a team screen has to show what the roster
    // needs. It is a count scoped to one org, the same exposure as the
    // already-granted odesseus_org_live_seat_count.
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_org_required_seat_count\(uuid\)\s+TO authenticated, service_role;/
    );
  });

  it("re-says the seat cap in the accept RPC without re-listing the roles", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_accept_employer_invitation/);
    // The cap still reads the policy from the function rather than hardcoding
    // a role list, so the next policy change stays a one-line edit.
    expect(sql).toMatch(/v_metered\s+text\[\] := public\.odesseus_metered_org_roles\(\)/);
    expect(sql).not.toMatch(/v_metered\s+text\[\] := array\[/);
    // The refusal no longer names a single role.
    expect(sql).toMatch(
      /raise exception 'this team has no paid seats left; add a seat to invite another member';/
    );
    expect(sql).not.toMatch(/no recruiter seats left/);
  });

  it("keeps the accept RPC's email, lock, and idempotency guarantees intact", () => {
    // A replace of the function body must not quietly drop a guard.
    expect(sql).toMatch(/select \* into v_org\s+from public\.employer_organizations\s+where id = v_invitation\.org_id\s+for update;/);
    expect(sql).toMatch(
      /v_caller_email := lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/
    );
    expect(sql).toMatch(
      /if v_caller_email = '' or v_caller_email <> lower\(trim\(v_invitation\.email\)\) then/
    );
    expect(sql).toMatch(
      /on conflict on constraint employer_members_pkey do update\s+set role = excluded\.role;/
    );
    // An owner redeeming an invitation is not seat-metered.
    expect(sql).toMatch(
      /if v_invitation\.role = any \(v_metered\)\s+and not \(v_org\.owner_user_id = v_user_id\) then/
    );
  });

  it("does not rename the recruiter_seats product or its Stripe metadata", () => {
    // "Recruiter seat" stays the product name ($20/month, one per additional
    // employer-team seat) and odesseus_recruiter_seats / odesseus_seat_count
    // are the checkout fulfillment contract. Renaming them to match a policy
    // change would churn a paid billing path to fix a noun.
    expect(sqlOnly).not.toMatch(/ALTER TABLE public\.recruiter_seats/i);
    expect(sqlOnly).not.toMatch(/RENAME (COLUMN|TABLE|TABLE COLUMN)/i);
    expect(sqlOnly).not.toMatch(/odesseus_seat_count/);
    expect(sqlOnly).not.toMatch(/odesseus_recruiter_seats/);
    expect(sqlOnly).not.toMatch(/DROP/i);
  });

  it("is additive: no data is dropped or rewritten", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^UPDATE public\./i);
    // COMMENTs are documentation; they are the only writes to catalog objects.
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.odesseus_metered_org_roles\(\)/);
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.odesseus_org_required_seat_count\(uuid\)/);
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.odesseus_accept_employer_invitation\(text\)/);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.employer_members\.role/);
    expect(sql).toMatch(/COMMENT ON TABLE public\.recruiter_seats/);
  });

  it("does not touch candidate money, apply settlement, or plan quotas", () => {
    for (const table of [
      "credit_balances",
      "wallet_transactions",
      "pricing_products",
      "pricing_prices",
      "employer_subscriptions",
      "job_opportunities",
      "featured_listings",
      "job_reports",
      "notification_preferences",
    ]) {
      expect(sql).not.toMatch(new RegExp(`ALTER TABLE public\\.${table}`));
      expect(sql).not.toMatch(new RegExp(`INSERT INTO public\\.${table}`));
      expect(sql).not.toMatch(new RegExp(`UPDATE public\\.${table}`));
    }
    // Nor may it weaken the membership surface the seat policy sits on.
    expect(sql).not.toMatch(/ALTER TABLE public\.employer_members/i);
    expect(sql).not.toMatch(/CREATE POLICY .* ON public\.employer_members/i);
    expect(sql).not.toMatch(/GRANT .* ON TABLE public\.employer_members/i);
    expect(sql).not.toMatch(/GRANT .*recruiter_seats/i);
    expect(sql).not.toMatch(/REVOKE .*recruiter_seats/i);
  });
});
