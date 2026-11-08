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

/**
 * Arbeitnow occasionally publishes a job title in `company_name` (e.g.
 * "Signal Processing Engineer (RF Processing & Analytics)"). Showing that as
 * the employer misattributes the posting, so such rows are dropped rather
 * than guessed at.
 */
const ROLE_NOUN =
  /\b(engineer|developer|manager|analyst|intern|specialist|technician|consultant|designer|scientist|architect|administrator|coordinator|officer|director|assistant|representative|recruiter|accountant|nurse)s?\b/i;

export function isLikelyJobTitle(companyName: string, title: string) {
  const company = companyName.trim().toLowerCase();
  if (!company) return true;
  if (company === title.trim().toLowerCase()) return true;
  return ROLE_NOUN.test(company);
}

/** Arbeitnow's `remote` flag is unreliable; the location text often says "Remote - Germany". */
export function arbeitnowArrangement(remote: boolean | undefined, location: string | undefined) {
  const text = (location ?? "").toLowerCase();
  if (remote || /\bremote\b|home[- ]?office/.test(text)) return "remote";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  return "on-site";
}

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
      if (isLikelyJobTitle(job.company_name, job.title)) continue;
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
        workArrangement: arbeitnowArrangement(job.remote, job.location),
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
