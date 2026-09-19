import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type AshbyJob = {
  title: string;
  location?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: "OnSite" | "Remote" | "Hybrid" | string;
  descriptionPlain?: string;
  publishedAt?: string;
  employmentType?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
};

type AshbyResponse = { jobs?: AshbyJob[] };

export async function fetchAshbyJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const endpoint =
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.slug)}?includeCompensation=true`;

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Ashby returned ${response.status}`);
  }

  const payload = (await response.json()) as AshbyResponse;

  return (payload.jobs || [])
    .filter(
      (job) =>
        job.isListed !== false &&
        Boolean(job.title && job.jobUrl && job.applyUrl && job.descriptionPlain)
    )
    .map((job) => ({
      provider: "ashby" as const,
      sourceKey: `ashby:${source.slug.toLowerCase()}`,
      companyName: source.companyName,
      externalId: job.applyUrl!,
      title: job.title.trim(),
      location: job.location?.trim() || null,
      workArrangement: arrangement(job),
      employmentType: normalizeEmploymentType(job.employmentType),
      salaryText:
        job.compensation?.scrapeableCompensationSalarySummary ||
        job.compensation?.compensationTierSummary ||
        null,
      description: job.descriptionPlain!.trim(),
      sourceUrl: job.jobUrl!,
      applyUrl: job.applyUrl!,
      publishedAt: job.publishedAt || null,
      updatedAt: job.publishedAt || null,
    }))
    .filter((job) => job.description.length >= 120);
}

function arrangement(job: AshbyJob): NormalizedJobPosting["workArrangement"] {
  if (job.isRemote || job.workplaceType === "Remote") return "remote";
  if (job.workplaceType === "Hybrid") return "hybrid";
  if (job.workplaceType === "OnSite") return "on-site";
  return null;
}

function normalizeEmploymentType(value?: string) {
  if (!value) return null;
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^Intern$/, "Internship");
}
