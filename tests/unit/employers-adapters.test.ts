import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmployerJobs, getEmployerJob, createEmployerJob, updateEmployerJob, publishEmployerJob, closeEmployerJob, deleteEmployerJobDraft, featureEmployerJob } from "@/lib/employers/jobs-adapter";
import { getCandidates, getCandidateDetail } from "@/lib/employers/candidates-adapter";
import { getPipelineBoard, moveCandidateStage } from "@/lib/employers/pipeline-adapter";
import { getEmployerAnalytics } from "@/lib/employers/analytics-adapter";
import { getEmployerDashboard } from "@/lib/employers/dashboard-adapter";
import { getEmployerTeam, inviteTeamMember, removeTeamMember, revokeInvitation } from "@/lib/employers/team-adapter";
import { getEmployerProfile, provisionEmployerOrg, updateCompanyProfile } from "@/lib/employers/onboarding-adapter";
import { getEmployerBilling, startPlanCheckout, startSeatCheckout } from "@/lib/employers/billing-adapter";
import { getFeaturedJobPackages, getEmployerFeatured, purchaseFeaturedJob } from "@/lib/employers/featured-adapter";
import {
  getEmployerNotifications,
  getNotificationPreferences,
  markNotificationsRead,
  markAllNotificationsRead,
  updateNotificationPreference,
} from "@/lib/employers/notifications-adapter";
import { PIPELINE_STAGES, toPipelineStage, toBackendStage } from "@/lib/employers/types";

const ORG = "11111111-1111-4111-8111-111111111111";

type ReadResult = { status: "ok"; data: unknown; source: "live" | "fixture" } | { status: "unavailable"; reason: string };

/** Stub global fetch so the adapters exercise the real request path. */
function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const { status = 200, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The server-side origin the API client derives from request headers. */
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "odesseus.test", "x-forwarded-proto": "https" }),
}));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("locked pipeline vocabulary (F13-K)", () => {
  it("exposes exactly the seven locked stages, in order", () => {
    expect([...PIPELINE_STAGES]).toEqual([
      "APPLIED",
      "REVIEWING",
      "SHORTLISTED",
      "INTERVIEW",
      "OFFER",
      "HIRED",
      "REJECTED",
    ]);
  });

  it("round-trips every locked stage to and from the backend's stored value", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(toPipelineStage(toBackendStage(stage))).toBe(stage);
    }
  });

  it("returns null for a stage the backend did not send", () => {
    expect(toPipelineStage(null)).toBeNull();
    expect(toPipelineStage("unknown-stage")).toBeNull();
  });
});

describe("employer adapters hit the real backend endpoints", () => {
  it("getEmployerJobs reads GET /api/employer/orgs/{orgId}/jobs", async () => {
    const spy = stubFetch(() => ({
      body: {
        items: [
          {
            id: "job-1",
            title: "Senior Backend Engineer",
            location: "Remote",
            work_arrangement: "remote",
            status: "published",
            posted_at: "2026-08-02T00:00:00.000Z",
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
        total: 1,
      },
    }));

    const result = await getEmployerJobs(ORG);

    expect(spy.mock.calls[0][0]).toContain(`/api/employer/orgs/${ORG}/jobs`);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("live");
      expect(result.data[0].status).toBe("Published");
      expect(result.data[0].workArrangement).toBe("Remote");
    }
  });

  it("createEmployerJob sends only fields the posting record stores", async () => {
    const spy = stubFetch(() => ({
      status: 201,
      body: { id: "job-9", title: "New Role", status: "draft" },
    }));

    await createEmployerJob(ORG, {
      title: "New Role",
      workArrangement: "On-site",
      requiredQualificationsText: "Go",
    });

    const body = JSON.parse(String(spy.mock.calls[0][1]?.body));
    expect(body).toEqual({ title: "New Role", requirementsText: "Go", workArrangement: "onsite" });
  });

  it("surfaces a backend publish refusal verbatim instead of a local capacity rule", async () => {
    stubFetch(() => ({
      status: 402,
      body: { error: "Your plan's active job limit is reached. Close a job or upgrade to publish.", reason: "at_capacity" },
    }));

    const result = await publishEmployerJob(ORG, "job-1");

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("Your plan's active job limit is reached. Close a job or upgrade to publish.");
    }
  });

  it("moveCandidateStage posts the backend's stored stage value", async () => {
    const spy = stubFetch(() => ({ body: { entry: { stage: "interview", created_at: "2026-09-01T00:00:00.000Z" } } }));

    const result = await moveCandidateStage(ORG, { jobId: "job-1", applicationId: "app-1", toStage: "INTERVIEW" });

    const body = JSON.parse(String(spy.mock.calls[0][1]?.body));
    expect(body.stage).toBe("interview");
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.data.stage).toBe("INTERVIEW");
  });

  it("getCandidates joins the applicant list with the real current pipeline stage", async () => {
    stubFetch((url) =>
      url.includes("/pipeline")
        ? { body: { history: [], current: { "app-1": "shortlisted" } } }
        : {
            body: {
              applicants: [
                {
                  applicationId: "app-1",
                  jobId: "job-1",
                  jobTitle: "Senior Backend Engineer",
                  submittedAt: "2026-08-15T00:00:00.000Z",
                  jobSnapshot: { location: "Remote" },
                },
              ],
            },
          }
    );

    const result = await getCandidates(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].stage).toBe("SHORTLISTED");
      expect(result.data[0].id).toBe("app-1");
    }
  });

  it("never invents a Fit Score: the list carries none unless the backend did", async () => {
    stubFetch((url) =>
      url.includes("/pipeline")
        ? { body: { current: {} } }
        : {
            body: {
              applicants: [
                { applicationId: "app-1", jobId: "job-1", jobTitle: "Role" },
              ],
            },
          }
    );

    const result = await getCandidates(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].fitScoreOverall).toBeUndefined();
      expect(result.data[0].stage).toBe("APPLIED");
    }
  });

  it("getPipelineBoard groups every locked stage key", async () => {
    stubFetch((url) =>
      url.includes("/pipeline")
        ? { body: { current: { "app-1": "interview" } } }
        : { body: { applicants: [{ applicationId: "app-1", jobId: "job-1", jobTitle: "Role" }] } }
    );

    const result = await getPipelineBoard(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(Object.keys(result.data).sort()).toEqual([...PIPELINE_STAGES].sort());
      expect(result.data.INTERVIEW).toHaveLength(1);
    }
  });

  it("getEmployerAnalytics derives applicant volume from the backend's own per-job counts", async () => {
    stubFetch(() => ({
      body: {
        analytics: {
          applicationsByJob: [
            { jobId: "job-1", jobTitle: "Role A", applicantCount: 3 },
            { jobId: "job-2", jobTitle: "Role B", applicantCount: 4 },
          ],
          applicationsOverTime: [{ day: "2026-09-01", count: 7 }],
          pipeline: { applied: 5, interview: 2 },
          strongFitByJob: [{ jobId: "job-1", count: 2 }],
          jobsActive: 1,
          jobsClosed: 0,
          outcomes: { hired: 1, rejected: 2 },
        },
      },
    }));

    const result = await getEmployerAnalytics(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.applicantVolume).toBe(7);
      expect(result.data.strongFitCandidates).toBe(2);
      expect(result.data.stageDistribution.APPLIED).toBe(5);
      expect(result.data.hired).toBe(1);
    }
  });

  it("getEmployerBilling maps the stored tier and never invents a plan", async () => {
    stubFetch(() => ({
      body: {
        billing: {
          plan: { tier: "growth", name: "Growth", priceLabel: "$149/mo" },
          subscriptionStatus: "active",
          capacity: { included: 10, published: 4, remaining: 6 },
          seats: { required: 3, active: 2, activeUntil: null },
          featuredActive: 0,
        },
      },
    }));

    const result = await getEmployerBilling(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.planId).toBe("Growth");
      expect(result.data.capacity.included).toBe(10);
    }
  });

  it("leaves the plan null when the backend holds no subscription", async () => {
    stubFetch(() => ({
      body: {
        billing: { plan: null, subscriptionStatus: null, capacity: { included: 0, published: 0, remaining: 0 } },
      },
    }));

    const result = await getEmployerBilling(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.data.planId).toBeNull();
  });

  it("getEmployerDashboard keeps backend read gaps as notices, not zeroes", async () => {
    stubFetch(() => ({
      body: {
        dashboard: {
          organization: { id: ORG, name: "Acme Robotics" },
          plan: { tier: "starter", name: "Starter", priceLabel: "$79/mo" },
          jobCounts: { total: 3, published: 2, draft: 1, closed: 0 },
          applicantTotal: 11,
          strongFitCount: 4,
          notices: ["Could not load applicant counts."],
        },
      },
    }));

    const result = await getEmployerDashboard(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.organizationName).toBe("Acme Robotics");
      expect(result.data.planName).toBe("Starter");
      expect(result.data.notices).toEqual(["Could not load applicant counts."]);
    }
  });

  it("getEmployerTeam separates the roster from outstanding invitations", async () => {
    stubFetch(() => ({
      body: {
        team: {
          callerRole: "owner",
          isCallerAdmin: true,
          seats: { seatsPaid: 3, seatsUsed: 2, seatsRequired: 2 },
          members: [{ user_id: "u1", role: "owner", created_at: "2026-07-01T00:00:00.000Z" }],
          invitations: [
            { id: "inv-1", email: "new.recruiter@example.com", role: "recruiter", status: "pending" },
          ],
        },
      },
    }));

    const result = await getEmployerTeam(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.members).toHaveLength(1);
      expect(result.data.invitations[0].name).toBe("new.recruiter@example.com");
      expect(result.data.invitations[0].status).toBe("Pending");
    }
  });

  it("inviteTeamMember returns the backend's emailed flag and redemption link", async () => {
    const spy = stubFetch(() => ({ status: 201, body: { invitation: {}, token: "tkn", emailed: false } }));

    const result = await inviteTeamMember(ORG, "new@example.com", "Recruiter");

    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ email: "new@example.com", role: "recruiter" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.emailed).toBe(false);
      expect(result.data.redemptionLink).toContain("/employers/invitations/tkn");
    }
  });

  it("maps notification types onto the employer categories", async () => {
    stubFetch(() => ({
      body: {
        items: [
          {
            id: "n1",
            notification_type: "EMPLOYER_STRONG_FIT",
            title: "Strong fit",
            message: "An applicant scored 91.",
            read_at: null,
            created_at: "2026-09-27T09:00:00.000Z",
          },
        ],
      },
    }));

    const result = await getEmployerNotifications(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data[0].category).toBe("strong_fit");
      expect(result.data[0].read).toBe(false);
    }
  });

  it("sends one preference key at a time so untoggled channels are untouched", async () => {
    const spy = stubFetch(() => ({ body: { preferences: { strong_fit: false } } }));

    await updateNotificationPreference(ORG, "strong_fit", false);

    expect(spy.mock.calls[0][0]).toContain("/notification-preferences");
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ strong_fit: false });
  });

  it("starts a Stripe checkout rather than marking a job featured", async () => {
    const spy = stubFetch(() => ({ body: { url: "https://checkout.example/session", tier: "ai_30d" } }));

    const result = await purchaseFeaturedJob(ORG, "job-1", "ai_30d");

    expect(spy.mock.calls[0][0]).toContain("/featured/checkout");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.checkoutUrl).toBe("https://checkout.example/session");
    }
  });

  it("exposes the three locked promotion packages", () => {
    const packages = getFeaturedJobPackages();
    expect(packages.map((p) => `${p.name} ${p.priceLabel} ${p.unit}`)).toEqual([
      "Featured $29 / 7 days",
      "Featured $49 / 14 days",
      "AI Featured $129 / 30 days",
    ]);
  });

  it("only reports a featured listing the backend says is boosted", async () => {
    stubFetch(() => ({
      body: {
        featured: {
          listings: [
            { id: "l1", jobId: "job-1", jobTitle: "Role", tier: "ai_30d", isActive: true, isBoosted: true, startsAt: null, expiresAt: null },
            { id: "l2", jobId: "job-2", jobTitle: "Role 2", tier: "featured_7d", isActive: true, isBoosted: false, startsAt: null, expiresAt: null },
          ],
          jobs: [],
        },
      },
    }));

    const result = await getEmployerFeatured(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.listings.filter((l) => l.isBoosted)).toHaveLength(1);
    }
  });

  it("provisions the org through the idempotent backend route", async () => {
    const spy = stubFetch((url) =>
      url.endsWith("/api/employer/orgs")
        ? { body: { org: { id: ORG, name: "Acme Robotics" } } }
        : { body: { org: { id: ORG, name: "Acme Robotics", industry: "Robotics" } } }
    );

    const result = await provisionEmployerOrg({ companyName: "Acme Robotics", industry: "Robotics" });

    expect(spy.mock.calls[0][0]).toContain("/api/employer/orgs");
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.data.industry).toBe("Robotics");
  });
});

describe("production never shows fake employer data (F4)", () => {
  it("returns unavailable rather than a fixture when the backend is unreachable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load jobs." } }));

    const result = await getEmployerJobs(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("never labels a failed production read as fixture data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load billing." } }));

    const result = await getEmployerBilling(ORG);

    expect(result.status).not.toBe("ok");
  });
});

describe("mutations report only what the backend confirmed", () => {
  it("does not report a close the backend refused", async () => {
    stubFetch(() => ({ status: 409, body: { error: "Job cannot be closed." } }));

    const result = await closeEmployerJob(ORG, "job-1");

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("Job cannot be closed.");
  });

  it("does not report a draft delete the backend refused", async () => {
    stubFetch(() => ({ status: 409, body: { error: "Job cannot be deleted." } }));

    const result = await deleteEmployerJobDraft(ORG, "job-1");

    expect(result.status).toBe("unavailable");
  });

  it("does not report a stage move the backend refused", async () => {
    stubFetch(() => ({ status: 404, body: { error: "That applicant could not be found." } }));

    const result = await moveCandidateStage(ORG, { jobId: "job-1", applicationId: "app-1", toStage: "HIRED" });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("That applicant could not be found.");
  });

  it("does not report a plan change without a checkout URL", async () => {
    stubFetch(() => ({ body: {} }));

    const result = await startPlanCheckout(ORG, "Growth");

    expect(result.status).toBe("unavailable");
  });

  it("does not report a seat purchase without a checkout URL", async () => {
    stubFetch(() => ({ body: {} }));

    const result = await startSeatCheckout(ORG, 2);

    expect(result.status).toBe("unavailable");
  });

  it("does not report a featured purchase without a checkout URL", async () => {
    stubFetch(() => ({ body: {} }));

    const result = await featureEmployerJob(ORG, "job-1", "featured_7d");

    expect(result.status).toBe("unavailable");
  });

  it("does not report a non-owner company profile edit as saved", async () => {
    stubFetch(() => ({ status: 403, body: { error: "Only the team owner can edit the company profile." } }));

    const result = await updateCompanyProfile(ORG, { companyName: "Acme" });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toContain("team owner");
  });

  it("does not report a notification preference the backend refused", async () => {
    stubFetch(() => ({ status: 403, body: { error: "Admin access required." } }));

    const result = await updateNotificationPreference(ORG, "billing", false);

    expect(result.status).toBe("unavailable");
  });

  it("does not report a team removal the backend refused", async () => {
    stubFetch(() => ({ status: 409, body: { error: "The team owner cannot be removed. Transfer ownership first." } }));

    const result = await removeTeamMember(ORG, "owner-id");

    expect(result.status).toBe("unavailable");
  });

  it("does not report a withdrawn invitation the backend refused", async () => {
    stubFetch(() => ({ status: 403, body: { error: "Only a team owner or admin can withdraw invitations." } }));

    const result = await revokeInvitation(ORG, "inv-1");

    expect(result.status).toBe("unavailable");
  });

  it("does not report a read receipt the backend refused", async () => {
    stubFetch(() => ({ status: 500, body: { error: "Could not mark notifications read." } }));

    const result = await markNotificationsRead(ORG, ["n1"]);

    expect(result.status).toBe("unavailable");
  });

  it("does not report a mark-all-read the backend refused", async () => {
    stubFetch(() => ({ status: 500, body: { error: "Could not mark notifications read." } }));

    const result = await markAllNotificationsRead(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not report a job save the backend refused", async () => {
    stubFetch(() => ({ status: 409, body: { error: "Job cannot be updated." } }));

    const result = await updateEmployerJob(ORG, "job-1", { title: "New" });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("Job cannot be updated.");
  });

  it("does not report a job create the backend refused", async () => {
    stubFetch(() => ({ status: 400, body: { error: "Title is required and must be at most 200 characters." } }));

    const result = await createEmployerJob(ORG, { title: "" });

    expect(result.status).toBe("unavailable");
  });

  it("does not report a candidate detail the backend could not find", async () => {
    stubFetch((url) =>
      url.includes("/pipeline")
        ? { body: { current: {} } }
        : { status: 404, body: { error: "That applicant could not be found." } }
    );

    const result = await getCandidateDetail(ORG, "missing");

    expect(result.status).toBe("unavailable");
  });

  it("does not report a job detail the backend could not find", async () => {
    stubFetch(() => ({ status: 404, body: { error: "Job not found." } }));

    const result = await getEmployerJob(ORG, "missing");

    expect(result.status).toBe("unavailable");
  });

});

describe("a refused read is never answered with dev data in production (F4)", () => {
  it("does not show a company profile the backend could not find", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 404, body: { error: "That team could not be found." } }));

    const result = await getEmployerProfile(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not show a team roster the backend could not authorize", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 404, body: { error: "That team could not be found." } }));

    const result = await getEmployerTeam(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not show notification preferences the backend could not read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load notification preferences." } }));

    const result = await getNotificationPreferences(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not show an applicant list the backend could not read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load applicants." } }));

    const result = await getCandidates(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not show analytics the backend could not read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load analytics." } }));

    const result = await getEmployerAnalytics(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not show a dashboard the backend could not read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load the dashboard." } }));

    const result = await getEmployerDashboard(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("does not show notifications the backend could not read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFetch(() => ({ status: 500, body: { error: "Could not load notifications." } }));

    const result = await getEmployerNotifications(ORG);

    expect(result.status).toBe("unavailable");
  });

  it("falls back to dev data outside production so local UI work is possible", async () => {
    stubFetch(() => ({ status: 500, body: { error: "Could not load notifications." } }));

    const result = await getEmployerNotifications(ORG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.source).toBe("fixture");
  });
});
