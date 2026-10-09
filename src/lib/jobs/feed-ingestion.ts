/**
 * Public homepage job-feed ingestion (Phase: homepage job feed).
 *
 * Sources -> normalize (existing provider fetchers) -> dedupe
 * ((source_key, external_id) upsert) -> freshness (last_seen_at refresh,
 * stale deactivation) -> public_job_posts -> GET /api/jobs/home-feed.
 *
 * Two source kinds:
 *  1. ATS providers via the existing fetchSourceJobs dispatch (greenhouse,
 *     lever, ashby, workable, smartrecruiters, recruitee, workday).
 *  2. Published Odesseus employer jobs, mirrored each tick (the bridge the
 *     attribution model assumes but nothing previously wrote).
 *
 * The tick is idempotent, bounded, and best-effort per source: one failing
 * provider never fails the tick. No browser scraping anywhere; only the
 * already-integrated provider APIs plus first-party employer postings.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { configuredJobSources } from "./sources";
import type { JobSourceConfig, NormalizedJobPosting } from "./types";
import { fetchSourceJobs } from "./providers";
import { fetchPublicAggregators } from "./aggregators";


type ServiceClient = ReturnType<typeof createServiceClient>;

/** Postings unseen this long are retired from the public feed. */
export const FEED_STALE_DAYS = 30;

/** At most this many companies dominate one tick's upserts; no other bound. */
export type FeedIngestionSummary = {
  sourcesConfigured: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  postingsUpserted: number;
  aggregatorUpserted: number;
  employerMirrored: number;
  employerDeactivated: number;
  deactivatedStale: number;
  errors: Array<{ source: string; message: string }>;
};

export async function runPublicFeedIngestion(
  opts: {
    service?: ServiceClient;
    sources?: JobSourceConfig[];
    fetchJobs?: (source: JobSourceConfig) => Promise<NormalizedJobPosting[]>;
    staleDays?: number;
    now?: Date;
  } = {}
): Promise<FeedIngestionSummary> {
  const service = opts.service ?? createServiceClient();
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const staleDays = opts.staleDays ?? FEED_STALE_DAYS;
  const fetchJobs = opts.fetchJobs ?? fetchSourceJobs;

  const summary: FeedIngestionSummary = {
    sourcesConfigured: 0,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    postingsUpserted: 0,
    aggregatorUpserted: 0,
    employerMirrored: 0,
    employerDeactivated: 0,
    deactivatedStale: 0,
    errors: [],
  };

  let sources: JobSourceConfig[] = [];
  try {
    sources = opts.sources ?? configuredJobSources();
  } catch (error) {
    summary.errors.push({
      source: "catalog",
      message: error instanceof Error ? error.message : String(error),
    });
    return summary;
  }
  summary.sourcesConfigured = sources.length;

  for (const source of sources) {
    try {
      const postings = await fetchJobs(source);
      if (postings.length === 0) {
        summary.sourcesSucceeded += 1;
        continue;
      }

      const rows = postings.map((posting) => ({
        source_key: posting.sourceKey,
        external_id: posting.externalId,
        provider: posting.provider,
        company_name: posting.companyName,
        title: posting.title,
        location: posting.location,
        work_arrangement: posting.workArrangement,
        employment_type: posting.employmentType,
        salary_text: posting.salaryText,
        description: posting.description,
        source_url: posting.sourceUrl,
        apply_url: posting.applyUrl,
        published_at: posting.publishedAt,
        last_seen_at: nowIso,
        is_active: true,
        updated_at: nowIso,
      }));

      const { error } = await service
        .from("public_job_posts")
        .upsert(rows, { onConflict: "source_key,external_id" });

      if (error) throw new Error(error.message);
      summary.postingsUpserted += rows.length;
      summary.sourcesSucceeded += 1;
    } catch (error) {
      summary.sourcesFailed += 1;
      summary.errors.push({
        source: `${source.provider}:${source.slug}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Public aggregators broaden coverage beyond the configured company catalog.
  // They are best-effort and normalize into the same dedupe table as ATS and employer jobs.
  try {
    const aggregatorResults = await fetchPublicAggregators();
    for (const result of aggregatorResults) {
      if (result.error) {
        summary.errors.push({ source: `aggregator:${result.source}`, message: result.error });
        continue;
      }
      if (!result.jobs.length) continue;

      const rows = result.jobs.map((job) => ({
        source_key: job.sourceKey,
        external_id: job.externalId,
        provider: job.provider,
        company_name: job.companyName,
        company_logo_url: job.companyLogoUrl,
        title: job.title,
        location: job.location,
        work_arrangement: job.workArrangement,
        employment_type: job.employmentType,
        salary_text: job.salaryText,
        description: job.description,
        source_url: job.sourceUrl,
        apply_url: job.applyUrl,
        published_at: job.publishedAt,
        last_seen_at: nowIso,
        is_active: true,
        updated_at: nowIso,
      }));

      const { error } = await service
        .from("public_job_posts")
        .upsert(rows, { onConflict: "source_key,external_id" });

      if (error) {
        summary.errors.push({ source: `aggregator:${result.source}`, message: error.message });
        continue;
      }
      summary.aggregatorUpserted += rows.length;
    }
  } catch (error) {
    summary.errors.push({
      source: "aggregators",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Employer mirror: every published posting is upserted active; employer
  // rows absent from the published set are deactivated in the same tick so
  // a closed job stops being served without waiting out the stale window.
  try {
    const { data: jobs, error: jobsError } = await service
      .from("employer_jobs")
      .select("id,title,description,location,requirements_text,preferred_text,work_arrangement,status,posted_at,employer_organizations(name)")
      .eq("status", "published");

    if (jobsError) throw new Error(jobsError.message);

    const published = (jobs ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      location: string | null;
      requirements_text: string | null;
      preferred_text: string | null;
      work_arrangement: string | null;
      status: string;
      posted_at: string | null;
      employer_organizations: { name: string } | null;
    }>;

    if (published.length > 0) {
      const descriptionOf = (job: (typeof published)[number]): string =>
        [
          job.description,
          job.requirements_text
            ? `Requirements:\n${job.requirements_text}`
            : null,
          job.preferred_text ? `Preferred:\n${job.preferred_text}` : null,
        ]
          .filter((part): part is string => !!part && part.trim().length > 0)
          .join("\n\n");

      const { error } = await service.from("public_job_posts").upsert(
        published.map((job) => ({
          source_key: "employer",
          external_id: job.id,
          provider: "employer",
          company_name: job.employer_organizations?.name ?? "Employer",
          title: job.title,
          location: job.location,
          work_arrangement: job.work_arrangement,
          employment_type: null,
          salary_text: null,
          description: descriptionOf(job),
          source_url: null,
          // Employer postings apply in-app after signup; there is no
          // external apply URL to mirror, so none is fabricated.
          apply_url: null,
          published_at: job.posted_at,
          last_seen_at: nowIso,
          is_active: true,
          updated_at: nowIso,
        })),
        { onConflict: "source_key,external_id" }
      );

      if (error) throw new Error(error.message);
      summary.employerMirrored += published.length;
    }

    const publishedIds = new Set(published.map((job) => job.id));
    const { data: mirrored, error: mirroredError } = await service
      .from("public_job_posts")
      .select("id,external_id")
      .eq("provider", "employer")
      .eq("is_active", true);

    if (mirroredError) throw new Error(mirroredError.message);

    const orphaned = ((mirrored ?? []) as Array<{ id: string; external_id: string }>).filter(
      (row) => !publishedIds.has(row.external_id)
    );

    if (orphaned.length > 0) {
      const { error } = await service
        .from("public_job_posts")
        .update({ is_active: false, updated_at: nowIso })
        .in(
          "id",
          orphaned.map((row) => row.id)
        );

      if (error) throw new Error(error.message);
      summary.employerDeactivated += orphaned.length;
    }
  } catch (error) {
    summary.errors.push({
      source: "employer-mirror",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Staleness retirement across all sources.
  try {
    const cutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await service
      .from("public_job_posts")
      .update({ is_active: false, updated_at: nowIso })
      .eq("is_active", true)
      .lt("last_seen_at", cutoff)
      .select("id");

    if (error) throw new Error(error.message);
    summary.deactivatedStale += (data ?? []).length;
  } catch (error) {
    summary.errors.push({
      source: "staleness",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return summary;
}
