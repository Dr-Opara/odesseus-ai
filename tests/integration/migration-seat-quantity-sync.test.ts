import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261008000000_seat_quantity_sync.sql";
// The repository stores LF, but Windows checkouts (core.autocrlf) may
// materialize CRLF; make regexes line-ending agnostic.
const sql = readFileSync(path.join(repoRoot, MIGRATION), "utf8").replace(/\r\n/g, "\n");

/** The migration with `--` comments removed, for negative assertions. */
const sqlOnly = sql.replace(/--[^\n]*/g, "");

const REQ = "odesseus_org_required_seat_count";
const CLAIM = "odesseus_claim_seat_adjustment";
const FINISH = "odesseus_finish_seat_adjustment";
const LIVE_SUB = "odesseus_org_live_seat_subscription";
const CLAIM_SIG = "public.odesseus_claim_seat_adjustment(text, uuid, integer, uuid, text, integer)";
const FINISH_SIG = "public.odesseus_finish_seat_adjustment(text, text, text)";

describe("seat quantity synchronization migration", () => {
  it("records an audit row per synchronization attempt, keyed for duplicate detection", () => {
    expect(sql).toMatch(
      /CREATE TABLE public\.employer_seat_adjustments \([\s\S]*?idempotency_key\s+text\s+UNIQUE/
    );
    // The audit must record what we asked Stripe to do and what happened, or it
    // is not an audit trail.
    expect(sql).toMatch(/stripe_subscription_id text/);
    expect(sql).toMatch(/previous_quantity\s+integer/);
    expect(sql).toMatch(/new_quantity\s+integer\s+NOT NULL CHECK \(new_quantity >= 0\)/);
    expect(sql).toMatch(/outcome\s+text\s+NOT NULL DEFAULT 'pending'/);
    expect(sql).toMatch(/removed_user_id\s+uuid/);
  });

  it("keeps the audit table invisible to browsers at two independent layers", () => {
    // Layer one: no privileges. Layer two: a deny-all RLS policy, so a later
    // migration that re-grants a privilege still cannot leak these rows.
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.employer_seat_adjustments FROM anon, authenticated;/
    );
    expect(sql).toMatch(
      /GRANT ALL PRIVILEGES ON TABLE public\.employer_seat_adjustments TO postgres, service_role;/
    );
    expect(sql).toMatch(/ALTER TABLE public\.employer_seat_adjustments ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(
      /CREATE POLICY "employer_seat_adjustments_deny_browser_access"[\s\S]{0,200}FOR ALL\s+TO anon, authenticated\s+USING \(false\)\s+WITH CHECK \(false\);/
    );
  });

  it("stops duplicate execution in the database, not in the calling process", () => {
    expect(sql).toMatch(
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${CLAIM}\\s*\\([\\s\\S]*?RETURNS boolean`)
    );
    // ON CONFLICT DO NOTHING plus `return found` is what makes a second
    // execution of the same adjustment a no-op that the caller can branch on,
    // rather than a raised unique violation. Two concurrent invocations both
    // pass any in-process check, so the guarantee has to be the index.
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing;/);
    expect(sql).toMatch(/return found;/);
  });

  it("validates the claim input rather than trusting the caller", () => {
    // A key shorter than this cannot be a legitimate deterministic key, and a
    // negative quantity would ask Stripe for a nonsensical resize.
    expect(sql).toMatch(
      /if p_idempotency_key is null or length\(trim\(p_idempotency_key\)\) < 8 then/
    );
    expect(sql).toMatch(/raise exception 'invalid seat adjustment idempotency key';/);
    expect(sql).toMatch(/if p_new_quantity is null or p_new_quantity < 0 then/);
    expect(sql).toMatch(/raise exception 'invalid target seat quantity: %', p_new_quantity;/);
  });

  it("releases the claim on failure so the adjustment can be retried", () => {
    expect(sql).toMatch(
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${FINISH}\\s*\\([\\s\\S]*?RETURNS void`)
    );
    // Without this, one transient Stripe outage would block that exact
    // adjustment from ever being attempted again.
    expect(sql).toMatch(
      /idempotency_key = case when p_outcome = 'failed' then null else idempotency_key end/
    );
  });

  it("rejects an outcome the audit table cannot store", () => {
    // 'pending' is deliberately excluded: only a claimed adjustment may be
    // finished, and letting a caller re-pend a finished row would resurrect it.
    const known = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FINISH}`));
    const guard = known.slice(0, known.indexOf("begin;"));
    expect(guard).toMatch(/if p_outcome not in \(/);
    for (const outcome of [
      "updated",
      "cancelled_at_period_end",
      "no_change",
      "skipped_no_subscription",
      "failed",
    ]) {
      expect(guard).toMatch(new RegExp(`'${outcome}'`));
    }
    expect(guard).not.toMatch(/'pending'/);
    expect(sql).toMatch(/raise exception 'unknown seat adjustment outcome: %', p_outcome;/);
  });

  it("fails closed when an outcome is recorded against a claim that does not exist", () => {
    // Silently returning would let a caller believe it recorded an adjustment
    // that no longer exists -- and an unfindable claim can never be released.
    expect(sql).toMatch(/raise exception 'seat adjustment claim not found: %', p_idempotency_key;/);
  });

  it("only finds a seat subscription that is still paid for", () => {
    expect(sql).toMatch(
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${LIVE_SUB}\\s*\\(p_org_id uuid\\)`)
    );
    // An expired period must not be mistaken for a paid month, or the sync
    // would resize a subscription the customer has already stopped paying for.
    expect(sql).toMatch(/and \(rs\.active_until is null or rs\.active_until > now\(\)\)/);
    expect(sql).toMatch(/and rs\.count > 0/);
    // Org-scoped, and it returns Stripe identifiers, so it is service-role only.
    expect(sql).toMatch(/where rs\.org_id = p_org_id/);
    expect(sql).toMatch(
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${LIVE_SUB}\\(uuid\\) FROM PUBLIC;[\\s\\S]*?REVOKE ALL ON FUNCTION public\\.${LIVE_SUB}\\(uuid\\) FROM authenticated;`
      )
    );
  });

  it("revokes every new function from the public and browser roles", () => {
    // SECURITY DEFINER functions are executable by PUBLIC by default. A browser
    // caller could otherwise claim seat adjustments, or read another org's Stripe
    // subscription id, through PostgREST.
    for (const sig of [
      CLAIM_SIG,
      FINISH_SIG,
      `public.${LIVE_SUB}(uuid)`,
    ]) {
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION ${sig.replace(/[()]/g, "\\$&")} FROM PUBLIC;`)
      );
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION ${sig.replace(/[()]/g, "\\$&")} FROM authenticated;`)
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${sig.replace(/[()]/g, "\\$&")} TO postgres, service_role;`)
      );
    }
  });

  it("never writes the entitlement this table describes", () => {
    // The audit records what we asked Stripe to do. Granting a seat stays
    // exclusively the job of the money-verified webhook path, so a bug in the
    // synchronization cannot hand out free seats.
    expect(sqlOnly).not.toMatch(/insert into public\.recruiter_seats/i);
    expect(sqlOnly).not.toMatch(/update public\.recruiter_seats/i);
    expect(sqlOnly).not.toMatch(/odesseus_sync_recruiter_seat\s*\(/);
  });

  it("reads the roster rather than keeping a seat counter", () => {
    // A counter would double-adjust under a retry. A derived read converges.
    expect(sqlOnly).not.toMatch(/required_seats\s+(integer|int)/i);
    expect(sql).toMatch(/never tracked as a counter[\s\S]{0,120}recomputed/i);
    // This migration only READS the roster; it must not touch membership.
    expect(sqlOnly).not.toMatch(/(insert into|update|delete from)\s+public\.employer_members/i);
  });

  it("keeps the money path and the roster untouched", () => {
    // Guard rails against scope creep in a billing migration: none of these are
    // this migration's to change.
    expect(sqlOnly).not.toMatch(/(insert into|update|delete from)\s+public\.credit_balances/i);
    expect(sqlOnly).not.toMatch(/(insert into|update|delete from)\s+public\.credit_transactions/i);
    expect(sqlOnly).not.toMatch(/(insert into|update|delete from)\s+public\.employer_subscriptions/i);
    expect(sqlOnly).not.toMatch(/(insert into|update|delete from)\s+public\.job_reports/i);
  });
});
