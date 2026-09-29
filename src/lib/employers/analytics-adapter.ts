/**
 * Employer hiring analytics adapter — real backend aggregate.
 *
 * Replaces a development fixture that carried invented applicant counts and
 * stage distribution. The analytics backend exists
 * (`src/lib/employer/analytics.ts`, exposed through
 * `GET /api/employer/orgs/[orgId]/analytics`) and returns real aggregates:
 * applications by job, applications over time, pipeline distribution,
 * strong-fit counts per job, active/closed job counts, featured listings,
 * hiring outcomes, and team usage.
 *
 * The counts are the backend's, verbatim. This adapter does not derive an
 * applicant count, does not estimate a conversion rate the backend did not
 * return, and does not fall back to zeros: an org with no data reads as no
 * data, which is a different statement from "0 applicants".
 *
 * The plan gate is presentation, not authorization. The analytics route is
 * open to any org member; the Growth+ framing is a Figma product decision, so
 * the tier is resolved here and rendered as an upgrade prompt. The backend
 * remains the only thing that decides who may read what.
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
// Aliased: the backend service and this adapter expose the same function
// name, and the service is the one that does the querying.
import { getEmployerAnalytics as readBackendAnalytics } from "@/lib/employer/analytics";
import { getEmployerSubscription } from "@/lib/employer/service";
import { planForTier } from "@/lib/employer/plans";
import { resolveEmployerContext } from "./context";
import { toProductStage, isStoredStage } from "./stages";
import type { EmployerAnalyticsSnapshot } from "./types";
import type { EmployerResult } from "./result";

/**
 * The analytics payload plus the two facts the screen needs that are not part
 * of the aggregate itself.
 */
export type EmployerAnalyticsView = EmployerAnalyticsSnapshot & {
  /** Applications submitted over the requested window, by day. */
  applicationsOverTime: { date: string; count: number }[];
  /** Real hiring outcomes, from the backend's own counts. */
  outcomes: { hired: number; rejected: number };
  /** Active and closed job counts. */
  jobsActive: number;
  jobsClosed: number;
  /** Team size and seat usage, for the usage panel. */
  team: { members: number; seatsRequired: number; seatsActive: number };
};

/**
 * The organization's hiring analytics.
 *
 * `days` is the window for the over-time series; the pipeline distribution and
 * the applicant totals are the backend's current-state aggregates, not
 * windowed, because a pipeline snapshot is a snapshot.
 */
export async function getEmployerAnalytics(
  options?: { days?: number }
): Promise<EmployerResult<EmployerAnalyticsView>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  const days = clampWindow(options?.days);

  try {
    const viewer = await createClient();
    const service = createServiceClient();
    const analytics = await readBackendAnalytics(
      viewer,
      service,
      resolved.context.orgId,
      resolved.context.userId,
      days
    );

    // Applicant volume is the sum of the per-job counts the backend returned.
    // It is summed, never defaulted: an org with no jobs reports 0 because the
    // backend returned no rows, not because a fallback supplied a number.
    const applicantVolume = analytics.applicationsByJob.reduce(
      (total, row) => total + row.applicantCount,
      0
    );

    const strongFitCandidates = analytics.strongFitByJob.reduce(
      (total, row) => total + row.count,
      0
    );

    const stageDistribution: EmployerAnalyticsSnapshot["stageDistribution"] = {};
    for (const [stage, count] of Object.entries(analytics.pipeline)) {
      // The backend keys the distribution by its own lowercase vocabulary;
      // anything unrecognised is skipped rather than shown under a stage that
      // does not exist in the locked set.
      if (isStoredStage(stage)) {
        stageDistribution[toProductStage(stage)] = count;
      }
    }

    // The backend buckets by day; the carousel's series labels the bucket
    // `date`. It is the same value under the display field name.
    const overTime = analytics.applicationsOverTime.map((bucket) => ({
      date: bucket.day,
      count: bucket.count,
    }));

    return {
      status: "ok",
      source: "live",
      data: {
        applicantVolume,
        strongFitCandidates,
        stageDistribution,
        activeJobs: analytics.jobsActive,
        hiringActivityOverTime: overTime,
        applicationsOverTime: overTime,
        outcomes: analytics.outcomes,
        jobsActive: analytics.jobsActive,
        jobsClosed: analytics.jobsClosed,
        team: analytics.team,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_ANALYTICS] read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your hiring analytics." };
  }
}

/**
 * Whether the organization is on a plan that includes hiring analytics.
 *
 * Figma gates this screen to Growth and above. The answer is read from the
 * stored subscription, so a tier the build does not recognise yields
 * `isGrowthOrAbove: false` — an honest "ask us" state rather than silently
 * inheriting another plan's entitlement.
 */
export async function getAnalyticsEntitlement(): Promise<
  EmployerResult<{ isGrowthOrAbove: boolean; planName: string | null }>
> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const subscription = await getEmployerSubscription(supabase, resolved.context.orgId);
    const plan = planForTier(subscription?.tier);

    if (!plan) {
      return { status: "ok", source: "live", data: { isGrowthOrAbove: false, planName: null } };
    }

    return {
      status: "ok",
      source: "live",
      data: {
        isGrowthOrAbove: plan.tier === "growth" || plan.tier === "business",
        planName: plan.name,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_ANALYTICS] entitlement read failed", message);
    return { status: "unavailable", reason: "Odesseus could not check your plan." };
  }
}

/** The analytics route accepts 7-90 days; this keeps the same bound. */
function clampWindow(days: number | undefined): number {
  if (typeof days !== "number" || !Number.isFinite(days)) return 30;
  return Math.min(Math.max(Math.trunc(days), 7), 90);
}
