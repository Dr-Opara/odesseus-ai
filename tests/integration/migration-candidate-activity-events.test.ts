import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_ACTIVITY_EVENT_TYPES } from "@/lib/candidate/activity";

/**
 * Binds the two halves of the activity contract together.
 *
 * The TypeScript list and the SQL CHECK constraint are separate copies of the
 * same seventeen values, and two copies drift. A value added to the migration
 * and forgotten here would be emitted by a trigger and then silently dropped by
 * the dashboard, which is the exact failure this vocabulary exists to prevent.
 * So both directions are asserted, against the migration file itself rather
 * than against a restatement of it.
 */

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261027000000_candidate_activity_events.sql"
);

const migration = readFileSync(migrationPath, "utf8");

/**
 * Pulls the quoted literals out of the event_type CHECK.
 *
 * Anchored on the constraint name and taken from the first `ARRAY[...]` that
 * follows it, so this reads the actual constraint rather than any other list of
 * strings the file happens to contain.
 */
function eventTypesInSql(): string[] {
  const constraintStart = migration.indexOf(
    "CONSTRAINT candidate_activity_events_event_type_check"
  );
  expect(constraintStart).toBeGreaterThan(-1);

  const arrayStart = migration.indexOf("ARRAY[", constraintStart);
  const arrayEnd = migration.indexOf("]", arrayStart);
  expect(arrayStart).toBeGreaterThan(constraintStart);
  expect(arrayEnd).toBeGreaterThan(arrayStart);

  return [...migration.slice(arrayStart + "ARRAY[".length, arrayEnd).matchAll(/'([a-z_]+)'::text/g)]
    .map((match) => match[1])
    .filter((value) => value.length > 0);
}

describe("the activity event domain", () => {
  it("is the same set in SQL and in TypeScript, in both directions", () => {
    const sql = new Set(eventTypesInSql());
    const ts = new Set<string>(CANDIDATE_ACTIVITY_EVENT_TYPES);

    const onlyInSql = [...sql].filter((v) => !ts.has(v));
    const onlyInTs = [...ts].filter((v) => !sql.has(v));

    expect({
      onlyInSql,
      onlyInTs,
      sqlSize: sql.size,
      tsSize: ts.size,
    }).toEqual({ onlyInSql: [], onlyInTs: [], sqlSize: 17, tsSize: 17 });
  });

  it("has no duplicate in the SQL list, which a CHECK would silently accept", () => {
    const values = eventTypesInSql();
    expect(new Set(values).size).toBe(values.length);
  });

  it("names the seventeen events the milestone requires", () => {
    // Grouped by the candidate's own mental model rather than by the order the
    // events fire, which is the grouping the UI will use.
    const values = eventTypesInSql();
    const groups: Record<string, string[]> = {
      findingWork: ["job_matched", "job_saved"],
      preparing: ["resume_uploaded", "resume_optimized"],
      applying: [
        "application_queued",
        "application_needs_review",
        "application_needs_input",
        "application_held",
        "application_submitted",
        "application_verified",
        "application_failed",
      ],
      interviewing: ["interview_added", "mock_interview_completed"],
      money: ["wallet_charged", "wallet_topped_up"],
      automation: ["agent_paused", "agent_resumed"],
    };
    const flattened = Object.values(groups).flat();
    expect(flattened.sort()).toEqual([...values].sort());
  });
});

describe("the activity table", () => {
  it("is owner-scoped for reads and has no write policy at all", () => {
    // A candidate who can insert their own "wallet topped up" row can invent
    // money, so the absence of a write policy is a security property and not a
    // missing feature.
    expect(migration).toMatch(
      /ENABLE ROW LEVEL SECURITY/i
    );
    expect(migration).toMatch(
      /CREATE POLICY candidate_activity_events_select_own[\s\S]*?FOR SELECT TO authenticated[\s\S]*?auth\.uid\(\)/
    );
    expect(migration).not.toMatch(
      /CREATE POLICY candidate_activity_events_(insert|update|delete)/i
    );
  });

  it("grants read and nothing more to the browser", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.candidate_activity_events FROM anon/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.candidate_activity_events FROM authenticated/
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE public\.candidate_activity_events TO authenticated/
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*candidate_activity_events[^;]*TO (anon|authenticated)/i
    );
  });

  it("makes the recorder unable to abort the transaction it is recording", () => {
    // The wallet settlement and application finalization both call it. A feed
    // that can roll back a real application is worse than a feed that misses a
    // line, so the error handler is deliberate rather than a debug leftover.
    const fnStart = migration.indexOf(
      "FUNCTION odesseus_private.record_candidate_activity"
    );
    const fnEnd = migration.indexOf("AS $function$", fnStart);
    const body = migration.slice(fnStart, migration.indexOf("$function$;", fnEnd));

    expect(body).toMatch(/exception\s+when\s+others\s+then/i);
    expect(body).toMatch(/raise\s+warning/i);
    expect(body).toMatch(/on conflict \(user_id, dedupe_key\)/i);
  });

  it("revokes the recorder from every role that could reach it from a browser", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION odesseus_private\.record_candidate_activity\([\s\S]*?\) FROM PUBLIC, anon, authenticated/
    );
  });

  it("emits the wallet events from a trigger rather than from a call site", () => {
    // Roughly twenty RPCs insert into credit_transactions. A service that
    // remembered to record each one would eventually miss one.
    expect(migration).toMatch(
      /CREATE TRIGGER trg_candidate_activity_credit_transaction[\s\S]*?AFTER INSERT ON public\.credit_transactions/
    );
  });

  it("never uses a column that nothing maintains as an event time", () => {
    // updated_at has a now() default and no trigger, so it is frozen at insert
    // time. Using it would date a candidate's whole feed to the day they started
    // looking -- plausible-looking and wrong.
    expect(migration).not.toMatch(/new\.updated_at/);
    expect(migration).toMatch(/clock_timestamp\(\)/);
  });

  it("never references a provider-integration table in SQL", () => {
    // The migrations name these tables in prose, because explaining what a file
    // deliberately does not do is worth doing -- so the check strips `--`
    // comments first and looks for a reference in a query position in the
    // remaining SQL.
    const sqlOnly = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    for (const table of [
      "external_signals",
      "application_status_events",
      "integration_accounts",
      "integration_connections",
    ]) {
      const reference = new RegExp(
        `(from|join|into|update)\\s+(public\\.)?${table}\\b`,
        "i"
      );
      expect({ table, referenced: reference.test(sqlOnly) }).toEqual({
        table,
        referenced: false,
      });
    }
  });
});

describe("the dashboard counts function", () => {
  const countsPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261028000000_candidate_dashboard_counts.sql"
  );
  const counts = readFileSync(countsPath, "utf8");

  it("enforces its own ownership check rather than trusting the caller", () => {
    // SECURITY DEFINER means RLS is not protecting the caller while this runs,
    // so the function has to make the check itself.
    expect(counts).toMatch(/SECURITY DEFINER/);
    expect(counts).toMatch(/auth\.uid\(\)/);
    expect(counts).toMatch(/raise exception 'Not permitted' USING ERRCODE = '42501'/);
    expect(counts).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, anon/);
  });

  it("never references a provider-integration table in SQL", () => {
    // The migrations name these tables in prose (and the activity migration's
    // own design notes explain that), so the check strips `--` comments first
    // and looks for a reference in a query position in the remaining SQL.
    const sqlOnly = counts
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    for (const table of [
      "external_signals",
      "application_status_events",
      "integration_accounts",
      "integration_connections",
    ]) {
      const reference = new RegExp(
        `(from|join|into|update)\\s+(public\\.)?${table}\\b`,
        "i"
      );
      expect({ table, referenced: reference.test(sqlOnly) }).toEqual({
        table,
        referenced: false,
      });
    }
  });

  it("uses the candidate's own threshold, clamped, and never a hardcoded one", () => {
    expect(counts).toMatch(/p_strong_match_threshold integer DEFAULT 85/);
    expect(counts).toMatch(/greatest\(0, least\(100, coalesce\(p_strong_match_threshold, 85\)\)\)/);
  });

  it("excludes closed and rejected postings from the search", () => {
    // Otherwise "jobs discovered" grows forever as roles expire underneath the
    // candidate, and the number stops meaning anything.
    expect(counts).toMatch(/status not in \('closed', 'rejected'\)/);
  });
});
