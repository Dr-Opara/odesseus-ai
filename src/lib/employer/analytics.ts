/**
 * Employer dashboard aggregation + analytics (Phase 2S).
 *
 * One read per surface instead of many raw table queries from the frontend.
 * Nothing here fabricates: every number comes from an existing store (org
 * overview, applicant counts RPC, applicant list, pipeline history, fit
 * scores, featured view, seats), and unreadable sources degrade to explicit
 * empty states rather than invented metrics.
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  getEmployerOverview,
  getEmployerSeats,
  getEmployerSubscription,
  getOrgFeaturedView,
} from "./service";
import type { EmployerClient } from "./service";
import { getPipeline, listApplicants, STRONG_FIT_THRESHOLD } from "./hiring";
import { planForTier } from "./plans";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type PipelineDistribution = Record<string, number>;

export type ApplicationsByDay = Array<{ day: string; count: number }>;

/** Count history entries per stage. Pure: unit-tested. */
export function pipelineDistribution(
  history: Array<{ stage: string }>
): PipelineDistribution {
  const distribution: PipelineDistribution = {};
  for (const entry of history) {
    distribution[entry.stage] = (distribution[entry.stage] ?? 0) + 1;
  }
  return distribution;
}

/**
 * Bucket applicant submitted dates by UTC day over the trailing window.
 * Pure: unit-tested. Applicants without a submitted date are ignored.
 */
export function bucketApplicationsByDay(
  submittedDates: Array<string | null>,
  days: number,
  now: Date = new Date()
): ApplicationsByDay {
  const buckets = new Map<string, number>();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }

  for (const submitted of submittedDates) {
    if (!submitted) continue;
    const day = new Date(submitted).toISOString().slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }

  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

export type EmployerDashboard = {
  organization: { id: string; name: string } | null;
  yourRole: string | null;
  plan: { tier: string; name: string; priceLabel: string } | null;
  subscriptionStatus: string | null;
  capacity: { included: number; published: number; remaining: number } | null;
  seats: { required: number; active: number } | null;
  jobCounts: { total: number; published: number; draft: number; closed: number };
  applicantTotal: number;
  applicantsByJob: Array<{
    jobId: string;
    jobTitle: string;
    jobStatus: string;
    applicantCount: number;
  }>;
  recentApplicants: Array<{
    applicationId: string;
    jobId: string;
    jobTitle: string;
    applicationStatus: string;
    submittedAt: string | null;
  }>;
  pipeline: PipelineDistribution;
  recentPipelineActivity: Array<{
    id: string;
    jobId: string;
    applicationId: string;
    stage: string;
    createdAt: string;
  }>;
  strongFitCount: number;
  featuredActive: number;
  notices: string[];
};

/**
 * The complete employer dashboard read. Applicant rows come from the
 * org-scoped RPC (service role, membership-gated inside); everything else
 * reads through the caller's own authorized session.
 */
export async function getEmployerDashboard(
  client: EmployerClient,
  service: ServiceClient,
  orgId: string,
  userId: string
): Promise<EmployerDashboard> {
  const notices: string[] = [];
  const overview = await getEmployerOverview(client, userId);

  if (!overview.organization || overview.organization.id !== orgId) {
    throw new Error("That team could not be found.");
  }

  const plan = planForTier(overview.subscription?.tier);
  const published = overview.jobCounts.published;
  const included = plan && overview.subscription && ["active", "trialing"].includes(overview.subscription.status)
    ? plan.jobPostsIncluded
    : 0;

  const [applicantCounts, applicants, pipeline, fitRows, featured] = await Promise.all([
    service
      .rpc("odesseus_get_employer_applicant_counts", { p_org_id: orgId })
      .then(
        (result) => {
          if (result.error) {
            notices.push("Could not load applicant counts.");
            return [];
          }
          return (result.data ?? []) as Array<{
            employer_job_id: string;
            job_title: string;
            job_status: string;
            applicant_count: number | string;
          }>;
        }
      ),
    listApplicants(client, orgId).catch((error: unknown) => {
      notices.push("Could not load applicants.");
      console.error("[ODESSEUS_EMPLOYER_DASHBOARD] applicants failed", error);
      return [];
    }),
    getPipeline(client, orgId).catch((error: unknown) => {
      notices.push("Could not load the hiring pipeline.");
      console.error("[ODESSEUS_EMPLOYER_DASHBOARD] pipeline failed", error);
      return [];
    }),
    client
      .from("employer_fit_scores")
      .select("job_id,score")
      .eq("org_id", orgId)
      .then((result) => {
        if (result.error) {
          notices.push("Could not load Fit Scores.");
          return [];
        }
        return (result.data ?? []) as Array<{ job_id: string; score: number }>;
      }),
    getOrgFeaturedView(client, orgId, userId).catch((error: unknown) => {
      notices.push("Could not load featured listings.");
      console.error("[ODESSEUS_EMPLOYER_DASHBOARD] featured failed", error);
      return null;
    }),
  ]);

  const applicantTotal = applicantCounts.reduce(
    (sum, row) => sum + Number(row.applicant_count ?? 0),
    0
  );
  const strongFitCount = fitRows.filter((row) => row.score >= STRONG_FIT_THRESHOLD).length;

  return {
    organization: { id: overview.organization.id, name: overview.organization.name },
    yourRole: overview.yourRole,
    plan: plan
      ? { tier: plan.tier, name: plan.name, priceLabel: `${plan.priceLabel}${plan.unit}` }
      : null,
    subscriptionStatus: overview.subscription?.status ?? null,
    capacity: { included, published, remaining: Math.max(0, included - published) },
    seats: overview.seats
      ? { required: overview.seats.required, active: overview.seats.active }
      : null,
    jobCounts: overview.jobCounts,
    applicantTotal,
    applicantsByJob: applicantCounts.map((row) => ({
      jobId: row.employer_job_id,
      jobTitle: row.job_title,
      jobStatus: row.job_status,
      applicantCount: Number(row.applicant_count ?? 0),
    })),
    recentApplicants: applicants.slice(0, 8).map((a) => ({
      applicationId: a.applicationId,
      jobId: a.jobId,
      jobTitle: a.jobTitle,
      applicationStatus: a.applicationStatus,
      submittedAt: a.submittedAt,
    })),
    pipeline: pipelineDistribution(pipeline),
    recentPipelineActivity: pipeline.slice(-8).reverse().map((entry) => ({
      id: entry.id,
      jobId: entry.jobId,
      applicationId: entry.applicationId,
      stage: entry.stage,
      createdAt: entry.createdAt,
    })),
    strongFitCount,
    featuredActive: featured?.listings.filter((l) => l.isBoosted).length ?? 0,
    notices: [...overview.notices, ...notices],
  };
}

export type EmployerAnalytics = {
  applicationsByJob: EmployerDashboard["applicantsByJob"];
  applicationsOverTime: ApplicationsByDay;
  pipeline: PipelineDistribution;
  strongFitByJob: Array<{ jobId: string; count: number }>;
  jobsActive: number;
  jobsClosed: number;
  featured: Array<{
    id: string;
    jobId: string;
    jobTitle: string | null;
    tier: string;
    isBoosted: boolean;
    startsAt: string | null;
    expiresAt: string | null;
  }>;
  outcomes: { hired: number; rejected: number };
  team: { members: number; seatsRequired: number; seatsActive: number };
};

/** Analytics over real hiring data. No invented metrics. */
export async function getEmployerAnalytics(
  client: EmployerClient,
  service: ServiceClient,
  orgId: string,
  userId: string,
  days = 30
): Promise<EmployerAnalytics> {
  const windowDays = Math.min(Math.max(days, 7), 90);
  const overview = await getEmployerOverview(client, userId);

  if (!overview.organization || overview.organization.id !== orgId) {
    throw new Error("That team could not be found.");
  }

  const [applicantCounts, applicants, pipeline, fitRows, featured] = await Promise.all([
    service
      .rpc("odesseus_get_employer_applicant_counts", { p_org_id: orgId })
      .then((result) =>
        ((result.error ? [] : result.data) ?? []) as Array<{
          employer_job_id: string;
          job_title: string;
          job_status: string;
          applicant_count: number | string;
        }>
      ),
    listApplicants(client, orgId).catch(() => []),
    getPipeline(client, orgId).catch(() => []),
    client
      .from("employer_fit_scores")
      .select("job_id,score")
      .eq("org_id", orgId)
      .then((result) =>
        ((result.error ? [] : result.data) ?? []) as Array<{ job_id: string; score: number }>
      ),
    getOrgFeaturedView(client, orgId, userId).catch(() => null),
  ]);

  const strongByJob = new Map<string, number>();
  for (const row of fitRows) {
    if (row.score >= STRONG_FIT_THRESHOLD) {
      strongByJob.set(row.job_id, (strongByJob.get(row.job_id) ?? 0) + 1);
    }
  }

  const distribution = pipelineDistribution(pipeline);

  return {
    applicationsByJob: applicantCounts.map((row) => ({
      jobId: row.employer_job_id,
      jobTitle: row.job_title,
      jobStatus: row.job_status,
      applicantCount: Number(row.applicant_count ?? 0),
    })),
    applicationsOverTime: bucketApplicationsByDay(
      applicants.map((a) => a.submittedAt),
      windowDays
    ),
    pipeline: distribution,
    strongFitByJob: [...strongByJob.entries()].map(([jobId, count]) => ({ jobId, count })),
    jobsActive: overview.jobCounts.published,
    jobsClosed: overview.jobCounts.closed,
    featured: (featured?.listings ?? []).map((l) => ({
      id: l.id,
      jobId: l.jobId,
      jobTitle: l.jobTitle,
      tier: l.tier,
      isBoosted: l.isBoosted,
      startsAt: l.startsAt,
      expiresAt: l.expiresAt,
    })),
    outcomes: { hired: distribution.hired ?? 0, rejected: distribution.rejected ?? 0 },
    team: {
      members: overview.members.length,
      seatsRequired: overview.seats?.required ?? 0,
      seatsActive: overview.seats?.active ?? 0,
    },
  };
}

export type EmployerBillingView = {
  plan: { tier: string; name: string; priceLabel: string } | null;
  subscriptionStatus: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  capacity: { included: number; published: number; remaining: number };
  seats: { required: number; active: number; activeUntil: string | null } | null;
  featuredActive: number;
};

/** Current billing posture: plan, period, capacity, seats, featured. */
export async function getEmployerBilling(
  client: EmployerClient,
  orgId: string,
  userId: string
): Promise<EmployerBillingView> {
  const [subscription, seats, featured, overview] = await Promise.all([
    getEmployerSubscription(client, orgId),
    getEmployerSeats(client, orgId),
    getOrgFeaturedView(client, orgId, userId).catch(() => null),
    getEmployerOverview(client, userId),
  ]);

  if (!overview.organization || overview.organization.id !== orgId) {
    throw new Error("That team could not be found.");
  }

  const plan = planForTier(subscription?.tier);
  const live =
    !!subscription && ["active", "trialing"].includes(subscription.status);
  const included = live && plan ? plan.jobPostsIncluded : 0;
  const published = overview.jobCounts.published;

  return {
    plan: plan
      ? { tier: plan.tier, name: plan.name, priceLabel: `${plan.priceLabel}${plan.unit}` }
      : null,
    subscriptionStatus: subscription?.status ?? null,
    periodStart: subscription?.periodStart ?? null,
    periodEnd: subscription?.periodEnd ?? null,
    capacity: { included, published, remaining: Math.max(0, included - published) },
    seats: seats
      ? { required: seats.required, active: seats.active, activeUntil: seats.activeUntil }
      : null,
    featuredActive: featured?.listings.filter((l) => l.isBoosted).length ?? 0,
  };
}

// Re-exported for route convenience without pulling the whole service.
export { getEmployerSeats, getEmployerSubscription, getOrgFeaturedView };
