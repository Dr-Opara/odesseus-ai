import { createServiceClient } from "@/lib/supabase/service";
import { assessJobMatch } from "@/lib/ai/match";
import { resumeProfileSchema } from "@/lib/ai/schemas";
import { configuredJobSources, sourceKey } from "./sources";
import { fetchSourceJobs } from "./providers";
import { passesPreferencePrefilter } from "./prefilter";
import type { DiscoverySummary, NormalizedJobPosting } from "./types";

type UserContext = {
  userId: string;
  profile: Record<string, unknown>;
  preferences: {
    min_match_score: number;
    target_titles: string[];
    target_locations: string[];
    employment_types: string[];
    industries: string[];
    remote_only: boolean;
    minimum_salary: number | null;
    work_authorization: string | null;
    sponsorship_needed: boolean | null;
  } | null;
  resume: ReturnType<typeof resumeProfileSchema.parse>;
};

const DEFAULT_MAX_MATCHES_PER_USER = 12;

export async function runAutomaticJobDiscovery(options?: {
  userIds?: string[];
  maxMatchesPerUser?: number;
}): Promise<DiscoverySummary> {
  const service = createServiceClient();
  const sources = configuredJobSources();
  const maxMatchesPerUser =
    options?.maxMatchesPerUser ??
    Number(process.env.ODYSSEUS_JOB_DISCOVERY_MAX_MATCHES_PER_USER || DEFAULT_MAX_MATCHES_PER_USER);

  const summary: DiscoverySummary = {
    sourcesConfigured: sources.length,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    postingsFetched: 0,
    candidatePairsConsidered: 0,
    matchesEvaluated: 0,
    strongMatchesSaved: 0,
    belowThresholdSaved: 0,
    skippedExisting: 0,
    skippedPrefilter: 0,
    skippedMissingResume: 0,
    errors: [],
  };

  if (!sources.length) return summary;

  const fetched = new Map<string, NormalizedJobPosting[]>();

  for (const source of sources) {
    try {
      const postings = await fetchSourceJobs(source);
      fetched.set(sourceKey(source), postings);
      summary.sourcesSucceeded += 1;
      summary.postingsFetched += postings.length;
    } catch (error) {
      summary.sourcesFailed += 1;
      summary.errors.push({
        source: sourceKey(source),
        message: error instanceof Error ? error.message : "Source fetch failed",
      });
    }
  }

  const users = await loadUsers(service, options?.userIds);

  for (const user of users) {
    let evaluatedForUser = 0;

    for (const postings of fetched.values()) {
      for (const posting of postings) {
        if (evaluatedForUser >= maxMatchesPerUser) break;
        summary.candidatePairsConsidered += 1;

        if (!passesPreferencePrefilter(posting, user.preferences)) {
          summary.skippedPrefilter += 1;
          continue;
        }

        const { data: existing } = await service
          .from("job_opportunities")
          .select("id,description,status")
          .eq("user_id", user.userId)
          .eq("source", posting.sourceKey)
          .eq("external_id", posting.externalId)
          .maybeSingle();

        if (existing?.description === posting.description) {
          summary.skippedExisting += 1;
          continue;
        }

        try {
          const match = await assessJobMatch({
            resume: user.resume,
            profile: user.profile,
            preferences: user.preferences,
            companyName: posting.companyName,
            roleTitle: posting.title,
            jobDescription: posting.description,
          });

          evaluatedForUser += 1;
          summary.matchesEvaluated += 1;

          const threshold = user.preferences?.min_match_score ?? 85;
          const strong = match.score >= threshold && match.criticalMissing.length === 0;
          const values = {
            user_id: user.userId,
            external_id: posting.externalId,
            source: posting.sourceKey,
            source_url: posting.applyUrl || posting.sourceUrl,
            company_name: posting.companyName,
            role_title: posting.title,
            location: posting.location,
            work_arrangement: match.assessment.workArrangement || posting.workArrangement,
            employment_type: match.assessment.employmentType || posting.employmentType,
            salary_text: match.assessment.salaryText || posting.salaryText,
            description: posting.description,
            match_score: match.score,
            match_breakdown: {
              ...match.assessment,
              calculatedScore: match.score,
              criticalMissing: match.criticalMissing,
              weights: match.weights,
              discovery: {
                provider: posting.provider,
                sourceKey: posting.sourceKey,
                sourceUrl: posting.sourceUrl,
                applyUrl: posting.applyUrl,
                publishedAt: posting.publishedAt,
                updatedAt: posting.updatedAt,
                evaluatedAt: new Date().toISOString(),
              },
            },
            status: strong ? "discovered" : "rejected",
            discovered_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as const;

          if (existing?.id) {
            await service
              .from("job_opportunities")
              .update(values)
              .eq("id", existing.id)
              .eq("user_id", user.userId);
          } else {
            await service.from("job_opportunities").insert(values);
          }

          if (strong) summary.strongMatchesSaved += 1;
          else summary.belowThresholdSaved += 1;
        } catch (error) {
          summary.errors.push({
            source: posting.sourceKey,
            message: error instanceof Error ? error.message : "Match evaluation failed",
          });
        }
      }
    }
  }

  return summary;
}

async function loadUsers(
  service: ReturnType<typeof createServiceClient>,
  userIds?: string[]
): Promise<UserContext[]> {
  let profileQuery = service
    .from("profiles")
    .select("*")
    .eq("onboarding_completed", true);

  if (userIds?.length) profileQuery = profileQuery.in("id", userIds);

  const { data: profiles } = await profileQuery;
  const contexts: UserContext[] = [];

  for (const profile of profiles || []) {
    const [{ data: preferences }, { data: resume }] = await Promise.all([
      service
        .from("job_preferences")
        .select("*")
        .eq("user_id", profile.id)
        .maybeSingle(),
      service
        .from("resumes")
        .select("parsed_data")
        .eq("user_id", profile.id)
        .eq("is_master", true)
        .maybeSingle(),
    ]);

    const parsed = resumeProfileSchema.safeParse(resume?.parsed_data);
    if (!parsed.success) continue;

    contexts.push({
      userId: profile.id,
      profile,
      preferences,
      resume: parsed.data,
    });
  }

  return contexts;
}
