import { htmlToText } from "../text";

type JobicyJob = {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobType?: string[];
  jobGeo?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
};

type JobicyResponse = {
  jobs?: JobicyJob[];
  nextCursor?: string | null;
  hasMore?: boolean;
  success?: boolean;
};

export type AggregatedJob = {
  provider: string;
  sourceKey: string;
  externalId: string;
  companyName: string;
  title: string;
  location: string | null;
  workArrangement: string | null;
  employmentType: string | null;
  salaryText: string | null;
  description: string;
  sourceUrl: string;
  applyUrl: string;
  publishedAt: string | null;
};

export async function fetchJobicyJobs(maxJobs = 400): Promise<AggregatedJob[]> {
  const out: AggregatedJob[] = [];
  let cursor: string | null = null;

  while (out.length < maxJobs) {
    const params = new URLSearchParams({ count: String(Math.min(200, maxJobs - out.length)) });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`https://jobicy.com/api/v2/remote-jobs?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Jobicy returned ${response.status}`);

    const payload = (await response.json()) as JobicyResponse;
    for (const job of payload.jobs ?? []) {
      if (!job.id || !job.url || !job.jobTitle || !job.companyName) continue;
      const description = htmlToText(job.jobDescription);
      if (description.length < 80) continue;

      out.push({
        provider: "jobicy",
        sourceKey: "jobicy:public",
        externalId: String(job.id),
        companyName: job.companyName.trim(),
        title: job.jobTitle.trim(),
        location: job.jobGeo?.trim() || "Remote",
        workArrangement: "remote",
        employmentType: job.jobType?.join(", ") || null,
        salaryText: salary(job),
        description,
        sourceUrl: job.url,
        applyUrl: job.url,
        publishedAt: job.pubDate || null,
      });
    }

    cursor = payload.nextCursor ?? null;
    if (!cursor || payload.hasMore === false) break;
  }

  return out;
}

function salary(job: JobicyJob) {
  if (job.salaryMin == null && job.salaryMax == null) return null;
  const currency = job.salaryCurrency || "";
  const period = job.salaryPeriod ? ` / ${job.salaryPeriod}` : "";
  if (job.salaryMin != null && job.salaryMax != null) {
    return `${currency} ${job.salaryMin.toLocaleString()}–${job.salaryMax.toLocaleString()}${period}`.trim();
  }
  const amount = job.salaryMin ?? job.salaryMax;
  return `${currency} ${Number(amount).toLocaleString()}${period}`.trim();
}
