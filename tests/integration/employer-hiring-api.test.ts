import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult, fromRouter } from "../helpers/fake-supabase";

const createClientMock = vi.fn();
const createServiceClientMock = vi.fn();
const generateFitScoreMock = vi.fn();
const notifyMembersMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/ai/employer-fit", () => ({
  generateEmployerFitScore: (...args: unknown[]) => generateFitScoreMock(...args),
  EMPLOYER_FIT_MODEL_VERSION: "v1",
}));
vi.mock("@/lib/notifications/employer", () => ({
  notifyEmployerMembers: (...args: unknown[]) => notifyMembersMock(...args),
}));

const ORG_ID = "52222222-2222-4222-8222-222222222222";
const OTHER_ORG = "62222222-2222-4222-8222-222222222222";
const OWNER_ID = "51111111-1111-4111-8111-111111111111";
const JOB_ID = "73333333-3333-4333-8333-333333333333";
const APP_ID = "84444444-4444-4444-8444-444444444444";

const ORG_ROW = { id: ORG_ID, owner_user_id: OWNER_ID };

const APPLICANT_ROW = {
  application_id: APP_ID,
  employer_job_id: JOB_ID,
  job_title: "Engineer",
  job_status: "published",
  application_status: "submitted",
  submitted_at: "2026-01-05T00:00:00Z",
  company_name: "Acme",
  role_title: "Engineer",
  resume_snapshot: { name: "Ada" },
  job_snapshot: { title: "Engineer" },
  match_score_snapshot: 90,
  verification_evidence: {},
};

function memberSessionClient(userId: string | null, role: string | null, tables: Record<string, unknown> = {}) {
  return fakeAuthedClient({
    userId,
    from: (table: string) => {
      if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
      if (table === "employer_members") {
        return role ? fakeQueryResult({ role }) : fakeQueryResult(null);
      }
      if (table in tables) return fakeQueryResult(tables[table]);
      return fakeQueryResult(null);
    },
  });
}

function outsiderSessionClient() {
  return fakeAuthedClient({ userId: "user-stranger", from: () => fakeQueryResult(null) });
}

describe("GET candidates (2R)", () => {
  const params = { params: Promise.resolve({ orgId: ORG_ID }) };

  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockResolvedValue(
      memberSessionClient(OWNER_ID, "owner", {
        "employer_fit_scores-null": null,
      })
    );
  });

  it("lists the org's applicants with employer-safe fields only", async () => {
    const rpc = vi.fn(async () => ({ data: [APPLICANT_ROW], error: null }));
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") return fakeQueryResult({ role: "owner" });
          return fakeQueryResult(null);
        },
        rpc,
      })
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/candidates/route");
    const response = await GET(new Request("http://localhost/x"), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicants).toHaveLength(1);
    expect(body.applicants[0]).toMatchObject({ applicationId: APP_ID, jobId: JOB_ID });
    expect(rpc).toHaveBeenCalledWith(
      "odesseus_get_employer_applicants",
      expect.objectContaining({ p_org_id: ORG_ID })
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("transcript");
  });

  it("answers 404 for outsiders without confirming the org", async () => {
    createClientMock.mockResolvedValue(outsiderSessionClient());

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/candidates/route");
    const response = await GET(new Request("http://localhost/x"), params);
    expect(response.status).toBe(404);
  });

  it("answers 404 when the RPC refuses a foreign org", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "Not permitted" } }));
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") return fakeQueryResult({ role: "owner" });
          return fakeQueryResult(null);
        },
        rpc,
      })
    );

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/candidates/route");
    const response = await GET(new Request("http://localhost/x"), params);
    expect(response.status).toBe(404);
  });
});

describe("GET candidate detail (2R)", () => {
  const params = { params: Promise.resolve({ orgId: ORG_ID, applicationId: APP_ID }) };

  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns a same-org applicant", async () => {
    const rpc = vi.fn(async () => ({ data: [APPLICANT_ROW], error: null }));
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") return fakeQueryResult({ role: "recruiter" });
          return fakeQueryResult(null);
        },
        rpc,
      })
    );

    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/route"
    );
    const response = await GET(new Request("http://localhost/x"), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicant.applicationId).toBe(APP_ID);
  });

  it("answers 404 for another org's application id", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: OWNER_ID,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") return fakeQueryResult({ role: "owner" });
          return fakeQueryResult(null);
        },
        rpc,
      })
    );

    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/route"
    );
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ orgId: OTHER_ORG, applicationId: APP_ID }),
    });
    expect(response.status).toBe(404);
  });
});

describe("POST fit-score (2R)", () => {
  const params = { params: Promise.resolve({ orgId: ORG_ID, applicationId: APP_ID }) };
  const body = { jobId: JOB_ID };

  function postRequest(payload: unknown) {
    return new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    generateFitScoreMock.mockReset();
    notifyMembersMock.mockReset();
    generateFitScoreMock.mockResolvedValue({
      overallScore: 88,
      requiredMatches: [],
      preferredMatches: [],
      missingQualifications: [],
      missingSkills: [],
      locationAlignment: { aligned: true, note: "Remote role, remote candidate." },
      blockers: [],
      explanation: "Strong evidence alignment.",
    });
    notifyMembersMock.mockResolvedValue(2);
  });

  function sessionWithRole(role: string | null, fitRow: unknown = null, callerId: string = OWNER_ID) {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: callerId,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") {
            return role ? fakeQueryResult({ role, user_id: callerId }) : fakeQueryResult(null);
          }
          if (table === "employer_fit_scores") return fakeQueryResult(fitRow);
          return fakeQueryResult(null);
        },
      })
    );
  }

  it("refuses viewers with 403", async () => {
    sessionWithRole("viewer", null, "user-viewer");
    createServiceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/fit-score/route"
    );
    const response = await POST(postRequest(body), params);
    expect(response.status).toBe(403);
    expect(generateFitScoreMock).not.toHaveBeenCalled();
  });

  it("returns the cached row without model time", async () => {
    sessionWithRole("admin", {
      id: "fit-1",
      score: 88,
      required_matches: [],
      preferred_matches: [],
      missing_qualifications: [],
      missing_skills: [],
      location_alignment: {},
      blockers: [],
      explanation: "Cached.",
      model_version: "v1",
      version_number: 2,
      created_at: "2026-01-06T00:00:00Z",
      updated_at: "2026-01-06T00:00:00Z",
    });
    createServiceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/fit-score/route"
    );
    const response = await POST(postRequest(body), params);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cached).toBe(true);
    expect(payload.fitScore.score).toBe(88);
    expect(generateFitScoreMock).not.toHaveBeenCalled();
  });

  it("computes, persists, and notifies on a strong score", async () => {
    sessionWithRole("admin", null);
    let fitReads = 0;
    const persistedRow = {
      id: "fit-1",
      score: 88,
      required_matches: [],
      preferred_matches: [],
      missing_qualifications: [],
      missing_skills: [],
      location_alignment: { aligned: true, note: "Remote." },
      blockers: [],
      explanation: "Strong evidence alignment.",
      model_version: "v1",
      version_number: 1,
      created_at: "2026-01-06T00:00:00Z",
      updated_at: "2026-01-06T00:00:00Z",
    };
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "employer_jobs") {
            return fakeQueryResult({
              id: JOB_ID,
              title: "Engineer",
              description: "Build.",
              location: "Remote",
              requirements_text: "5 years.",
              preferred_text: null,
              work_arrangement: "remote",
            });
          }
          if (table === "applications") {
            return fakeQueryResult({ id: APP_ID, job_id: "job-opp-1", resume_snapshot: { name: "Ada" } });
          }
          if (table === "job_opportunities") return fakeQueryResult({ id: "job-opp-1" });
          if (table === "employer_fit_scores") {
            fitReads += 1;
            // First read (existence check) is empty so the model runs; the
            // post-compute re-read returns the persisted row.
            return fitReads === 1 ? fakeQueryResult(null) : fakeQueryResult(persistedRow);
          }
          return fakeQueryResult(null);
        },
      })
    );

    const { POST } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/fit-score/route"
    );
    const response = await POST(postRequest(body), params);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cached).toBe(false);
    expect(payload.fitScore.score).toBe(88);
    expect(generateFitScoreMock).toHaveBeenCalledOnce();
    expect(notifyMembersMock).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ notification_type: "EMPLOYER_STRONG_FIT" }),
      expect.anything()
    );
  });

  it("answers 404 when the job is not the org's", async () => {
    sessionWithRole("admin", null);
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "employer_jobs") return fakeQueryResult(null);
          if (table === "applications") {
            return fakeQueryResult({ id: APP_ID, job_id: "job-opp-1", resume_snapshot: {} });
          }
          return fakeQueryResult(null);
        },
      })
    );

    const { POST } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/fit-score/route"
    );
    const response = await POST(postRequest(body), params);
    expect(response.status).toBe(404);
    expect(generateFitScoreMock).not.toHaveBeenCalled();
  });
});

describe("pipeline routes (2R)", () => {
  const orgParams = { params: Promise.resolve({ orgId: ORG_ID }) };

  function postRequest(payload: unknown) {
    return new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    createClientMock.mockReset();
    createServiceClientMock.mockReset();
    notifyMembersMock.mockReset();
    notifyMembersMock.mockResolvedValue(1);
  });

  function sessionWithRole(role: string | null, tables: Record<string, unknown> = {}, callerId: string = OWNER_ID) {
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: callerId,
        from: (table: string) => {
          if (table === "employer_organizations") return fakeQueryResult(ORG_ROW);
          if (table === "employer_members") {
            return role ? fakeQueryResult({ role, user_id: callerId }) : fakeQueryResult(null);
          }
          if (table in tables) return fakeQueryResult(tables[table]);
          return fakeQueryResult(null);
        },
      })
    );
  }

  it("reads history and derives the current stage per application", async () => {
    sessionWithRole("viewer", {
      employer_pipeline_stages: [
        { id: "s1", job_id: JOB_ID, application_id: APP_ID, stage: "applied", changed_by: null, notes: null, created_at: "2026-01-01T00:00:00Z" },
        { id: "s2", job_id: JOB_ID, application_id: APP_ID, stage: "reviewing", changed_by: OWNER_ID, notes: null, created_at: "2026-01-02T00:00:00Z" },
      ],
    });

    const { GET } = await import("@/app/api/employer/orgs/[orgId]/pipeline/route");
    const response = await GET(new Request("http://localhost/x"), orgParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.history).toHaveLength(2);
    expect(body.current).toEqual({ [APP_ID]: "reviewing" });
  });

  it("appends a transition, preserves history, and notifies", async () => {
    sessionWithRole("recruiter");
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "employer_jobs") return fakeQueryResult({ id: JOB_ID, title: "Engineer" });
          if (table === "applications") {
            return fakeQueryResult({ id: APP_ID, job_id: "job-opp-1" });
          }
          if (table === "job_opportunities") return fakeQueryResult({ id: "job-opp-1" });
          if (table === "employer_pipeline_stages") {
            return {
              ...fakeQueryResult(null),
              insert: vi.fn(() => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: "s9",
                        stage: "shortlisted",
                        changed_by: OWNER_ID,
                        notes: null,
                        created_at: "2026-01-03T00:00:00Z",
                      },
                      error: null,
                    }),
                }),
              })),
            };
          }
          return fakeQueryResult(null);
        },
      })
    );

    const { POST } = await import("@/app/api/employer/orgs/[orgId]/pipeline/route");
    const response = await POST(
      postRequest({ jobId: JOB_ID, applicationId: APP_ID, stage: "shortlisted" }),
      orgParams
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entry).toMatchObject({ stage: "shortlisted", applicationId: APP_ID });
    expect(notifyMembersMock).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ notification_type: "EMPLOYER_PIPELINE_UPDATED" }),
      expect.anything()
    );
  });

  it("refuses viewers with 403", async () => {
    sessionWithRole("viewer", {}, "user-viewer");
    createServiceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import("@/app/api/employer/orgs/[orgId]/pipeline/route");
    const response = await POST(
      postRequest({ jobId: JOB_ID, applicationId: APP_ID, stage: "reviewing" }),
      orgParams
    );
    expect(response.status).toBe(403);
  });

  it("rejects unknown stages with 400", async () => {
    sessionWithRole("admin");

    const { POST } = await import("@/app/api/employer/orgs/[orgId]/pipeline/route");
    const response = await POST(
      postRequest({ jobId: JOB_ID, applicationId: APP_ID, stage: "teleported" }),
      orgParams
    );
    expect(response.status).toBe(400);
  });

  it("answers 404 for an application outside the org's jobs", async () => {
    sessionWithRole("admin");
    createServiceClientMock.mockReturnValue(
      fakeAuthedClient({
        userId: "service",
        from: (table: string) => {
          if (table === "employer_jobs") return fakeQueryResult({ id: JOB_ID });
          if (table === "applications") {
            return fakeQueryResult({ id: APP_ID, job_id: "job-opp-other" });
          }
          if (table === "job_opportunities") return fakeQueryResult(null);
          return fakeQueryResult(null);
        },
      })
    );

    const { POST } = await import("@/app/api/employer/orgs/[orgId]/pipeline/route");
    const response = await POST(
      postRequest({ jobId: JOB_ID, applicationId: APP_ID, stage: "reviewing" }),
      orgParams
    );
    expect(response.status).toBe(404);
  });
});
