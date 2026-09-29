import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmployerJobs, getEmployerJob, createEmployerJob, updateEmployerJob, publishEmployerJob, closeEmployerJob, featureEmployerJob } from "@/lib/employers/jobs-adapter";
import { getCandidates, getCandidateDetail } from "@/lib/employers/candidates-adapter";
import { getPipelineBoard, moveCandidateStage } from "@/lib/employers/pipeline-adapter";
import { getEmployerAnalytics } from "@/lib/employers/analytics-adapter";
import { getTeamMembers, inviteTeamMember, revokeTeamMember } from "@/lib/employers/team-adapter";
import { getEmployerProfile, submitCompanyDetails, submitPlanSelection, completeOnboarding, updateCompanyProfile } from "@/lib/employers/onboarding-adapter";
import { getEmployerBilling, changeEmployerPlan, purchaseRecruiterSeat } from "@/lib/employers/billing-adapter";
import { getFeaturedJobPackages, purchaseFeaturedJob } from "@/lib/employers/featured-adapter";
import { getEmployerNotifications, getNotificationPreferences, markNotificationRead, markAllNotificationsRead, updateNotificationPreferences } from "@/lib/employers/notifications-adapter";
import { PIPELINE_STAGES } from "@/lib/employers/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

type ReadResult = { status: "ok"; data: unknown; source: "live" | "fixture" } | { status: "unavailable"; reason: string };

describe("employer adapter reads — dev fixtures outside production, honest unavailable in production", () => {
  const reads: [string, () => Promise<ReadResult>][] = [
    ["getEmployerJobs", getEmployerJobs],
    ["getCandidates", () => getCandidates()],
    ["getPipelineBoard", getPipelineBoard],
    ["getEmployerAnalytics", getEmployerAnalytics],
    ["getTeamMembers", getTeamMembers],
    ["getEmployerProfile", getEmployerProfile],
    ["getEmployerBilling", getEmployerBilling],
    ["getEmployerNotifications", getEmployerNotifications],
    ["getNotificationPreferences", getNotificationPreferences],
  ];

  for (const [name, fn] of reads) {
    it(`${name} returns fixture data outside production`, async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VERCEL_ENV", "");
      const result = await fn();
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.source).toBe("fixture");
      }
    });

    it(`${name} never returns fixture data in production`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      const result = await fn();
      if (result.status === "ok") {
        expect(result.source).not.toBe("fixture");
      } else {
        expect(result.status).toBe("unavailable");
      }
    });
  }

  it("getEmployerJob looks up a fixture by id outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = await getEmployerJob("job-1");
    expect(result.status).toBe("ok");
  });

  it("getCandidateDetail looks up a fixture by id outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = await getCandidateDetail("candidate-1");
    expect(result.status).toBe("ok");
  });

  it("getPipelineBoard groups fixture candidates under every locked stage key", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = await getPipelineBoard();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(Object.keys(result.data).sort()).toEqual([...PIPELINE_STAGES].sort());
    }
  });

  it("getFeaturedJobPackages exposes the three locked promotion packages with no production gate needed (static pricing, not a fixture)", () => {
    const packages = getFeaturedJobPackages();
    expect(packages.map((p) => p.id)).toEqual(["featured-7", "featured-14", "ai-featured-30"]);
  });
});

describe("employer adapter mutations — always honestly unavailable, never a fabricated success", () => {
  const mutations: [string, () => Promise<{ status: string }>][] = [
    ["createEmployerJob", () => createEmployerJob({ title: "x" })],
    ["updateEmployerJob", () => updateEmployerJob("job-1", {})],
    ["publishEmployerJob", () => publishEmployerJob("job-1")],
    ["closeEmployerJob", () => closeEmployerJob("job-1")],
    ["featureEmployerJob", () => featureEmployerJob("job-1", "featured-7")],
    ["moveCandidateStage", () => moveCandidateStage("candidate-1", "REVIEWING")],
    ["inviteTeamMember", () => inviteTeamMember("a@b.com", "Recruiter")],
    ["revokeTeamMember", () => revokeTeamMember("team-1")],
    ["submitCompanyDetails", () => submitCompanyDetails({ companyName: "x" })],
    ["submitPlanSelection", () => submitPlanSelection("Starter")],
    ["completeOnboarding", completeOnboarding],
    ["updateCompanyProfile", () => updateCompanyProfile({ companyName: "x" })],
    ["changeEmployerPlan", () => changeEmployerPlan("Growth")],
    ["purchaseRecruiterSeat", purchaseRecruiterSeat],
    ["purchaseFeaturedJob", () => purchaseFeaturedJob("job-1", "featured-7")],
    ["markNotificationRead", () => markNotificationRead("notif-1")],
    ["markAllNotificationsRead", markAllNotificationsRead],
    [
      "updateNotificationPreferences",
      () =>
        updateNotificationPreferences({
          newApplicant: true,
          strongFitCandidate: true,
          interviewUpdate: true,
          capacityWarning: true,
          billingNotice: true,
        }),
    ],
  ];

  for (const [name, fn] of mutations) {
    it(`${name} reports unavailable instead of a fabricated success, in and out of production`, async () => {
      vi.stubEnv("NODE_ENV", "test");
      const devResult = await fn();
      expect(devResult.status).toBe("unavailable");

      vi.stubEnv("NODE_ENV", "production");
      const prodResult = await fn();
      expect(prodResult.status).toBe("unavailable");
    });
  }
});
