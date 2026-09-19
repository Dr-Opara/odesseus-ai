import { htmlToText } from "../text";
import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  description?: string;
  descriptionPlain?: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
  workplaceType?: string;
  salaryRange?: {
    currency?: string;
    interval?: string;
    min?: number;
    max?: number;
  };
};

export async function fetchLeverJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const host = source.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const endpoint =
    `https://${host}/v0/postings/${encodeURIComponent(source.slug)}?mode=json`;

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Lever returned ${response.status}`);
  }

  const payload = (await response.json()) as LeverPosting[];

  return (Array.isArray(payload) ? payload : [])
    .filter((job) => Boolean(job.id && job.text && (job.applyUrl || job.hostedUrl)))
    .map((job) => {
      const sourceUrl = job.hostedUrl || job.applyUrl!;
      return {
        provider: "lever" as const,
        sourceKey: `lever:${source.slug.toLowerCase()}`,
        companyName: source.companyName,
        externalId: job.id,
        title: job.text.trim(),
        location: job.categories?.location?.trim() || null,
        workArrangement: arrangement(job.workplaceType, job.categories?.location),
        employmentType: job.categories?.commitment?.trim() || null,
        salaryText: salary(job.salaryRange),
        description: (job.descriptionPlain || htmlToText(job.description)).trim(),
        sourceUrl,
        applyUrl: job.applyUrl || sourceUrl,
        publishedAt: job.createdAt
          ? new Date(job.createdAt).toISOString()
          : null,
        updatedAt: null,
      };
    })
    .filter((job) => job.description.length >= 120);
}

function arrangement(
  workplaceType?: string,
  location?: string
): NormalizedJobPosting["workArrangement"] {
  const value = `${workplaceType || ""} ${location || ""}`.toLowerCase();
  if (value.includes("remote")) return "remote";
  if (value.includes("hybrid")) return "hybrid";
  if (value.trim()) return "on-site";
  return null;
}

function salary(range?: LeverPosting["salaryRange"]) {
  if (!range || range.min == null || range.max == null) return null;
  const currency = range.currency || "";
  const interval = range.interval ? ` / ${range.interval}` : "";
  return `${currency} ${range.min.toLocaleString()}–${range.max.toLocaleString()}${interval}`.trim();
}
