/**
 * Employer dashboard adapter (F1). Production uses the real backend:
 * GET `/api/employer/orgs/{orgId}/dashboard` returns the whole hiring
 * overview in one read — organization, plan, capacity, seats, job counts,
 * applicant volume, strong-fit count, recent applicants, recent pipeline
 * activity, and any read gaps as `notices`.
 *
 * Nothing on the dashboard is derived from a fixture in production, and no
 * number is invented: a value the backend could not read appears as a notice
 * rather than as a zero.
 */
import { employerApi } from "./api-client";
import {
  toEmployerPlanId,
  type EmployerDashboardSnapshot,
  type EmployerPlanId,
} from "./types";
import type { EmployerResult } from "./result";

type BackendDashboard = {
  organization?: { id: string; name: string } | null;
  plan?: { tier?: string; name?: string; priceLabel?: string } | null;
  subscriptionStatus?: string | null;
  capacity?: { included: number; published: number; remaining: number } | null;
  seats?: { required: number; active: number } | null;
  jobCounts?: { total?: number; published?: number; draft?: number; closed?: number } | null;
  applicantTotal?: number;
  strongFitCount?: number;
  recentApplicants?: EmployerDashboardSnapshot["recentApplicants"];
  recentPipelineActivity?: EmployerDashboardSnapshot["recentPipelineActivity"];
  featuredActive?: number;
  notices?: string[];
};

const PLAN_BY_NAME: Record<string, EmployerPlanId> = {
  Starter: "Starter",
  Growth: "Growth",
  Business: "Business",
};

function toPlanName(dashboard: BackendDashboard): EmployerPlanId | null {
  const tier = dashboard.plan?.tier ?? null;
  if (tier) return toEmployerPlanId(tier);
  const name = dashboard.plan?.name ?? null;
  return name ? (PLAN_BY_NAME[name] ?? null) : null;
}

function toSnapshot(dashboard: BackendDashboard): EmployerDashboardSnapshot {
  return {
    organizationName: dashboard.organization?.name ?? null,
    planName: toPlanName(dashboard),
    subscriptionStatus: dashboard.subscriptionStatus ?? null,
    capacity: dashboard.capacity ?? null,
    seats: dashboard.seats ?? null,
    jobCounts: {
      total: dashboard.jobCounts?.total ?? 0,
      published: dashboard.jobCounts?.published ?? 0,
      draft: dashboard.jobCounts?.draft ?? 0,
      closed: dashboard.jobCounts?.closed ?? 0,
    },
    applicantTotal: dashboard.applicantTotal ?? 0,
    strongFitCount: dashboard.strongFitCount ?? 0,
    recentApplicants: dashboard.recentApplicants ?? [],
    recentPipelineActivity: dashboard.recentPipelineActivity ?? [],
    featuredActive: dashboard.featuredActive ?? 0,
    notices: dashboard.notices ?? [],
  };
}

export async function getEmployerDashboard(orgId: string): Promise<EmployerResult<EmployerDashboardSnapshot>> {
  const response = await employerApi<{ dashboard?: BackendDashboard }>(
    `/api/employer/orgs/${orgId}/dashboard`
  );
  if (response.ok) return { status: "ok", data: toSnapshot(response.data?.dashboard ?? {}), source: "live" };
  return { status: "unavailable", reason: response.reason };
}
