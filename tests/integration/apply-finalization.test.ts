import { describe, expect, it, vi, beforeEach } from "vitest";

const createServiceClientMock = vi.fn();
const releaseApplicationBrowserSessionMock = vi.fn(async (_sessionId: string) => undefined);

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/apply/browserbase", () => ({
  createApplicationBrowserSession: vi.fn(),
  getApplicationBrowserSession: vi.fn(),
  releaseApplicationBrowserSession: (sessionId: string) =>
    releaseApplicationBrowserSessionMock(sessionId),
}));

const run = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "user-1",
  job_id: "job-1",
  approved_resume_id: "resume-1",
  target_url: "https://employer.example.com/apply",
  execution_mode: "standard",
};

const confirmation = "Thank you for applying! We received your application.";
const pageUrl = "https://employer.example.com/confirmation";

// This complements the direct SQL smoke tests run against the RPC itself
// (supabase/tests/apply-finalization-wallet.test.sql — the authoritative proof
// of atomicity/idempotency/rollback). This test verifies the application
// layer's contract with that RPC: it calls it with the right arguments, never
// performs any of the old multi-step writes itself, and correctly propagates
// success, hard errors, and wallet pauses.
describe("finalizeConfirmedExistingSubmission (atomic Apply wallet finalization)", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
    releaseApplicationBrowserSessionMock.mockReset();
  });

  it("delegates finalization entirely to the mode-aware atomic RPC with the correct arguments", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ application_id: "app-1", run_id: run.id, already_finalized: false }],
      error: null,
    }));
    const eventsInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    createServiceClientMock.mockReturnValue({
      rpc,
      from: vi.fn(() => ({ insert: eventsInsert })),
    });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");

    const result = await finalizeConfirmedExistingSubmission({
      run,
      confirmation,
      pageUrl,
      browserSessionId: "session-1",
    });

    expect(result).toEqual({ terminal: true, status: "submitted" });
    expect(rpc).toHaveBeenCalledWith("odesseus_finalize_application", {
      p_run_id: run.id,
      p_user_id: run.user_id,
      p_mode: "standard",
      p_confirmation_text: confirmation,
      p_page_url: pageUrl,
    });
    expect(releaseApplicationBrowserSessionMock).toHaveBeenCalledWith("session-1");
  });

  it("passes the run's execution mode through to the RPC (smart runs charge the smart rate server-side)", async () => {
    const rpc = vi.fn(async (_name: string, args: any) => ({
      data: [{ application_id: "app-1", run_id: run.id, already_finalized: false }],
      error: null,
    }));
    createServiceClientMock.mockReturnValue({
      rpc,
      from: vi.fn(() => ({ insert: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
    });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");

    await finalizeConfirmedExistingSubmission({
      run: { ...run, execution_mode: "smart" },
      confirmation,
      pageUrl,
      browserSessionId: "session-1",
    });

    expect(rpc.mock.calls[0][1].p_mode).toBe("smart");
  });

  it("never writes to applications, credit_transactions, job_opportunities, or application_runs directly — only the RPC and the audit-log table", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ application_id: "app-1", run_id: run.id, already_finalized: false }],
      error: null,
    }));
    const fromSpy = vi.fn((_table: string) => ({
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    }));
    createServiceClientMock.mockReturnValue({ rpc, from: fromSpy });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");
    await finalizeConfirmedExistingSubmission({
      run,
      confirmation,
      pageUrl,
      browserSessionId: "session-1",
    });

    const touchedTables = fromSpy.mock.calls.map((call) => call[0]);
    expect(touchedTables).not.toContain("applications");
    expect(touchedTables).not.toContain("credit_transactions");
    expect(touchedTables).not.toContain("job_opportunities");
    expect(touchedTables).not.toContain("application_runs");
    // application_run_events is the append-only audit log, written outside
    // the atomic transaction — that's expected and fine (see logEvent()).
    expect(touchedTables.every((table) => table === "application_run_events")).toBe(true);
  });

  it("turns an insufficient wallet balance into a needs_user pause (top up and continue) instead of charging or failing the run", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "insufficient wallet balance" },
    }));
    const updateEq = vi.fn(async () => ({ data: null, error: null }));
    const updateFn = vi.fn((payload: any) => ({ eq: updateEq }));
    const eventsInsert = vi.fn((row: any) => Promise.resolve({ data: null, error: null }));
    const fromSpy = vi.fn((_table: string) => ({ insert: eventsInsert, update: updateFn }));
    createServiceClientMock.mockReturnValue({ rpc, from: fromSpy });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");

    const result = await finalizeConfirmedExistingSubmission({
      run,
      confirmation,
      pageUrl,
      browserSessionId: "session-1",
    }) as unknown as { terminal: boolean; status: string; reason: string };

    expect(result.terminal).toBe(false);
    expect(result.status).toBe("needs_user");
    expect(result.reason).toMatch(/\$0\.49/);

    // The run is paused (not failed) so the user can top up and continue.
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(updateFn.mock.calls[0][0].status).toBe("needs_user");
    expect(updateEq).toHaveBeenCalledWith("id", run.id);

    expect(releaseApplicationBrowserSessionMock).not.toHaveBeenCalled();

    const rows = eventsInsert.mock.calls.map((call) => call[0]);
    expect(rows.filter((row) => row.event_type === "paused")).toHaveLength(1);
    expect(rows.some((row) => row.event_type === "credit_consumed")).toBe(false);
    expect(rows.some((row) => row.event_type === "submitted")).toBe(false);
  });

  it("surfaces any other RPC error instead of silently succeeding, and does not release the browser session or log a success event", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "application run cannot be finalized from status failed" },
    }));
    const ownerOnly = vi.fn();
    createServiceClientMock.mockReturnValue({ rpc, from: ownerOnly });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");

    await expect(
      finalizeConfirmedExistingSubmission({
        run,
        confirmation,
        pageUrl,
        browserSessionId: "session-1",
      })
    ).rejects.toThrow(/could not finalize it/);

    expect(releaseApplicationBrowserSessionMock).not.toHaveBeenCalled();
    expect(ownerOnly).not.toHaveBeenCalled();
  });

  it("is safe to call twice for the same run (retry after a lost response) — the RPC's own idempotency governs, the caller just relays whatever it returns", async () => {
    const rpc = vi
      .fn(async (_name: string, _args: any) => ({ data: null as unknown, error: null }))
      .mockResolvedValueOnce({
        data: [{ application_id: "app-1", run_id: run.id, already_finalized: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ application_id: "app-1", run_id: run.id, already_finalized: true }],
        error: null,
      });
    createServiceClientMock.mockReturnValue({
      rpc,
      from: vi.fn(() => ({ insert: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
    });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");

    const first = await finalizeConfirmedExistingSubmission({ run, confirmation, pageUrl, browserSessionId: "session-1" });
    const second = await finalizeConfirmedExistingSubmission({ run, confirmation, pageUrl, browserSessionId: "session-1" });

    expect(first).toEqual({ terminal: true, status: "submitted" });
    expect(second).toEqual({ terminal: true, status: "submitted" });
    expect(rpc).toHaveBeenCalledTimes(2);
    // Both calls use the identical run id and mode, which is exactly what
    // makes the RPC's external_reference-based idempotency apply.
    expect(rpc.mock.calls[0][1].p_run_id).toBe(rpc.mock.calls[1][1].p_run_id);
    expect(rpc.mock.calls[0][1].p_mode).toBe(rpc.mock.calls[1][1].p_mode);
  });
});