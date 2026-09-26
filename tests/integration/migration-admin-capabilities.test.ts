import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20261009000000_admin_capabilities_and_audit.sql"
);

const sql = readFileSync(MIGRATION, "utf8");

/** The migration body with `--` comments removed, so an assertion about an
 * identifier cannot be satisfied by a sentence in the header prose. */
const sqlOnly = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("admin audit log table", () => {
  it("exists as an append-only table with no foreign key on the actor", () => {
    expect(sqlOnly).toMatch(/CREATE TABLE public\.admin_audit_log/i);

    // An FK would either delete the evidence when an admin account is removed
    // or blank the actor. "We deleted the account" is not an acceptable answer
    // to "who changed this candidate's balance".
    const createTable = sqlOnly.slice(
      sqlOnly.toUpperCase().indexOf("CREATE TABLE PUBLIC.ADMIN_AUDIT_LOG")
    );
    const body = createTable.slice(0, createTable.indexOf(");"));
    expect(body).not.toMatch(/REFERENCES/i);
  });

  it("enables row-level security with a deny policy for browser roles", () => {
    expect(sqlOnly).toMatch(
      /ALTER TABLE public\.admin_audit_log ENABLE ROW LEVEL SECURITY/i
    );
    expect(sqlOnly).toMatch(
      /CREATE POLICY "admin_audit_log_deny_browser_access"[\s\S]*?FOR ALL TO anon, authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/i
    );
  });

  it("revokes the write privileges Supabase grants by default", () => {
    // REVOKE ALL FROM PUBLIC is not enough: Supabase's default privileges give
    // service_role ALL on new public tables, so without this the "append-only"
    // claim is silently false. rls-audit.test.sql asserts the resulting grants
    // against the live database; this pins that the migration asks for it.
    expect(sqlOnly).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.admin_audit_log FROM service_role/i
    );
    expect(sqlOnly).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.admin_audit_log FROM PUBLIC/i
    );
    expect(sqlOnly).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.admin_audit_log FROM anon, authenticated/i
    );
  });

  it("grants read but never write to service_role", () => {
    const grants = sqlOnly.match(
      /GRANT\s+([A-Z,\s]+?)\s+ON TABLE public\.admin_audit_log TO[^\n]*/gi
    );
    expect(grants).not.toBeNull();
    for (const grant of grants!) {
      expect(grant).toMatch(/GRANT SELECT/i);
      expect(grant).not.toMatch(/INSERT|UPDATE|DELETE|ALL/i);
    }
  });

  it("constrains the actor role to the three the roster allows", () => {
    expect(sqlOnly).toMatch(
      /CHECK \(actor_role IN \('admin', 'marketing_admin', 'finance_admin'\)\)/i
    );
  });

  it("accepts a dotted namespaced action and rejects anything else", () => {
    // The action is `job_report.status_changed`, so the CHECK has to allow one
    // dot. A pattern that rejected dots would have rejected every real action --
    // which is exactly what happened the first time this was written.
    //
    // The pattern is lifted out of its string literal rather than rebuilt from a
    // balanced-paren scan: the pattern itself contains a group, so any
    // `[^)]*` capture truncates it mid-expression.
    const check = sqlOnly.match(
      /admin_audit_log_action_check\s*\n?\s*CHECK\s*\(\s*action\s*~\s*'([^']+)'/i
    );
    expect(check).not.toBeNull();

    const pattern = new RegExp(check![1], "");
    expect(pattern.test("job_report.status_changed")).toBe(true);
    expect(pattern.test("wallet.adjusted")).toBe(true);
    expect(pattern.test("job_report")).toBe(true);
    expect(pattern.test("Job_Report.Changed")).toBe(false);
    expect(pattern.test("job report changed")).toBe(false);
    expect(pattern.test("job_report.status_changed.extra")).toBe(false);
    // Case-insensitive only because the SQL regex engine is applied to
    // lower-cased input; the pattern itself must stay case-sensitive.
    expect(pattern.flags).not.toContain("i");
  });

  it("constrains the subject type to a bare identifier, with no dot", () => {
    // The subject is what a reviewer searches by, and it is always one kind of
    // thing. Allowing a dot here would let a subject type quietly become a
    // namespace, and then the (subject_type, subject_id) index stops meaning
    // "everything that happened to this thing".
    const check = sqlOnly.match(
      /admin_audit_log_subject_type_check\s*\n?\s*CHECK\s*\(\s*subject_type\s*~\s*'([^']+)'/i
    );
    expect(check).not.toBeNull();
    const pattern = new RegExp(check![1], "");
    expect(pattern.test("job_report")).toBe(true);
    expect(pattern.test("job_report.status")).toBe(false);
    expect(pattern.test("JobReport")).toBe(false);
  });

  it("indexes the subject and the recency, which are the two things a reviewer searches by", () => {
    expect(sqlOnly).toMatch(
      /CREATE INDEX admin_audit_log_subject_idx\s+ON public\.admin_audit_log \(subject_type, subject_id\)/i
    );
    expect(sqlOnly).toMatch(
      /CREATE INDEX admin_audit_log_created_at_idx\s+ON public\.admin_audit_log \(created_at DESC\)/i
    );
  });
});

describe("odesseus_record_admin_action", () => {
  it("is service-role only", () => {
    expect(sqlOnly).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_record_admin_action\([^)]*\) FROM PUBLIC/i
    );
    expect(sqlOnly).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_record_admin_action\([^)]*\) FROM anon/i
    );
    expect(sqlOnly).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_record_admin_action\([^)]*\) FROM authenticated/i
    );
    expect(sqlOnly).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_record_admin_action\([^)]*\) TO postgres, service_role/i
    );
  });

  it("is SECURITY DEFINER, because the table grants no INSERT to anyone", () => {
    expect(sqlOnly).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_record_admin_action[\s\S]*?SECURITY DEFINER/i
    );
  });

  it("rejects an actor role that is not a current one", () => {
    expect(sqlOnly).toMatch(
      /if p_actor_role not in \('admin', 'marketing_admin', 'finance_admin'\) then\s+raise exception 'unknown admin role: %'/i
    );
  });
});

describe("odesseus_update_job_report_status becomes audited", () => {
  it("drops the unaudited four-argument overload rather than leaving it behind", () => {
    // A surviving overload is an unaudited moderation path, which is the exact
    // hole the migration exists to close.
    expect(sqlOnly).toMatch(
      /DROP FUNCTION IF EXISTS public\.odesseus_update_job_report_status\(uuid, text, text\)/i
    );
  });

  it("requires an actor", () => {
    expect(sqlOnly).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_update_job_report_status \([\s\S]*?p_actor_user_id  uuid/i
    );
  });

  it("passes named arguments to the audit RPC, not positional ones", () => {
    // An earlier draft passed the actor's email and the report id positionally
    // and the transaction committed with them swapped. Two adjacent text
    // parameters is exactly where a positional call fails silently.
    const call = sqlOnly.match(
      /perform public\.odesseus_record_admin_action\([\s\S]*?\);/i
    );
    expect(call).not.toBeNull();
    expect(call![0]).toMatch(/p_actor_email\s*=>/);
    expect(call![0]).toMatch(/p_subject_id\s*=>/);
    // No bare positional argument before the first named one.
    expect(call![0]).not.toMatch(/record_admin_action\(\s*\n?\s*p_actor_user_id\s*,/i);
  });

  it("records the previous status, so the transition is a true before/after pair", () => {
    expect(sqlOnly).toMatch(
      /select status\s+into v_previous[\s\S]*?for update/i
    );
    expect(sqlOnly).toMatch(/'from', v_previous/i);
  });

  it("locks the report row before reading the previous status", () => {
    // Without the lock, two admins transitioning the same report concurrently
    // can both record themselves as moving it out of `new`.
    const lockIndex = sqlOnly.search(/for update;/i);
    const auditIndex = sqlOnly.search(/job_report\.status_changed/i);
    expect(lockIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(lockIndex);
  });

  it("preserves the original status validation and moderation-note semantics", () => {
    expect(sqlOnly).toMatch(
      /if p_status not in \('reviewing', 'resolved', 'dismissed'\) then/i
    );
    expect(sqlOnly).toMatch(/raise exception 'unknown job report moderation status: %'/i);
    expect(sqlOnly).toMatch(/raise exception 'job report not found'/i);
    // The original coalesced the note so a blank moderation pass does not erase
    // an earlier one. Silently replacing that with a straight assignment would
    // destroy moderator history.
    expect(sqlOnly).toMatch(/moderation_note = coalesce\(p_note, moderation_note\)/i);
  });

  it("revokes the browser roles on the new signature too", () => {
    expect(sqlOnly).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_update_job_report_status\(uuid, text, text, uuid, text, text\) FROM authenticated/i
    );
    expect(sqlOnly).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_update_job_report_status\(uuid, text, text, uuid, text, text\) TO postgres, service_role/i
    );
  });
});

describe("the migration stays additive and non-destructive", () => {
  it("creates no table other than the audit log", () => {
    const created = sqlOnly.match(/CREATE TABLE\s+(?!IF NOT EXISTS)\S+/gi) ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/public\.admin_audit_log/i);
  });

  it("creates no function other than the two it replaces or adds", () => {
    const created = sqlOnly.match(/CREATE (?:OR REPLACE )?FUNCTION\s+\S+/gi) ?? [];
    expect(created).toHaveLength(2);
    expect(created[0]).toMatch(/odesseus_record_admin_action/i);
    expect(created[1]).toMatch(/odesseus_update_job_report_status/i);
  });

  it("drops no column and no existing table", () => {
    expect(sqlOnly).not.toMatch(/DROP TABLE/i);
    expect(sqlOnly).not.toMatch(/DROP COLUMN/i);
    expect(sqlOnly).not.toMatch(/TRUNCATE /i);
    expect(sqlOnly).not.toMatch(/DELETE FROM/i);
  });

  it("touches no candidate wallet, apply settlement, or pricing table", () => {
    // Phase boundaries are worth pinning: a hardening migration that quietly
    // edits the money path is how a hardening migration becomes the incident.
    for (const table of [
      "credit_balances",
      "credit_transactions",
      "credit_ledger",
      "application_runs",
      "applications",
      "employer_subscriptions",
      "employer_job_post_credits",
      "pricing_prices",
    ]) {
      expect(sqlOnly).not.toMatch(
        new RegExp(`(ALTER|UPDATE|DELETE FROM|INSERT INTO)\\s+(public\\.)?${table}\\b`, "i")
      );
    }
  });

  it("leaves the existing admin_users grant surface alone", () => {
    // It was already server-only in the M9 hardening migration. Broadening it
    // here to let a browser read a role would be a large, quiet regression.
    expect(sqlOnly).not.toMatch(
      /GRANT[^;]*ON TABLE public\.admin_users TO (anon|authenticated)/i
    );
  });
});
