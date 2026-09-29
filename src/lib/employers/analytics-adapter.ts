/**
 * Employer analytics adapter (F1). Production uses the real
 * `GET /api/employer/orgs/{orgId}/analytics` read. Nothing here is derived
 * from a fixture in production, and no metric is computed from data the
 * backend did not return: a section the backend could not read is simply
 * absent, and the screen renders the honest empty state.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { EMPLOYER_ANALYTICS_FIXTURE } from "./fixtures/analytics";
import { toPipelineStage, type EmployerAnalyticsSnapshot } from "./types";
import type { EmployerResult } from "./result";

type BackendAnalytics = {
  applicationsByJob?: { jobId: string; jobTitle: string; applicantCount: number }[];
  applicationsOverTime?: { day: string; count: number }[];
  pipeline?: Record<string, number>;
  strongFitByJob?: { jobId: string; count: number }[];
  jobsActive?: number;
  jobsClosed?: number;
  outcomes?: { hired?: number; rejected?: number };
};

function toSnapshot(analytics: BackendAnalytics): EmployerAnalyticsSnapshot {
  const stageDistribution: EmployerAnalyticsSnapshot["stageDistribution"] = {};
  for (const [stage, count] of Object.entries(analytics.pipeline ?? {})) {
    const mapped = toPipelineStage(stage);
    if (mapped && typeof count === "number") stageDistribution[mapped] = count;
  }

  const applicantsByJob = (analytics.applicationsByJob ?? []).map((row) => ({
    jobId: row.jobId,
    jobTitle: row.jobTitle,
    applicantCount: row.applicantCount ?? 0,
  }));

  return {
    jobsActive: analytics.jobsActive ?? 0,
    jobsClosed: analytics.jobsClosed ?? 0,
    // The volume is the sum of the backend's own per-job counts, so it can
    // never disagree with the breakdown rendered beside it.
    applicantVolume: applicantsByJob.reduce((sum, row) => sum + row.applicantCount, 0),
    strongFitCandidates: (analytics.strongFitByJob ?? []).reduce((sum, row) => sum + (row.count ?? 0), 0),
    stageDistribution,
    hired: analytics.outcomes?.hired ?? 0,
    rejected: analytics.outcomes?.rejected ?? 0,
    applicationsOverTime: (analytics.applicationsOverTime ?? []).map((point) => ({
      date: point.day,
      count: point.count ?? 0,
    })),
    applicantsByJob,
  };
}

export async function getEmployerAnalytics(orgId: string): Promise<EmployerResult<EmployerAnalyticsSnapshot>> {
  const response = await employerApi<{ analytics?: BackendAnalytics }>(
    `/api/employer/orgs/${orgId}/analytics?days=30`
  );
  if (response.ok) return { status: "ok", data: toSnapshot(response.data?.analytics ?? {}), source: "live" };
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: response.reason };
  }
  return { status: "ok", data: EMPLOYER_ANALYTICS_FIXTURE, source: "fixture" };
}
