import { htmlToText } from "../text";
import type { AggregatedJob } from "./jobicy";

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  job_types?: string[];
  location?: string;
  created_at?: number;
};

type ArbeitnowResponse = {
  data?: ArbeitnowJob[];
  links?: { next?: string | null };
};

export async function fetchArbeitnowJobs(maxJobs = 300): Promise<AggregatedJob[]> {
  const out: AggregatedJob[] = [];
  let url: string | null = "https://www.arbeitnow.com/api/job-board-api";

  while (url && out.length < maxJobs) {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Arbeitnow returned ${response.status}`);

    const payload = (await response.json()) as ArbeitnowResponse;
    for (const job of payload.data ?? []) {
      if (!job.slug || !job.company_name || !job.title || !job.url) continue;
      const description = htmlToText(job.description);
      if (description.length < 80) continue;

      out.push({
        provider: "arbeitnow",
        sourceKey: "arbeitnow:public",
        externalId: job.slug,
        companyName: job.company_name.trim(),
        companyLogoUrl: null,
        title: job.title.trim(),
        location: job.location?.trim() || (job.remote ? "Remote Europe" : null),
        workArrangement: job.remote ? "remote" : "on-site",
        employmentType: job.job_types?.join(", ") || null,
        salaryText: null,
        description,
        sourceUrl: job.url,
        applyUrl: job.url,
        publishedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
      });
    }

    url = payload.links?.next ?? null;
  }

  return out.slice(0, maxJobs);
}
