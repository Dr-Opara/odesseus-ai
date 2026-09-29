import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Employer adapter contracts.
 *
 * This file used to assert that every read returned a development fixture
 * outside production and that every mutation refused. Both halves described a
 * backend that did not exist. It now exists, and the adapters call it, so the
 * meaningful assertions are different:
 *
 *  1. **No adapter reaches for a fixture.** The environment gate is gone, and
 *     a surviving reference to the deleted fixture directory or an
 *     `isProductionRuntime` branch would mean one screen can still render
 *     invented hiring data in production. This is the regression that
 *     mattered, and it is checked statically because the reads need a live
 *     database to exercise.
 *  2. **The org is resolved server-side from the membership row**, never from
 *     a caller-supplied id. An adapter that accepted an `orgId` parameter would
 *     let a page point itself at another company's data.
 *  3. **Mutations never fabricate success.** Each one returns `unavailable`
 *     outside a real backend session, which is the honest failure — it is what
 *     a page renders as an error rather than a false confirmation.
 *  4. **Fit Score is read, never computed.**
 *
 * Behaviour against the real backend is covered by the integration suite
 * (tests/integration/employer-*.test.ts), which has a database to talk to.
 */

import {
  getEmployerJobs,
  getEmployerJob,
  createEmployerJob,
  updateEmployerJob,
  publishEmployerJob,
  closeEmployerJob,
  deleteEmployerJob,
  featureEmployerJob,
  getEmployerCapacity,
} from "@/lib/employers/jobs-adapter";
import { getCandidates, getCandidateDetail, requestFitScore } from "@/lib/employers/candidates-adapter";
import { getPipelineBoard, moveCandidateStage } from "@/lib/employers/pipeline-adapter";
import { getEmployerAnalytics, getAnalyticsEntitlement } from "@/lib/employers/analytics-adapter";
import { getTeamView, getTeamMembers, inviteTeamMember, revokeTeamMember } from "@/lib/employers/team-adapter";
import {
  getEmployerProfile,
  submitCompanyDetails,
  submitPlanSelection,
  completeOnboarding,
  updateCompanyProfile,
} from "@/lib/employers/onboarding-adapter";
import {
  getEmployerBilling,
  changeEmployerPlan,
  purchaseRecruiterSeat,
} from "@/lib/employers/billing-adapter";
import { getFeaturedOverview } from "@/lib/employers/featured-adapter";
import { getFeaturedJobPackages } from "@/lib/employers/featured-packages";
import { startFeaturedCheckoutAction } from "@/lib/employers/actions";
import {
  getEmployerNotifications,
  getUnreadNotificationCount,
  getNotificationPreferences,
  markNotificationRead,
  markAllNotificationsRead,
  updateNotificationPreferences,
} from "@/lib/employers/notifications-adapter";
import { PIPELINE_STAGES } from "@/lib/employers/types";
import { STORED_STAGES, toProductStage, toStoredStage } from "@/lib/employers/stages";
import {
  buildJobDescription,
  parseJobDescription,
  splitRequirementLines,
} from "@/lib/employers/job-description";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ADAPTER_FILES = [
  "src/lib/employers/jobs-adapter.ts",
  "src/lib/employers/candidates-adapter.ts",
  "src/lib/employers/pipeline-adapter.ts",
  "src/lib/employers/analytics-adapter.ts",
  "src/lib/employers/team-adapter.ts",
  "src/lib/employers/onboarding-adapter.ts",
  "src/lib/employers/billing-adapter.ts",
  "src/lib/employers/featured-adapter.ts",
  "src/lib/employers/notifications-adapter.ts",
  "src/lib/employers/context.ts",
];

function readSource(file: string) {
  return readFileSync(join(process.cwd(), file), "utf8");
}

describe("no employer adapter can serve fixture data", () => {
  it("no adapter references the deleted fixture directory", () => {
    for (const file of ADAPTER_FILES) {
      expect(readSource(file), `${file} must not import employer fixtures`).not.toMatch(
        /employers\/fixtures/
      );
    }
  });

  it("no adapter gates its data source on the environment", () => {
    // An environment gate is how a fixture path survives: the read works in
    // development and silently changes in production. Every adapter now has
    // one real source, so the gate should be gone entirely.
    for (const file of ADAPTER_FILES) {
      expect(readSource(file), `${file} must not branch on the runtime`).not.toContain(
        "isProductionRuntime"
      );
    }
  });

  it("the fixture directory is gone from the tree", () => {
    expect(() => readSource("src/lib/employers/fixtures/jobs.ts")).toThrow();
  });
});

describe("every adapter resolves the org from the session, not from a parameter", () => {
  it("no exported read or write accepts an orgId argument", () => {
    // An adapter that took `orgId` would let a page name another company's
    // organization. Resolution goes through resolveEmployerContext, which
    // reads the membership row.
    for (const file of ADAPTER_FILES) {
      const source = readSource(file);
      const signatures = source.match(/export async function \w+\([^)]*\)/g) ?? [];
      for (const signature of signatures) {
        expect(signature, `${file}: ${signature}`).not.toMatch(/orgId/);
      }
    }
  });

  it("context resolution reads the membership row, not a URL value", () => {
    const source = readSource("src/lib/employers/context.ts");
    expect(source).toContain("getEmployerOrganization");
    expect(source).toContain("getEmployerRole");
    expect(source).toContain("getEmployerUserId");
  });
});

describe("employer reads refuse honestly without a real session", () => {
  // There is no session in a unit test, so every read resolves the context to
  // unavailable. That is the correct behaviour and the one a page renders as
  // an error state — importantly, not as invented data.
  const reads: [string, () => Promise<{ status: string; reason?: string }>][] = [
    ["getEmployerJobs", getEmployerJobs],
    ["getEmployerJob", () => getEmployerJob("00000000-0000-0000-0000-000000000000")],
    ["getCandidates", () => getCandidates()],
    ["getCandidateDetail", () => getCandidateDetail("00000000-0000-0000-0000-000000000000")],
    ["getPipelineBoard", getPipelineBoard],
    ["getEmployerAnalytics", () => getEmployerAnalytics()],
    ["getAnalyticsEntitlement", getAnalyticsEntitlement],
    ["getTeamView", getTeamView],
    ["getTeamMembers", getTeamMembers],
    ["getEmployerProfile", getEmployerProfile],
    ["getEmployerBilling", getEmployerBilling],
    ["getFeaturedOverview", getFeaturedOverview],
    ["getEmployerNotifications", getEmployerNotifications],
    ["getUnreadNotificationCount", getUnreadNotificationCount],
    ["getNotificationPreferences", getNotificationPreferences],
    ["getEmployerCapacity", getEmployerCapacity],
  ];

  for (const [name, fn] of reads) {
    it(`${name} reports unavailable rather than fabricated data`, async () => {
      const result = await fn();
      expect(result.status).toBe("unavailable");
      // An empty array would also be "unavailable-looking" but silently
      // renders as "you have no jobs". A reason is what makes the difference
      // between an error and an empty state visible to the user.
      expect(result.reason, `${name} must explain why it is unavailable`).toBeTruthy();
    });
  }
});

describe("employer mutations never fabricate success", () => {
  // Each returns `unavailable` with no session. The point is that none of them
  // resolves `ok`: a mutation that reported success without a backend would
  // tell the employer their job is live, their seat is bought, or their
  // applicant was moved when none of that happened.
  const mutations: [string, () => Promise<{ status: string; reason?: string }>][] = [
    ["createEmployerJob", () => createEmployerJob({ title: "x" })],
    ["updateEmployerJob", () => updateEmployerJob("00000000-0000-0000-0000-000000000000", {})],
    ["publishEmployerJob", () => publishEmployerJob("00000000-0000-0000-0000-000000000000")],
    ["closeEmployerJob", () => closeEmployerJob("00000000-0000-0000-0000-000000000000")],
    ["deleteEmployerJob", () => deleteEmployerJob("00000000-0000-0000-0000-000000000000")],
    ["featureEmployerJob", () => featureEmployerJob("00000000-0000-0000-0000-000000000000", "featured-7")],
    ["moveCandidateStage", () => moveCandidateStage("00000000-0000-0000-0000-000000000000", "REVIEWING")],
    ["requestFitScore", () => requestFitScore("00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000")],
    ["inviteTeamMember", () => inviteTeamMember("a@b.com", "Recruiter")],
    ["revokeTeamMember", () => revokeTeamMember("00000000-0000-0000-0000-000000000000")],
    ["submitCompanyDetails", () => submitCompanyDetails({ companyName: "x" })],
    ["submitPlanSelection", () => submitPlanSelection("Starter")],
    ["completeOnboarding", completeOnboarding],
    ["updateCompanyProfile", () => updateCompanyProfile({ companyName: "x" })],
    ["changeEmployerPlan", () => changeEmployerPlan("Growth")],
    ["purchaseRecruiterSeat", purchaseRecruiterSeat],
    ["startFeaturedCheckoutAction", () => startFeaturedCheckoutAction("00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", "featured_7d")],
    ["markNotificationRead", () => markNotificationRead("00000000-0000-0000-0000-000000000000")],
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
    it(`${name} reports unavailable instead of a fabricated success`, async () => {
      const result = await fn();
      expect(result.status).toBe("unavailable");
    });
  }
});

describe("a purchase opens checkout and grants nothing itself", () => {
  // Plan changes, seats, and featured listings are all paid. Each returns a
  // checkout URL and stops there; the webhook confirms payment before any
  // entitlement exists. A component that "succeeded" locally would show an
  // employer a plan or a boost they had not paid for.
  for (const file of [
    "src/lib/employers/billing-adapter.ts",
    "src/lib/employers/featured-adapter.ts",
    "src/lib/employers/jobs-adapter.ts",
    "src/lib/employers/team-adapter.ts",
  ]) {
    it(`${file} starts a checkout instead of granting directly`, () => {
      const source = readSource(file);
      expect(source).toMatch(/checkout/);
    });
  }
});

describe("Fit Score is read, never computed in the frontend", () => {
  it("the candidates adapter calls the backend scorer and does not do arithmetic on a score", () => {
    const source = readSource("src/lib/employers/candidates-adapter.ts");
    // It may read `score` and pass it through, and it may post to the scoring
    // route. It must not derive one.
    expect(source).toContain("getFitScore");
    expect(source).toContain("fit-score");
    expect(source).not.toMatch(/fitScore\s*[:=]\s*\d/);
    expect(source).not.toMatch(/overall\s*[:=]\s*.*\/.*\d/);
  });
});

describe("the featured packages are approved commercial data, not a fixture", () => {
  it("exposes the three locked packages with the approved prices", () => {
    const packages = getFeaturedJobPackages();
    expect(packages.map((p) => p.id)).toEqual(["featured-7", "featured-14", "ai-featured-30"]);
    expect(packages.map((p) => p.priceLabel)).toEqual(["$29", "$49", "$129"]);
    expect(packages.map((p) => p.days)).toEqual([7, 14, 30]);
  });

  it("maps each package onto the backend tier the checkout charges", () => {
    const packages = getFeaturedJobPackages();
    expect(packages.map((p) => p.tier)).toEqual(["featured_7d", "featured_14d", "ai_30d"]);
  });
});

describe("pipeline stage vocabulary is translated in exactly one place", () => {
  it("the stored and product vocabularies are the same seven stages", () => {
    expect([...STORED_STAGES].map(toProductStage).sort()).toEqual([...PIPELINE_STAGES].sort());
  });

  it("round-trips every stage", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(toProductStage(toStoredStage(stage))).toBe(stage);
    }
  });
});

describe("the job description block round-trips the fields with no column", () => {
  it("keeps every field the form collects", () => {
    const built = buildJobDescription({
      body: "Own application security.",
      department: "Engineering",
      employmentType: "Full-time",
      compensationText: "$180K–$220K",
      responsibilities: ["Threat modelling", "Secure code review"],
    });
    expect(built).toBeTruthy();

    const parsed = parseJobDescription(built);
    expect(parsed.body).toBe("Own application security.");
    expect(parsed.department).toBe("Engineering");
    expect(parsed.employmentType).toBe("Full-time");
    expect(parsed.compensationText).toBe("$180K–$220K");
    expect(parsed.responsibilities).toEqual(["Threat modelling", "Secure code review"]);
  });

  it("returns null rather than an empty string when nothing was entered", () => {
    expect(buildJobDescription({})).toBeNull();
    expect(buildJobDescription({ body: "   " })).toBeNull();
  });

  it("handles an absent description", () => {
    expect(parseJobDescription(null)).toEqual({});
    expect(splitRequirementLines(undefined)).toBeUndefined();
  });

  it("does not mistake a body line for a label", () => {
    const built = buildJobDescription({ body: "Departmental lead role" });
    expect(parseJobDescription(built).department).toBeUndefined();
    expect(parseJobDescription(built).body).toBe("Departmental lead role");
  });
});
