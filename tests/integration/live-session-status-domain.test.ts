import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  LIVE_SESSION_IN_FLIGHT,
  LIVE_SESSION_STATUSES,
  LIVE_SESSION_TERMINAL,
  isLiveSessionInFlight,
  isLiveSessionSpentPass,
  isLiveSessionStatus,
  isLiveSessionTerminal,
  type LiveSessionStatus,
} from "@/lib/live/session-status";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261025000000_live_session_status_domain.sql";

const read = (relative: string) =>
  readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n/g, "\n");

const migration = read(MIGRATION);

/** Extract the status list from the CHECK constraint the migration installs.
 *
 * Anchored on the constraint name and on the closing paren of the IN list, so a
 * lazy `toContain` elsewhere in a 200-line file cannot satisfy this. */
function sqlStatusDomain(sql: string): string[] {
  const head =
    /ADD CONSTRAINT live_interview_sessions_status_check\s+CHECK\s*\(\s*status IN \(/.exec(sql);
  if (!head) return [];
  const start = head.index + head[0].length;
  const end = sql.indexOf(")", start);
  return sql
    .slice(start, end)
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

describe("live session status domain migration", () => {
  const domain = sqlStatusDomain(migration);

  it("parses a ten-value domain out of the constraint", () => {
    expect(domain).toHaveLength(10);
  });

  it("is additive: it rewrites no historical migration and no row", () => {
    expect(migration).not.toMatch(/^DROP TABLE/im);
    expect(migration).not.toMatch(/^DELETE FROM/im);
    expect(migration).not.toMatch(/^UPDATE public\./im);
    // It must not restate the old four-value domain as the new one.
    expect(migration).not.toMatch(
      /status_check' CHECK \(\(status = ANY \(ARRAY\['prepared'::text, 'active'::text/
    );
  });

  it("replaces the constraint rather than layering a second one", () => {
    // Dropping first is what makes this idempotent and what prevents two
    // constraints from both claiming to describe the domain.
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS live_interview_sessions_status_check;/
    );
    const dropIndex = migration.indexOf("DROP CONSTRAINT IF EXISTS");
    const addIndex = migration.indexOf("ADD CONSTRAINT live_interview_sessions_status_check");
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(addIndex).toBeGreaterThan(dropIndex);
  });

  it("adds a status+recency index for the global session reads", () => {
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS live_interview_sessions_status_created_idx/
    );
    expect(migration).toMatch(/\(status, created_at DESC\)/);
  });
});

describe("live session status domain: database and TypeScript agree", () => {
  const domain = sqlStatusDomain(migration);

  it("the SQL CHECK and the TypeScript constant are the same set", () => {
    // This is the assertion that stops the two halves drifting: the compiled-in
    // list and the stored constraint are compared as sets, in both directions.
    expect([...domain].sort()).toEqual([...LIVE_SESSION_STATUSES].sort());
  });

  it("neither side is silently empty, which would make the comparison vacuous", () => {
    expect(domain.length).toBeGreaterThan(0);
    expect(LIVE_SESSION_STATUSES.length).toBeGreaterThan(0);
  });

  it("has no duplicates on either side", () => {
    expect(new Set(domain).size).toBe(domain.length);
    expect(new Set(LIVE_SESSION_STATUSES).size).toBe(LIVE_SESSION_STATUSES.length);
  });
});

describe("in-flight and terminal partitions", () => {
  it("partition the domain exactly: in flight, terminal, and neither", () => {
    const neither = LIVE_SESSION_STATUSES.filter(
      (s) => !isLiveSessionInFlight(s) && !isLiveSessionTerminal(s)
    );
    expect([...neither].sort()).toEqual(["payment_required", "prepared"].sort());
  });

  it("in-flight and terminal never overlap", () => {
    for (const status of LIVE_SESSION_IN_FLIGHT) {
      expect(isLiveSessionTerminal(status)).toBe(false);
    }
  });

  it("in-flight matches the SQL predicate the migration installs", () => {
    const inFlight = /SELECT p_status IN \(([^)]*)\)/.exec(
      migration.replace(/\r\n/g, "\n")
    );
    expect(inFlight).not.toBeNull();
    const sqlValues = (inFlight![1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ""));
    expect([...sqlValues].sort()).toEqual([...LIVE_SESSION_IN_FLIGHT].sort());
  });

  it("treats payment_required as a dead end, not a live session", () => {
    // payment_required consumed no pass, so a candidate who hits it has not
    // started an interview and the session must not read as in flight.
    expect(isLiveSessionInFlight("payment_required")).toBe(false);
    expect(isLiveSessionSpentPass("payment_required")).toBe(true);
  });
});

describe("isLiveSessionStatus", () => {
  it("accepts every member of the domain", () => {
    for (const status of LIVE_SESSION_STATUSES) {
      expect(isLiveSessionStatus(status)).toBe(true);
    }
  });

  it("rejects anything the constraint would reject", () => {
    for (const value of [
      "live",
      "READY",
      "reconnecting",
      "ready_to_submit",
      "",
      " ",
      "active ",
    ]) {
      expect(isLiveSessionStatus(value)).toBe(false);
    }
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [null, undefined, 0, 1, true, {}, [], Symbol("active")]) {
      expect(isLiveSessionStatus(value)).toBe(false);
    }
  });
});

describe("database.ts narrows the status column", () => {
  const databaseTypes = read("src/types/database.ts");

  /** The live_interview_sessions entry, up to the next sibling table key. */
  function sessionTableBlock(): string {
    const start = databaseTypes.indexOf("      live_interview_sessions: {");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = databaseTypes.slice(start + 1);
    const next = /^ {6}\w+: \{$/m.exec(rest);
    expect(next).not.toBeNull();
    return rest.slice(0, next!.index);
  }

  it("types live_interview_sessions.status as the domain, not as string", () => {
    const sessionTable = sessionTableBlock();
    // Row, Insert and Update must all be narrowed, or one of the three still
    // accepts any string the constraint would reject.
    //
    // Anchored to the start of a line on purpose: an unanchored
    // `status\??: string;` also matches `live_pass_status?: string;` in the
    // neighbouring interviews table, which would make this assertion fail for
    // an unrelated reason -- or, worse, pass for the wrong one.
    expect(sessionTable).not.toMatch(/^\s*status\??: string;/m);
    expect(sessionTable).toMatch(/^\s*status: LiveSessionStatus;/m);
    expect(sessionTable).toMatch(/^\s*status\?: LiveSessionStatus;/m);
  });

  it("imports the domain type rather than redeclaring it", () => {
    expect(databaseTypes).toMatch(
      /import type \{ LiveSessionStatus \} from "@\/lib\/live\/session-status";/
    );
  });
});

describe("every status is grounded in real code", () => {
  /** Each status must be justified by a writer or a reader that exists today.
   * A status nobody produces and nobody checks is a value that only exists to
   * widen the constraint, which is the failure mode this whole file is about.
   *
   * The patterns match either quoting style because the lifecycle lives in SQL
   * functions. `prepared` and `recovering` use the loose form deliberately:
   * both are reserved domain members rather than actively minted states --
   * `prepared` is the legacy pre-consent state kept for historical rows
   * (prepare now delegates to odesseus_create_live_session, which mints
   * ready/payment_required), and `recovering` is reserved for the reconnect
   * path. Both remain listed in the CHECK constraint and the TypeScript
   * domain, which is the grounding this file requires. */
  const justification: Record<LiveSessionStatus, RegExp> = {
    prepared: /['"]prepared['"]/,
    ready: /status\s*[:=]\s*['"]ready['"]/,
    payment_required: /status\s*[:=]\s*['"]payment_required['"]/,
    starting: /status\s*[:=]\s*['"]starting['"]/,
    active: /status\s*[:=]\s*['"]active['"]/,
    recovering: /['"]recovering['"]/,
    completed: /status\s*[:=]\s*['"]completed['"]/,
    failed: /status\s*[:=]\s*['"]failed['"]/,
    expired: /status\s*[:=]\s*['"]expired['"]/,
    ended: /status\s*[:=]\s*['"]ended['"]/,
  };

  const shippedSql = readdirSync(path.join(repoRoot, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .map((file) => read(`supabase/migrations/${file}`))
    .join("\n");

  const liveRoutes = read("src/app/api/interviews/[id]/live/prepare/route.ts");
  const corpus = `${shippedSql}\n${liveRoutes}`;

  it("the grounding corpus is historical code, not the file under test", () => {
    // The new migration only mentions these statuses inside a CHECK list and in
    // prose, so it cannot satisfy any of the patterns below. This assertion
    // proves the corpus really is the pre-existing lifecycle.
    expect(corpus).toContain("odesseus_activate_live_session_v2");
    expect(shippedSql).toContain("odesseus_complete_live_session");
    // Prepare mints sessions only through the authoritative RPC, never by
    // direct insert: the route must delegate creation and must not read the
    // balances table to re-derive access.
    expect(liveRoutes).toContain("odesseus_create_live_session");
    expect(liveRoutes).not.toContain('from("credit_balances")');
    expect(liveRoutes).not.toContain("from('credit_balances')");
  });

  for (const status of LIVE_SESSION_STATUSES) {
    it(`'${status}' is written or read by shipped code`, () => {
      const pattern = justification[status];
      expect(pattern.source).toBeTruthy();
      expect(pattern.test(corpus)).toBe(true);
    });
  }
});
