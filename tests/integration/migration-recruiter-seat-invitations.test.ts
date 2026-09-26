import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261005000000_recruiter_seat_invitations.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

describe("recruiter seat invitations migration (M5 invitation slice)", () => {
  it("is additive: no drops, deletions, or RLS weakening", () => {
    expect(sql).not.toMatch(/^DROP TABLE/i);
    expect(sql).not.toMatch(/^DROP COLUMN/i);
    expect(sql).not.toMatch(/^DROP FUNCTION/i);
    expect(sql).not.toMatch(/^DELETE FROM/i);
    expect(sql).not.toMatch(/^DROP DATABASE/i);
    // The existing entitlement and membership tables keep their RLS and grants.
    expect(sql).not.toMatch(/ALTER TABLE public\.recruiter_seats/i);
    expect(sql).not.toMatch(/GRANT .*recruiter_seats/i);
    expect(sql).not.toMatch(/REVOKE .*recruiter_seats/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.employer_members/i);
    expect(sql).not.toMatch(/CREATE POLICY .* ON public\.employer_members/i);
    expect(sql).not.toMatch(/GRANT .* ON TABLE public\.employer_members/i);
  });

  it("adds an invitation table whose role list excludes owner", () => {
    expect(sql).toMatch(/CREATE TABLE public\.employer_member_invitations/);
    expect(sql).toMatch(
      /role\s+text NOT NULL CHECK \(role IN \('admin', 'recruiter', 'viewer'\)\)/
    );
    // The token is a bearer secret, so it must be unique and indexed.
    expect(sql).toMatch(/token\s+text NOT NULL/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX employer_member_invitations_token_idx\s+ON public\.employer_member_invitations \(token\)/
    );
    // One outstanding invite per person per org, case-insensitively.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX employer_member_invitations_pending_idx\s+ON public\.employer_member_invitations \(org_id, lower\(email\)\)\s+WHERE status = 'pending'/
    );
    // A revoked row must not block a fresh invite, which the partial index
    // guarantees; assert the index really is partial on pending.
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX[\s\S]{0,200}employer_member_invitations \(org_id, lower\(email\)\);/
    );
  });

  it("RLS-covers invitations and scopes every policy to an org admin", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.employer_member_invitations ENABLE ROW LEVEL SECURITY/
    );
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY "employer_member_invitations_${op}_admin_owner"[\\s\\S]{0,200}is_org_admin_or_owner\\(org_id\\)`,
          "i"
        )
      );
    }
    // invited_by is pinned to the caller so an admin cannot forge authorship.
    expect(sql).toMatch(/AND invited_by = auth\.uid\(\)/);
    // No policy hands a row to the invitee: redemption is the RPC only.
    expect(sql).not.toMatch(/WITH CHECK \(\s*auth\.uid\(\) = user_id/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.employer_member_invitations FROM anon, authenticated/);
  });

  it("expresses the seat-metered roles in exactly one place", () => {
    // As shipped in M5, the metered set was the recruiter role alone. The
    // approved policy has since widened it to every invitable role, so this
    // asserts the shape the current policy migration relies on (a single
    // replaceable function the accept RPC reads) rather than the M5 role list.
    // The current role set is asserted in migration-employer-seat-policy.test.ts.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_metered_org_roles\(\)[\s\S]{0,400}select array\['recruiter'\]::text\[\];/
    );
    // The accept RPC must read the policy from that function, never re-list it.
    expect(sql).toMatch(/v_metered\s+text\[\] := public\.odesseus_metered_org_roles\(\)/);
    expect(sql).not.toMatch(/v_metered\s+text\[\] := array\['recruiter'\]/);
    // A plain count() is not entitlement arithmetic.
    expect(sql).not.toMatch(/select array\['admin'/);
  });

  it("counts only live paid seats toward capacity", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_org_live_seat_count\(p_org_id uuid\)/);
    expect(sql).toMatch(/select coalesce\(sum\(rs\.count\), 0\)::integer/);
    expect(sql).toMatch(/and rs\.count > 0/);
    // A lapsed or voided paid period must stop granting capacity.
    expect(sql).toMatch(/and \(rs\.active_until is null or rs\.active_until > now\(\)\)/);
    expect(sql).toMatch(
      /SET search_path TO 'public', 'odesseus_private', 'pg_temp'/
    );
    // It reads recruiter_seats, which members may not read directly, so it is
    // SECURITY DEFINER and returns a count rather than rows.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_org_live_seat_count[\s\S]{0,400}SECURITY DEFINER/
    );
  });

  it("makes the accept RPC atomic on the org row so concurrent accepts serialize", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.odesseus_accept_employer_invitation/);
    // The lock is the entire reason this is a function and not route code.
    expect(sql).toMatch(
      /select \* into v_org\s+from public\.employer_organizations\s+where id = v_invitation\.org_id\s+for update;/
    );
    // Capacity is re-read inside the lock, never before it.
    expect(sql).toMatch(
      /v_capacity := public\.odesseus_org_live_seat_count\(v_invitation\.org_id\);/
    );
    const lockAt = sql.indexOf("for update;");
    const capacityAt = sql.indexOf("v_capacity := public.odesseus_org_live_seat_count");
    expect(lockAt).toBeGreaterThan(-1);
    expect(capacityAt).toBeGreaterThan(lockAt);
  });

  it("requires the caller's own verified email, not just the token", () => {
    expect(sql).toMatch(
      /v_caller_email := lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/
    );
    expect(sql).toMatch(
      /if v_caller_email = '' or v_caller_email <> lower\(trim\(v_invitation\.email\)\) then/
    );
    expect(sql).toMatch(
      /raise exception 'this invitation was sent to a different email address'/
    );
  });

  it("fails closed on token, state, and expiry before touching membership", () => {
    expect(sql).toMatch(/if v_user_id is null then\s+raise exception 'sign in to accept this invitation';/);
    expect(sql).toMatch(/if p_token is null or length\(trim\(p_token\)\) < 16 then/);
    expect(sql).toMatch(/if v_invitation\.status <> 'pending' then/);
    expect(sql).toMatch(/if v_invitation\.expires_at <= now\(\) then/);
    // No membership write may precede the guards.
    const insertAt = sql.indexOf("insert into public.employer_members");
    for (const guard of [
      "this invitation was sent to a different email address",
      "this invitation has expired",
      "this invitation has already been",
    ]) {
      expect(sql.indexOf(guard)).toBeGreaterThan(-1);
      expect(sql.indexOf(guard)).toBeLessThan(insertAt);
    }
  });

  it("makes membership idempotent via the primary key constraint", () => {
    // The conflict target names the constraint explicitly, because a RETURNS
    // TABLE column called org_id or role would otherwise shadow it.
    expect(sql).toMatch(
      /on conflict on constraint employer_members_pkey do update\s+set role = excluded\.role;/
    );
    // And the output columns are named so they cannot collide with the body.
    expect(sql).toMatch(/joined_org_id\s+uuid/);
    expect(sql).toMatch(/joined_role\s+text/);
    expect(sql).not.toMatch(/RETURNS TABLE \(\s*org_id\s+uuid/);
  });

  it("grants execute narrowly", () => {
    // Anonymous can never redeem.
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_accept_employer_invitation\(text\) FROM PUBLIC/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_accept_employer_invitation\(text\) FROM anon/
    );
    // Authenticated can, because redeeming your own invitation is the point; the
    // email match and the org lock, not RLS, are the authorization here.
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_accept_employer_invitation\(text\)\s+TO authenticated, service_role;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_org_live_seat_count\(uuid\) TO authenticated, service_role;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_metered_org_roles\(\) FROM authenticated/
    );
  });

  it("does not touch candidate money paths", () => {
    for (const table of [
      "credit_balances",
      "wallet_transactions",
      "pricing_products",
      "pricing_prices",
      "job_reports",
      "notification_preferences",
    ]) {
      expect(sql).not.toMatch(new RegExp(`ALTER TABLE public\\.${table}`));
      expect(sql).not.toMatch(new RegExp(`INSERT INTO public\\.${table}`));
      expect(sql).not.toMatch(new RegExp(`UPDATE public\\.${table}`));
    }
  });
});
