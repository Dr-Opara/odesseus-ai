import { htmlToText } from "../text";
import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type WorkableJob = {
  title?: string;
  code?: string;
  shortcode?: string;
  country?: string;
  state?: string;
  city?: string;
  telecommuting?: boolean;
  published_on?: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  description?: string;
  employment_type?: string;
  workplace_type?: "on_site" | "hybrid" | "remote" | string;
};

type WorkableAccount = {
  jobs?: WorkableJob[];
};

export async function fetchWorkableJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const endpoint =
    `https://www.workable.com/api/accounts/${encodeURIComponent(source.slug)}?details=true`;

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Workable returned ${response.status}`);
  }

  const payload = (await response.json()) as WorkableAccount;

  return (payload.jobs || [])
    .filter((job) =>
      Boolean(
        job.title &&
          (job.shortcode || job.code) &&
          (job.application_url || job.url || job.shortlink) &&
          job.description
      )
    )
    .map((job) => {
      const sourceUrl = job.url || job.shortlink || job.application_url!;
      const applyUrl = job.application_url || sourceUrl;

      return {
        provider: "workable" as const,
        sourceKey: `workable:${source.slug.toLowerCase()}`,
        companyName: source.companyName,
        externalId: String(job.shortcode || job.code),
        title: job.title!.trim(),
        location: location(job),
        workArrangement: arrangement(job),
        employmentType: job.employment_type?.trim() || null,
        salaryText: null,
        description: htmlToText(job.description).trim(),
        sourceUrl,
        applyUrl,
        publishedAt: job.published_on || null,
        updatedAt: null,
      };
    })
    .filter((job) => job.description.length >= 120);
}

function location(job: WorkableJob) {
  const parts = [job.city, job.state, job.country]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function arrangement(
  job: WorkableJob
): NormalizedJobPosting["workArrangement"] {
  if (job.workplace_type === "remote" || job.telecommuting) return "remote";
  if (job.workplace_type === "hybrid") return "hybrid";
  if (job.workplace_type === "on_site") return "on-site";
  return location(job) ? "on-site" : null;
}
