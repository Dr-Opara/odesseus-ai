import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQueryResult } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();
const startMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("workflow/api", () => ({
  start: (...args: unknown[]) => startMock(...args),
}));
vi.mock("@/workflows/application", () => ({
  applicationWorkflow: {},
}));
vi.mock("@/lib/security/url-safety", () => ({
  isSafeExternalUrl: () => Promise.resolve({ safe: true }),
}));

// The route skips the browserbase/env gate only when these are set; the gate
// itself is unrelated to this test, so stub the env and let readiness pass.
const REQUIRED_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
];

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/apply/start", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const JOB_ID = "11111111-1111-4111-8111-111111111111";

let runInserts: Array<Record<string, unknown>>;
let eventInserts: Array<Record<string, unknown>>;
let updatePayloads: Array<Record<string, unknown>>;

function makeServiceClientMock() {
  runInserts = [];
  eventInserts = [];
  updatePayloads = [];
  const builderFor = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.then = (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject);
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.single = vi.fn(async () => ({ data: { id: "run-1" }, error: null }));
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      if (table === "application_runs") {
        runInserts.push(payload);
        // The route goes .insert(...).select("id").single() for the new run.
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: "run-1" }, error: null })),
          })),
        };
      }
      // audit-log rows (application_run_events) are awaited directly
      eventInserts.push(payload);
      return builder;
    });
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload);
      return builder;
    });
    return builder;
  };
  return { from: vi.fn((table: string) => builderFor(table)) };
}

function makeAuthedClient(overrides: {
  walletCents?: number;
  activeRun?: boolean;
  userId?: string | null;
}) {
  const { walletCents = 5000, activeRun = false, userId = "user-1" } = overrides;
  const from = vi.fn((table: string) => {
    if (table === "job_opportunities") {
      return fakeQueryResult({
        id: JOB_ID,
        company_name: "Acme",
        role_title: "Engineer",
        status: "approved",
      });
    }
    if (table === "credit_balances") {
      return fakeQueryResult({ wallet_balance_cents: walletCents });
    }
    if (table === "resume_tailorings") {
      return fakeQueryResult({
        id: "tailor-1",
        approved_resume_id: "resume-1",
        status: "approved",
        version_number: 1,
      });
    }
    if (table === "application_runs") {
      return fakeQueryResult(
        activeRun
          ? { id: "active-run-1", status: "running" }
          : null
      );
    }
    return fakeQueryResult(null);
  });
  return {
    auth: {
      getClaims: vi.fn(async () => ({
        data: userId ? { claims: { sub: userId } } : { claims: null },
      })),
    },
    from,
  };
}

describe("POST /api/apply/start (wallet-gated, mode-aware start)", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    vi.stubEnv("BROWSERBASE_API_KEY", "test-key");
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "test-project");
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    startMock.mockReset();
    startMock.mockResolvedValue({ runId: "wf-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts a Standard Apply run by default (legacy clients send no mode)", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({}));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runId).toBe("run-1");
    expect(runInserts).toHaveLength(1);
    expect(runInserts[0]).toMatchObject({
      user_id: "user-1",
      job_id: JOB_ID,
      approved_resume_id: "resume-1",
      target_url: "https://employer.example.com/apply",
      execution_mode: "standard",
      status: "queued",
    });
    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0]).toMatchObject({
      run_id: "run-1",
      user_id: "user-1",
      event_type: "created",
    });
    expect(startMock).toHaveBeenCalledWith({}, ["run-1"]);
  });

  it("starts a Smart Apply run and records execution_mode smart", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({}));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(
      jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply", mode: "smart" })
    );

    expect(response.status).toBe(200);
    expect(runInserts[0].execution_mode).toBe("smart");
  });

  it("rejects an unknown execution mode", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({}));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(
      jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply", mode: "turbo" })
    );

    expect(response.status).toBe(400);
    expect(runInserts).toHaveLength(0);
  });

  it("rejects Standard Apply when the wallet holds less than $0.49 — before any run is created", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({ walletCents: 40 }));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply" }));

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.error).toMatch(/\$0\.49/);
    expect(body.error).toMatch(/Standard Apply/);
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });

  it("rejects Smart Apply when the wallet holds less than $1.99", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({ walletCents: 100 }));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(
      jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply", mode: "smart" })
    );

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.error).toMatch(/\$1\.99/);
    expect(body.error).toMatch(/Smart Apply/);
  });

  it("accepts a wallet that holds exactly the mode rate (49¢ for standard)", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({ walletCents: 49 }));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply" }));

    expect(response.status).toBe(200);
  });

  it("still blocks starting while another run is active", async () => {
    createClientMock.mockResolvedValue(makeAuthedClient({ activeRun: true }));
    createServiceClientMock.mockReturnValue(makeServiceClientMock());

    const { POST } = await import("@/app/api/apply/start/route");
    const response = await POST(jsonRequest({ jobId: JOB_ID, targetUrl: "https://employer.example.com/apply" }));

    expect(response.status).toBe(409);
    expect(runInserts).toHaveLength(0);
  });
});