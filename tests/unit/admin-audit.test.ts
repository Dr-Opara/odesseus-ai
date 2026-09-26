import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { recordAdminAction } from "@/lib/admin/audit";
import type { AdminAuditEntry } from "@/lib/admin/audit";

function fakeDb(opts: { error?: { message: string } | null; data?: string | null } = {}) {
  return {
    rpc: vi.fn(async () => ({ data: opts.data ?? null, error: opts.error ?? null })),
  };
}

const ENTRY: AdminAuditEntry = {
  actorUserId: "admin-1",
  actorEmail: "admin@odesseus.ai",
  actorRole: "admin",
  action: "job_report.status_changed",
  subjectType: "job_report",
  subjectId: "report-1",
  details: { from: "new", to: "resolved" },
};

describe("recordAdminAction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes through the RPC rather than inserting, so the append-only grants hold", async () => {
    // The table grants no INSERT to any role. An insert here would fail at
    // runtime; the SECURITY DEFINER RPC writes as the table owner instead.
    const db = fakeDb({ data: "audit-1" });
    const result = await recordAdminAction(db as never, ENTRY);

    expect(result).toEqual({ ok: true, id: "audit-1" });
    expect(db.rpc).toHaveBeenCalledWith("odesseus_record_admin_action", {
      p_actor_user_id: "admin-1",
      p_actor_email: "admin@odesseus.ai",
      p_actor_role: "admin",
      p_action: "job_report.status_changed",
      p_subject_type: "job_report",
      p_subject_id: "report-1",
      p_details: { from: "new", to: "resolved" },
    });
  });

  it("defaults the details to an empty object rather than null", async () => {
    // The column is NOT NULL. Sending null would fail the insert, and an audit
    // write that fails because a caller forgot a field is an audit write that
    // gets dropped.
    const db = fakeDb();
    await recordAdminAction(db as never, { ...ENTRY, details: undefined });
    expect(db.rpc).toHaveBeenCalledWith(
      "odesseus_record_admin_action",
      expect.objectContaining({ p_details: {} })
    );
  });

  it("returns the new row id so a caller can cite it", async () => {
    const db = fakeDb({ data: "audit-9" });
    expect((await recordAdminAction(db as never, ENTRY)).id).toBe("audit-9");
  });

  it("logs and swallows a failure rather than throwing", async () => {
    // The change this audit describes has already been applied. Throwing here
    // would tell the operator to retry work that is already done -- the same
    // hazard the seat-sync path documents, with worse consequences.
    const db = fakeDb({ error: { message: "audit table unavailable" } });
    const result = await recordAdminAction(db as never, ENTRY);

    expect(result).toEqual({ ok: false, id: null });
    expect(console.error).toHaveBeenCalledWith(
      "[ODESSEUS_ADMIN_AUDIT] could not record admin action",
      expect.objectContaining({
        action: "job_report.status_changed",
        subjectType: "job_report",
        error: "audit table unavailable",
      })
    );
  });

  it("logs enough to find the missing row later, without logging the details", async () => {
    // `details` can carry a candidate's data. The backfill search only needs
    // what and to whom.
    const db = fakeDb({ error: { message: "nope" } });
    await recordAdminAction(db as never, {
      ...ENTRY,
      details: { note: "candidate said something private" },
    });

    const logged = vi.mocked(console.error).mock.calls[0][1] as Record<string, unknown>;
    expect(logged.subjectId).toBe("report-1");
    expect(JSON.stringify(logged)).not.toContain("candidate said something private");
  });

  it("accepts a null actor email, for a session that carries none", async () => {
    const db = fakeDb();
    await recordAdminAction(db as never, { ...ENTRY, actorEmail: null });
    expect(db.rpc).toHaveBeenCalledWith(
      "odesseus_record_admin_action",
      expect.objectContaining({ p_actor_email: null })
    );
  });

  it("accepts a null subject id, for an action with no single object", async () => {
    const db = fakeDb();
    await recordAdminAction(db as never, { ...ENTRY, subjectId: null });
    expect(db.rpc).toHaveBeenCalledWith(
      "odesseus_record_admin_action",
      expect.objectContaining({ p_subject_id: null })
    );
  });
});
