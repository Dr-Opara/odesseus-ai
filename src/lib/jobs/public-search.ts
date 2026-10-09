import { createServiceClient } from "@/lib/supabase/service";
import { jobMatchesMarket, locationMatchesTerms, type JobMarket } from "@/lib/jobs/location-market";

export type PublicJobSearchItem = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  employmentType: string | null;
  workArrangement: string | null;
  salaryText: string | null;
  description: string;
  provider: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  postedAt: string;
};

type SearchInput = {
  query?: string;
  location?: string;
  locationTerms?: string[];
  market?: JobMarket | null;
  employmentType?: string;
  limit?: number;
};

const DAY_MS = 86_400_000;

export async function searchPublicJobs(input: SearchInput = {}): Promise<PublicJobSearchItem[]> {
  const service = createServiceClient();
  const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);

  let query = service
    .from("public_job_posts")
    .select(
      "id,title,company_name,location,employment_type,work_arrangement,salary_text,description,provider,source_url,apply_url,published_at,first_seen_at"
    )
    .eq("is_active", true)
    .or(`published_at.gte.${cutoff},and(published_at.is.null,first_seen_at.gte.${cutoff})`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1000);

  const term = input.query?.trim().replace(/[,%()]/g, " ");
  if (term) {
    query = query.or(
      `title.ilike.%${term}%,company_name.ilike.%${term}%,description.ilike.%${term}%`
    );
  }

  const location = input.location?.trim();
  if (location && !input.market && !input.locationTerms?.length) {
    query = query.ilike("location", `%${location}%`);
  }

  const employmentType = input.employmentType?.trim();
  if (employmentType) query = query.eq("employment_type", employmentType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{
    id: string;
    title: string;
    company_name: string;
    location: string | null;
    employment_type: string | null;
    work_arrangement: string | null;
    salary_text: string | null;
    description: string;
    provider: string;
    source_url: string | null;
    apply_url: string | null;
    published_at: string | null;
    first_seen_at: string;
  }>)
    .filter((row) => {
      if (input.locationTerms?.length) {
        return locationMatchesTerms(row.location, input.locationTerms);
      }
      return jobMatchesMarket(row.location, input.market ?? null);
    })
    .map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company_name,
      location: row.location,
      employmentType: row.employment_type,
      workArrangement: row.work_arrangement,
      salaryText: row.salary_text,
      description: row.description,
      provider: row.provider,
      sourceUrl: row.source_url,
      applyUrl: row.apply_url,
      postedAt: row.published_at ?? row.first_seen_at,
    }))
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
    .slice(0, limit);
}

export function jobAgeLabel(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "Recently posted";
  const days = Math.max(0, Math.floor((Date.now() - time) / DAY_MS));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function jobSummary(description: string, max = 180): string {
  const clean = description.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sliced = clean.slice(0, max);
  const stop = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, stop > 120 ? stop : max).trim()}…`;
}
