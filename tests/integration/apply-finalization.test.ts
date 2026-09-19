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
};

// This complements the direct SQL smoke test run against the RPC itself
// (which is the authoritative proof of atomicity/idempotency/rollback —
// see the Phase C report). This test verifies the application layer's
// contract with that RPC: it calls it with the right arguments, never
// performs any of the old multi-step writes itself, and correctly
// propagates success/failure.
describe("finalizeConfirmedExistingSubmission (atomic Apply finalization)", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
    releaseApplicationBrowserSessionMock.mockReset();
  });

  it("delegates finalization entirely to the atomic RPC with the correct arguments", async () => {
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
      confirmation: "Thank you for applying! We received your application.",
      pageUrl: "https://employer.example.com/confirmation",
      browserSessionId: "session-1",
    });

    expect(result).toEqual({ terminal: true, status: "submitted" });
    expect(rpc).toHaveBeenCalledWith("odysseus_finalize_successful_application", {
      p_run_id: run.id,
      p_user_id: run.user_id,
      p_confirmation_text: "Thank you for applying! We received your application.",
      p_page_url: "https://employer.example.com/confirmation",
    });
    expect(releaseApplicationBrowserSessionMock).toHaveBeenCalledWith("session-1");
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
      confirmation: "Thank you for applying!",
      pageUrl: "https://employer.example.com/confirmation",
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

  it("surfaces an RPC error (e.g. insufficient credits) instead of silently succeeding, and does not release the browser session or log a success event", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "insufficient application credits" },
    }));
    createServiceClientMock.mockReturnValue({ rpc, from: vi.fn() });

    const { finalizeConfirmedExistingSubmission } = await import("@/lib/apply/runner");

    await expect(
      finalizeConfirmedExistingSubmission({
        run,
        confirmation: "Thank you for applying!",
        pageUrl: "https://employer.example.com/confirmation",
        browserSessionId: "session-1",
      })
    ).rejects.toThrow(/insufficient application credits/);

    expect(releaseApplicationBrowserSessionMock).not.toHaveBeenCalled();
  });

  it("is safe to call twice for the same run (retry after a lost response) — the RPC's own idempotency governs, the caller just relays whatever it returns", async () => {
    const rpc = vi
      .fn()
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

    const first = await finalizeConfirmedExistingSubmission({
      run,
      confirmation: "Thank you for applying!",
      pageUrl: "https://employer.example.com/confirmation",
      browserSessionId: "session-1",
    });
    const second = await finalizeConfirmedExistingSubmission({
      run,
      confirmation: "Thank you for applying!",
      pageUrl: "https://employer.example.com/confirmation",
      browserSessionId: "session-1",
    });

    expect(first).toEqual({ terminal: true, status: "submitted" });
    expect(second).toEqual({ terminal: true, status: "submitted" });
    expect(rpc).toHaveBeenCalledTimes(2);
    // Both calls use the identical run id, which is exactly what makes
    // the RPC's external_reference-based idempotency apply.
    expect(rpc.mock.calls[0][1].p_run_id).toBe(rpc.mock.calls[1][1].p_run_id);
  });
});
