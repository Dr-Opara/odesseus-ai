import { describe, expect, it, vi, beforeEach } from "vitest";

const createServiceClientMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

describe("withRetry (execute inline, durably record on failure)", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
  });

  it("returns the executor's result on success and never touches retry_jobs", async () => {
    const rpc = vi.fn();
    createServiceClientMock.mockReturnValue({ rpc });

    const { withRetry } = await import("@/lib/retry/service");
    const result = await withRetry("email_delivery", "key-1", { a: 1 }, async () => "ok");

    expect(result).toBe("ok");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enqueues a durable retry record on failure, then rethrows the original error", async () => {
    const rpc = vi.fn(async () => ({ data: "job-1", error: null }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { withRetry } = await import("@/lib/retry/service");
    const boom = new Error("transient failure");

    await expect(
      withRetry("employer_subscription_sync", "key-2", { orgId: "org-1" }, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(rpc).toHaveBeenCalledWith("odesseus_enqueue_retry_job", {
      p_job_type: "employer_subscription_sync",
      p_idempotency_key: "key-2",
      p_payload: { orgId: "org-1" },
      p_max_attempts: 3,
      p_delay_seconds: 60,
    });
  });

  it("still rethrows the original error when the enqueue itself fails (a broken safety net is not a second outage)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "db unavailable" } }));
    createServiceClientMock.mockReturnValue({ rpc });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { withRetry } = await import("@/lib/retry/service");
    const boom = new Error("original failure");

    await expect(
      withRetry("featured_job_activation", "key-3", {}, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("deduplicates repeated enqueues for the same idempotency key (one row per logical operation)", async () => {
    // Mirrors odesseus_enqueue_retry_job's ON CONFLICT (idempotency_key) DO NOTHING —
    // this test only proves the client always calls the RPC with the same key
    // for the same logical operation; the dedup itself is a DB-level guarantee
    // covered by the pgTAP suite.
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: "job-1",
      error: null,
    }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { enqueueRetryJob } = await import("@/lib/retry/service");
    await enqueueRetryJob("application_finalization", "run-1", { runId: "run-1" });
    await enqueueRetryJob("application_finalization", "run-1", { runId: "run-1" });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_idempotency_key).toBe(rpc.mock.calls[1][1].p_idempotency_key);
  });
});

describe("claimRetryJob / completeRetryJob", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
  });

  it("returns null when nothing is claimable", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { claimRetryJob } = await import("@/lib/retry/service");
    expect(await claimRetryJob("email_delivery")).toBeNull();
  });

  it("throws when the complete RPC errors, rather than silently losing the outcome", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "row not found" } }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { completeRetryJob } = await import("@/lib/retry/service");
    await expect(completeRetryJob("job-1", "succeeded")).rejects.toThrow(/row not found/);
  });
});

describe("runRetryHandler (worker dispatch)", () => {
  beforeEach(() => {
    createServiceClientMock.mockReset();
    vi.resetModules();
  });

  it("re-runs the finalize RPC with a null pageUrl mapped to undefined", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { runRetryHandler } = await import("@/lib/retry/handlers");
    await runRetryHandler("application_finalization", {
      runId: "run-1",
      userId: "user-1",
      mode: "smart",
      confirmationText: "Thank you for applying!",
      pageUrl: null,
    });

    expect(rpc).toHaveBeenCalledWith("odesseus_finalize_application", {
      p_run_id: "run-1",
      p_user_id: "user-1",
      p_mode: "smart",
      p_confirmation_text: "Thank you for applying!",
      p_page_url: undefined,
    });
  });

  it("re-runs the featured-listing RPC with the exact stored payload", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { runRetryHandler } = await import("@/lib/retry/handlers");
    await runRetryHandler("featured_job_activation", {
      orgId: "org-1",
      jobId: "job-1",
      tier: "ai_30d",
      stripePaymentIntent: "pi_123",
    });

    expect(rpc).toHaveBeenCalledWith("odesseus_create_featured_listing", {
      p_org_id: "org-1",
      p_job_id: "job-1",
      p_tier: "ai_30d",
      p_stripe_payment_intent: "pi_123",
    });
  });

  it("throws instead of silently succeeding when the RPC itself errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "org not found" } }));
    createServiceClientMock.mockReturnValue({ rpc });

    const { runRetryHandler } = await import("@/lib/retry/handlers");
    await expect(
      runRetryHandler("recruiter_seat_sync", {
        orgId: "org-1",
        seatCount: 2,
        status: "active",
        stripeSubscriptionId: "sub_1",
        stripeCustomerId: null,
        periodStart: null,
        periodEnd: null,
      })
    ).rejects.toThrow(/org not found/);
  });

  it("fails loudly on a malformed payload instead of calling the RPC with garbage", async () => {
    const rpc = vi.fn();
    createServiceClientMock.mockReturnValue({ rpc });

    const { runRetryHandler } = await import("@/lib/retry/handlers");
    await expect(
      runRetryHandler("application_finalization", { runId: "run-1" /* missing required fields */ })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws a clear error for an unregistered job type", async () => {
    const { runRetryHandler } = await import("@/lib/retry/handlers");
    await expect(runRetryHandler("not_a_real_job_type", {})).rejects.toThrow(
      /No retry handler registered/
    );
  });
});
