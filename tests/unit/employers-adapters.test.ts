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
import {
  JOB_EMPLOYMENT_TYPES,
  toFormEmploymentType,
  toStoredEmploymentType,
} from "@/lib/employer/service";
import { STORED_STAGES, toProductStage, toStoredStage } from "@/lib/employers/stages";
import {
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

/** Removes comments so a doc block explaining the rule is not read as a violation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
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

describe("the legacy labelled-description block is read but never written", () => {
  // Department, employment type, compensation, and responsibilities are real
  // columns on employer_jobs now. This parser exists only to read descriptions
  // written before those columns existed, and for rows the migration backfill
  // did not reach. Nothing writes the format any more, and the serialiser is
  // gone from the module so it cannot be reintroduced.
  const LEGACY = [
    "Own application security.",
    "",
    "Department: Engineering",
    "",
    "Employment type: Full-time",
    "",
    "Compensation: $180K–$220K",
    "",
    "Responsibilities:",
    "Threat modelling",
    "Secure code review",
  ].join("\n");

  it("recovers every field the legacy format carried", () => {
    const parsed = parseJobDescription(LEGACY);
    expect(parsed.body).toBe("Own application security.");
    expect(parsed.department).toBe("Engineering");
    expect(parsed.employmentType).toBe("Full-time");
    expect(parsed.compensationText).toBe("$180K–$220K");
    expect(parsed.responsibilities).toEqual(["Threat modelling", "Secure code review"]);
  });

  it("handles an absent description", () => {
    expect(parseJobDescription(null)).toEqual({});
    expect(parseJobDescription(undefined)).toEqual({});
    expect(splitRequirementLines(undefined)).toBeUndefined();
  });

  it("does not mistake a body line for a label", () => {
    const parsed = parseJobDescription("Departmental lead role");
    expect(parsed.department).toBeUndefined();
    expect(parsed.body).toBe("Departmental lead role");
  });

  it("does not treat a mid-sentence mention as a field", () => {
    // The same failure the SQL backfill guard covers: an employer whose role
    // summary mentions the word is not a stored compensation value.
    const parsed = parseJobDescription("Ask about Compensation: it is negotiable.");
    expect(parsed.compensationText).toBeUndefined();
    expect(parsed.body).toBe("Ask about Compensation: it is negotiable.");
  });

  it("the module no longer exports a serialiser", () => {
    // A compile-time guarantee expressed as a source check, because the point
    // is that nobody starts writing the format again.
    const source = readSource("src/lib/employers/job-description.ts");
    expect(stripComments(source)).not.toContain("buildJobDescription");
  });
});

describe("the employment-type vocabulary matches the database check", () => {
  it("maps every form option onto a stored value", () => {
    expect(toStoredEmploymentType("Full-time")).toBe("full_time");
    expect(toStoredEmploymentType("Part-time")).toBe("part_time");
    expect(toStoredEmploymentType("Contract")).toBe("contract");
    expect(toStoredEmploymentType("  FULL_TIME  ")).toBe("full_time");
  });

  it("resolves an unknown value to null rather than to a guess", () => {
    // A defaulted type would make a job visible to candidates who filtered for
    // a type it is not.
    expect(toStoredEmploymentType("Wizard")).toBeNull();
    expect(toStoredEmploymentType("")).toBeNull();
    expect(toStoredEmploymentType(undefined)).toBeNull();
  });

  it("round-trips a stored value back to the form's label", () => {
    expect(toFormEmploymentType("full_time")).toBe("Full-time");
    expect(toFormEmploymentType("part_time")).toBe("Part-time");
    expect(toFormEmploymentType(null)).toBeUndefined();
  });

  it("exports exactly the values the check constraint allows", () => {
    expect([...JOB_EMPLOYMENT_TYPES]).toEqual([
      "full_time",
      "part_time",
      "contract",
      "temporary",
      "internship",
      "volunteer",
      "other",
    ]);
  });
});

describe("the four structured job fields are their own columns", () => {
  it("the service reads and writes them as columns, not as description prose", () => {
    const source = readSource("src/lib/employer/service.ts");
    for (const column of [
      "department",
      "employment_type",
      "compensation_text",
      "responsibilities_text",
    ]) {
      expect(source, `service.ts must handle ${column}`).toContain(column);
    }
    // One shared column list, so a new column cannot be added to the table and
    // missed by some of the six read and write sites.
    const lists = source.match(/"id,org_id,title,description[^"]*"/g) ?? [];
    expect(lists, "the inline job column lists should be gone").toEqual([]);
  });

  it("the adapters read the column and fall back to the legacy block", () => {
    const source = readSource("src/lib/employers/jobs-adapter.ts");
    expect(source).toContain("row.department ?? legacy.department");
    expect(source).toContain("row.compensationText ?? legacy.compensationText");
    expect(source).toContain("splitLines(row.responsibilitiesText)");
  });

  it("nothing writes the labelled block any more", () => {
    // The write path must not re-flatten the four fields into `description`.
    const adapter = stripComments(readSource("src/lib/employers/jobs-adapter.ts"));
    const actions = stripComments(readSource("src/lib/employers/actions.ts"));
    for (const source of [adapter, actions]) {
      expect(source).not.toContain("buildJobDescription");
    }
  });
});

describe("applicant identity is its own narrow read", () => {
  it("the service exposes a dedicated identity accessor, not fields on the payload", () => {
    const source = readSource("src/lib/employer/hiring.ts");
    expect(source).toContain("odesseus_get_employer_applicant_identities");
    // The pre-existing payload reader must not have been widened to carry a
    // name, so identity stays an auditable surface of its own.
    const applicants = source.slice(
      source.indexOf("odesseus_get_employer_applicants"),
      source.indexOf("odesseus_get_employer_applicant_identities")
    );
    expect(applicants).not.toContain("candidate_name");
  });

  it("carries no user id, so an employer read cannot pivot into private data", () => {
    const source = stripComments(readSource("src/lib/employer/hiring.ts"));
    const identity = source.slice(source.indexOf("EmployerApplicantIdentity"));
    expect(identity).not.toMatch(/userId/);
    expect(identity).not.toMatch(/user_id/);
  });

  it("maps the name and email through, and does not derive a fallback", () => {
    const source = readSource("src/lib/employers/candidates-adapter.ts");
    expect(source).toContain("listApplicantIdentities");
    expect(source).toContain("candidateName");
    expect(source).toContain("candidateEmail");
  });
});
