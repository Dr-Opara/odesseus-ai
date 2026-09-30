import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

/**
 * Data minimisation on the API responses an employer or a candidate can read.
 *
 * Every assertion here is about a field that reached the browser for no reason.
 * The pattern is the same in all of them: a service accessor returns a wide row
 * because the *server* needs it, and a route spreads that row into the
 * response. Nothing is wrong with the service; the route is where the wide
 * shape becomes someone else's problem.
 *
 * The reason this matters more than it looks: a spread is not a projection. If
 * the service later grows a column, the response grows with it silently. These
 * tests exist so that growth has to be a deliberate edit to a named field list.
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));
vi.mock("@/lib/employer/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/employer/service")>(
    "@/lib/employer/service"
  );
  return { ...actual, getOrgRole: vi.fn(async () => "owner") };
});
vi.mock("@/lib/employer/hiring", () => ({
  listApplicants: vi.fn(),
  listApplicantIdentities: vi.fn(),
  getApplicant: vi.fn(),
}));
// The employer surface resolves its org through this before any read, so it is
// stubbed rather than re-derived: the projection is what is under test, not
// context resolution.
vi.mock("@/lib/employers/context", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/employers/context"
  );
  return {
    ...actual,
    resolveEmployerContext: vi.fn(async () => ({
      status: "ok",
      context: { orgId: "org-1", userId: "employer-1", role: "owner" },
    })),
  };
});

const createClient = vi.fn();
const createServiceClient = vi.fn();

const hiring = await import("@/lib/employer/hiring");

/** A service applicant carrying every field the accessor can return. */
function wideApplicant(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: "app-1",
    jobId: "job-1",
    jobTitle: "Security Engineer",
    jobStatus: "published",
    applicationStatus: "submitted",
    submittedAt: "2026-01-01T00:00:00Z",
    companyName: "Acme",
    roleTitle: "Security Engineer",
    // The candidate's entire submitted resume.
    resumeSnapshot: {
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      skills: ["Security", "Rust"],
      work_history: [{ company: "Analytical Engines", title: "Engineer" }],
    },
    jobSnapshot: {
      description: "Build reliable systems.",
      requirementsText: ["5 years security"],
      preferredText: ["Rust"],
    },
    matchScoreSnapshot: 82,
    // The scorer's evidence bundle.
    verificationEvidence: [
      { requirement: "5 years security", evidence: ["Led engine reliability 8y"] },
    ],
    ...overrides,
  };
}

const tokenParams = { params: Promise.resolve({ orgId: "00000000-0000-4000-8000-000000000001" }) };

beforeEach(() => {
  createClient.mockReset();
  createServiceClient.mockReset();
  vi.mocked(hiring.listApplicants).mockReset();
  vi.mocked(hiring.listApplicantIdentities).mockReset();
  createClient.mockResolvedValue(fakeAuthedClient({ userId: "employer-1" }));
  vi.mocked(hiring.listApplicantIdentities).mockResolvedValue([]);
});

describe("GET /api/employer/orgs/[orgId]/candidates", () => {
  it("does not ship the applicant's resume to the browser", async () => {
    vi.mocked(hiring.listApplicants).mockResolvedValue([wideApplicant()]);
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/route"
    );

    const response = await GET(new Request("http://localhost/x"), tokenParams);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    // The single most important assertion in this file: a full resume reaching
    // an org member -- including the read-only `viewer` role -- over a list
    // endpoint that renders no resume.
    expect(serialized).not.toContain("resumeSnapshot");
    expect(serialized).not.toContain("Analytical Engines");
    expect(serialized).not.toContain("work_history");
    expect(serialized).not.toContain("ada@example.com");
  });

  it("does not ship the verification-evidence bundle", async () => {
    vi.mocked(hiring.listApplicants).mockResolvedValue([wideApplicant()]);
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/route"
    );

    const response = await GET(new Request("http://localhost/x"), tokenParams);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("verificationEvidence");
  });

  it("still returns what the list actually renders", async () => {
    vi.mocked(hiring.listApplicants).mockResolvedValue([wideApplicant()]);
    vi.mocked(hiring.listApplicantIdentities).mockResolvedValue([
      { applicationId: "app-1", candidateName: "Ada Lovelace", candidateEmail: "ada@example.com" },
    ]);
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/route"
    );

    const response = await GET(new Request("http://localhost/x"), tokenParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicants).toHaveLength(1);
    expect(body.applicants[0]).toMatchObject({
      applicationId: "app-1",
      jobId: "job-1",
      jobTitle: "Security Engineer",
      applicationStatus: "submitted",
      companyName: "Acme",
      roleTitle: "Security Engineer",
      // Identity is a separate accessor and is still joined on.
      candidateName: "Ada Lovelace",
      candidateEmail: "ada@example.com",
    });
  });

  it("never returns a user id, so the row cannot be pivoted", async () => {
    vi.mocked(hiring.listApplicants).mockResolvedValue([
      wideApplicant({ userId: "candidate-user-id" }),
    ]);
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/route"
    );

    const response = await GET(new Request("http://localhost/x"), tokenParams);
    const serialized = JSON.stringify(await response.json());
    // An id space linking the org to the candidate account is exactly what must
    // not cross, because it is the key to every other candidate-private table.
    expect(serialized).not.toContain("candidate-user-id");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("user_id");
  });

  it("reports a missing identity as null rather than omitting the applicant", async () => {
    vi.mocked(hiring.listApplicants).mockResolvedValue([wideApplicant()]);
    vi.mocked(hiring.listApplicantIdentities).mockResolvedValue([]);
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/route"
    );

    const body = await (await GET(new Request("http://localhost/x"), tokenParams)).json();
    // A profile-less applicant is still an applicant; dropping the row would be
    // a different bug from hiding the name.
    expect(body.applicants).toHaveLength(1);
    expect(body.applicants[0].candidateName).toBeNull();
    expect(body.applicants[0].candidateEmail).toBeNull();
  });
});

describe("GET /api/employer/orgs/[orgId]/candidates/[applicationId]", () => {
  const detailParams = {
    params: Promise.resolve({
      orgId: "00000000-0000-4000-8000-000000000001",
      // A real uuid: the route rejects a non-uuid application id at the
      // validation branch, which answers 404 with the same message as a genuine
      // miss. A test using "app-1" would pass for entirely the wrong reason.
      applicationId: "00000000-0000-4000-8000-00000000000a",
    }),
  };

  beforeEach(() => {
    vi.mocked(hiring.getApplicant).mockReset();
  });

  it("does not ship the resume or the evidence bundle", async () => {
    vi.mocked(hiring.getApplicant).mockResolvedValue(wideApplicant());
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/route"
    );

    const response = await GET(new Request("http://localhost/x"), detailParams);
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toContain("resumeSnapshot");
    expect(serialized).not.toContain("verificationEvidence");
    expect(serialized).not.toContain("work_history");
  });

  it("keeps the job snapshot, which the detail surface renders", async () => {
    vi.mocked(hiring.getApplicant).mockResolvedValue(wideApplicant());
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/route"
    );

    const body = await (await GET(new Request("http://localhost/x"), detailParams)).json();
    expect(body.applicant.jobSnapshot.requirementsText).toEqual(["5 years security"]);
  });

  it("404s rather than falling back when the accessor finds nothing", async () => {
    vi.mocked(hiring.getApplicant).mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/employer/orgs/[orgId]/candidates/[applicationId]/route"
    );

    const response = await GET(new Request("http://localhost/x"), detailParams);
    expect(response.status).toBe(404);
  });
});

describe("notification feed projection", () => {
  beforeEach(() => {
    createServiceClient.mockReset();
  });

  it("reads only the columns a feed renders", async () => {
    const selects: string[] = [];
    const from = (table: string) => {
      const builder = fakeQueryResult([]);
      const original = builder.select as (c: string) => unknown;
      builder.select = vi.fn((cols: string) => {
        if (table === "notifications") selects.push(cols);
        return original(cols);
      }) as typeof builder.select;
      return builder;
    };

    const { listNotifications } = await import("@/lib/notifications/records");
    await listNotifications(
      fakeAuthedClient({ userId: "u1", from }) as never,
      "u1"
    );

    const projection = selects.join("");
    expect(projection).toContain("notification_type");
    expect(projection).toContain("message");
    expect(projection).toContain("read_at");

    // Dispatch-internal bookkeeping that has no business in a browser response.
    // A client holding `dedupe_key` can tell "shown" from "suppressed".
    expect(projection).not.toContain("dedupe_key");
    expect(projection).not.toContain("email_delivery_status");
    // Scoping facts the feed already implies, and the recipient's own id.
    expect(projection).not.toContain("recipient_user_id");
    expect(projection).not.toContain("organization_id");
    // And never a wildcard, which is how the two above got there in the first
    // place.
    expect(projection).not.toContain("*");
  });

  it("renders the notification body from the column that exists", async () => {
    // The adapter used to read `row.body`, which is not a column on this table,
    // so every employer notification showed an empty detail. A `select("*")`
    // hides that: an unknown key reads as "absent" rather than as a mistake.
    createClient.mockResolvedValue(
      fakeAuthedClient({
        userId: "employer-1",
        from: () =>
          fakeQueryResult([
            {
              id: "n1",
              // A real catalog type. An unrecognised one is dropped from the
              // feed by design, so a guessed name would make this test pass for
              // the wrong reason.
              notification_type: "EMPLOYER_NEW_APPLICANT",
              title: "New applicant",
              message: "Ada Lovelace applied for Security Engineer.",
              action_url: null,
              created_at: "2026-01-01T00:00:00Z",
              read_at: null,
            },
          ]),
      })
    );

    const { getEmployerNotifications } = await import(
      "@/lib/employers/notifications-adapter"
    );
    const result = await getEmployerNotifications();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].detail).toBe("Ada Lovelace applied for Security Engineer.");
  });
});
