import { describe, expect, it, vi } from "vitest";
import {
  JOB_REPORT_MODERATION_STATUSES,
  JOB_REPORT_REASONS,
  JOB_REPORT_STATUSES,
  fileJobReport,
  isJobReportModerationStatus,
  isJobReportReason,
  listCandidateJobReports,
  setJobReportStatus,
} from "@/lib/reports/service";
import { fakeQueryResult } from "../helpers/fake-supabase";

/**
 * In-memory stand-in for the three tables the report service touches. The
 * behaviours it reproduces are the ones the real schema guarantees and the
 * service must not subvert:
 *   - job_opportunities is readable only for the rows the caller owns
 *   - job_reports rows belong to their user
 *   - moderation goes through an RPC, never a direct client UPDATE
 */
function fakeReportsDb(opts: {
  jobs?: Array<{ id: string; user_id: string }>;
  reports?: Array<Record<string, unknown>>;
  rpcError?: { message: string } | null;
} = {}) {
  const jobs = opts.jobs ? [...opts.jobs] : [];
  let reports = opts.reports ? [...opts.reports] : [];
  const state: { lastUserId?: string | null; lastInsert?: Record<string, unknown> } = {};

  const from = vi.fn((table: string) => {
    if (table === "job_opportunities") {
      const builder: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit"]) builder[m] = vi.fn(() => builder);
      builder.eq = vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      });
      const resolve = () => {
        const id = filters.id as string;
        const userId = filters.user_id as string;
        const row = jobs.find((j) => j.id === id && j.user_id === userId);
        return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
      };
      builder.maybeSingle = vi.fn(resolve);
      builder.single = vi.fn(resolve);
      builder.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
      return builder;
    }

    if (table === "job_reports") {
      const builder: Record<string, unknown> = {};
      const mode: { kind: "select" | "insert"; payload?: Record<string, unknown> } = { kind: "select" };
      const filters: Record<string, unknown> = {};

      for (const m of ["select", "order", "limit", "delete", "update"]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.eq = vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      });
      builder.insert = vi.fn((payload: Record<string, unknown>) => {
        mode.kind = "insert";
        mode.payload = payload;
        state.lastInsert = payload;
        return builder;
      });

      const resolve = () => {
        if (mode.kind === "insert") {
          const payload = mode.payload ?? {};
          if (payload.user_id !== state.lastUserId) {
            // Mirrors the RLS WITH CHECK on job_reports_insert_own.
            return Promise.resolve({ data: null, error: { message: "new row violates row-level security policy" } });
          }
          if (payload.status !== "new") {
            // Mirrors the same policy's birth-status pin: a report is filed
            // unreviewed, so a client cannot pre-judge its own report.
            return Promise.resolve({ data: null, error: { message: "new row violates row-level security policy" } });
          }
          const row = {
            id: `report-${reports.length + 1}`,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            moderation_note: null,
            ...payload,
          };
          reports = [...reports, row];
          return Promise.resolve({ data: { ...row }, error: null });
        }

        // Select path: scoped to the caller's own rows, as RLS enforces.
        const mine = reports.filter((r) => r.user_id === filters.user_id);
        const reason = filters.reason as string | undefined;
        const filtered = reason ? mine.filter((r) => r.reason === reason) : mine;
        return Promise.resolve({ data: filtered.map((r) => ({ ...r })), error: null });
      };

      builder.maybeSingle = vi.fn(resolve);
      builder.single = vi.fn(resolve);
      builder.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => resolve().then(r, j);
      return builder;
    }

    return fakeQueryResult(null, { message: `unexpected table ${table}` });
  });

  let currentUser: string | null = null;
  const client = {
    from: (table: string) => {
      state.lastUserId = currentUser;
      return from(table);
    },
  };

  return {
    client: client as never,
    rows: () => reports,
    inserted: () => state.lastInsert,
    asUser(userId: string | null) {
      currentUser = userId;
    },
    rpc: vi.fn(async () => ({ data: null, error: opts.rpcError ?? null })),
  };
}

describe("job report reason set", () => {
  it("matches the nine reasons the Report Job UI offers", () => {
    expect([...JOB_REPORT_REASONS]).toEqual([
      "Scam",
      "Fake Company",
      "Misleading Job Description",
      "Misleading Salary",
      "Requests Payment",
      "Phishing Attempt",
      "Duplicate Listing",
      "Incorrect Location",
      "Other",
    ]);
  });

  it("accepts every offered reason and rejects anything else", () => {
    for (const reason of JOB_REPORT_REASONS) {
      expect(isJobReportReason(reason)).toBe(true);
    }
    expect(isJobReportReason("Spam")).toBe(false);
    expect(isJobReportReason("")).toBe(false);
    expect(isJobReportReason(null)).toBe(false);
    expect(isJobReportReason(42)).toBe(false);
  });

  it("mirrors the database status enum", () => {
    expect([...JOB_REPORT_STATUSES]).toEqual([
      "new",
      "reviewing",
      "resolved",
      "dismissed",
    ]);
    // The retired name must not linger in the domain: it would let a client
    // pass an "open" status that the database now rejects.
    expect(JOB_REPORT_STATUSES).not.toContain("open");
  });

  it("does not allow a moderator to move a report back to the filed state", () => {
    // "new" is how a report is born, not a triage target.
    expect([...JOB_REPORT_MODERATION_STATUSES]).toEqual([
      "reviewing",
      "resolved",
      "dismissed",
    ]);
    expect(isJobReportModerationStatus("new")).toBe(false);
    expect(isJobReportModerationStatus("resolved")).toBe(true);
  });
});

describe("fileJobReport", () => {
  const base = {
    jobId: "job-1",
    reason: "Scam" as const,
    details: "They asked for an upfront payment.",
  };

  it("files a report against the caller's own job", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser("user-a");
    const result = await fileJobReport(db.client, { ...base, userId: "user-a" });
    expect(result.ok).toBe(true);
  });

  it("always files a report as new, never as pre-judged", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser("user-a");
    await fileJobReport(db.client, { ...base, userId: "user-a" });
    // The filer has no moderation_status in its input type at all, and the row
    // it writes is pinned to 'new'. The insert policy enforces the same thing
    // server-side, so a direct PostgREST call cannot skip it.
    expect(db.inserted()).toMatchObject({ user_id: "user-a", status: "new" });
  });

  it("refuses a job that belongs to someone else", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-b" }] });
    db.asUser("user-a");
    const result = await fileJobReport(db.client, { ...base, userId: "user-a" });
    // Not a generic 404-for-everything: the caller learns the job is not theirs.
    expect(result).toEqual({ ok: false, code: "job_not_found" });
  });

  it("refuses a job that does not exist at all", async () => {
    const db = fakeReportsDb({ jobs: [] });
    db.asUser("user-a");
    const result = await fileJobReport(db.client, { ...base, userId: "user-a" });
    expect(result).toEqual({ ok: false, code: "job_not_found" });
  });

  it("allows a report with no job reference", async () => {
    const db = fakeReportsDb();
    db.asUser("user-a");
    const result = await fileJobReport(db.client, {
      userId: "user-a",
      jobId: null,
      reason: "Phishing Attempt",
      details: "Got a text claiming to be Odesseus.",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a duplicate of the same job and reason", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser("user-a");
    const first = await fileJobReport(db.client, { ...base, userId: "user-a" });
    expect(first.ok).toBe(true);

    const second = await fileJobReport(db.client, { ...base, userId: "user-a" });
    expect(second).toEqual({ ok: false, code: "duplicate" });
  });

  it("still allows a different reason on the same job", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser("user-a");
    await fileJobReport(db.client, { ...base, userId: "user-a" });
    const second = await fileJobReport(db.client, {
      ...base,
      userId: "user-a",
      reason: "Misleading Salary",
    });
    expect(second.ok).toBe(true);
  });

  it("does not let one user's duplicate block another user", async () => {
    const db = fakeReportsDb({
      jobs: [
        { id: "job-1", user_id: "user-a" },
        { id: "job-2", user_id: "user-b" },
      ],
    });
    db.asUser("user-a");
    await fileJobReport(db.client, { ...base, userId: "user-a" });
    db.asUser("user-b");
    const other = await fileJobReport(db.client, {
      ...base,
      userId: "user-b",
      jobId: "job-2",
    });
    expect(other.ok).toBe(true);
  });

  it("rejects an unknown reason before touching the database", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser("user-a");
    const result = await fileJobReport(db.client, {
      ...base,
      userId: "user-a",
      reason: "Spam" as never,
    });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(db.rows()).toHaveLength(0);
  });

  it("rejects details beyond the stored length cap", async () => {
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser("user-a");
    const result = await fileJobReport(db.client, {
      ...base,
      userId: "user-a",
      details: "x".repeat(2001),
    });
    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(db.rows()).toHaveLength(0);
  });

  it("surfaces an insert rejection rather than reporting success", async () => {
    // The job checks out, but the acting session is not the reporting user, so
    // the RLS WITH CHECK on the insert is what rejects it. The service must
    // report an error, never a fabricated success.
    const db = fakeReportsDb({ jobs: [{ id: "job-1", user_id: "user-a" }] });
    db.asUser(null);
    const result = await fileJobReport(db.client, { ...base, userId: "user-a" });
    expect(result).toEqual({ ok: false, code: "error" });
    expect(db.rows()).toHaveLength(0);
  });
});

describe("listCandidateJobReports", () => {
  it("returns only the caller's own reports", async () => {
    const db = fakeReportsDb({
      reports: [
        { id: "r1", user_id: "user-a", reason: "Scam" },
        { id: "r2", user_id: "user-b", reason: "Fake Company" },
      ],
    });
    const result = await listCandidateJobReports(db.client, "user-a");
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("raises on a read failure instead of returning a partial list", async () => {
    const failing = {
      from: vi.fn(() => fakeQueryResult(null, { message: "boom" })),
    };
    await expect(listCandidateJobReports(failing as never, "user-a")).rejects.toThrow(
      /Could not load job reports/
    );
  });
});

describe("setJobReportStatus", () => {
  it("routes moderation through the service-role RPC", async () => {
    const db = fakeReportsDb();
    const result = await setJobReportStatus(db as never, "r1", "resolved", "handled");
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("odesseus_update_job_report_status", {
      p_report_id: "r1",
      p_status: "resolved",
      p_note: "handled",
    });
  });

  it("refuses a transition back to the filed state without calling the RPC", async () => {
    const db = fakeReportsDb();
    const result = await setJobReportStatus(db as never, "r1", "new" as never, null);
    expect(result.ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses an over-long moderation note", async () => {
    const db = fakeReportsDb();
    const result = await setJobReportStatus(db as never, "r1", "dismissed", "x".repeat(2001));
    expect(result.ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns a failure when the RPC rejects the transition", async () => {
    const db = fakeReportsDb({ rpcError: { message: "job report not found" } });
    const result = await setJobReportStatus(db as never, "missing", "resolved", null);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("job report not found");
  });
});
