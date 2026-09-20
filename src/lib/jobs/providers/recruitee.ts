import { htmlToText } from "../text";
import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type RecruiteeOffer = {
  id?: number | string;
  slug?: string;
  title?: string;
  description?: string;
  description_html?: string;
  requirements?: string;
  careers_url?: string;
  url?: string;
  status?: string;
  kind?: string;
  remote?: boolean;
  remote_option?: string;
  employment_type?: string;
  created_at?: string;
  published_at?: string;
  updated_at?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  locations?: Array<{
    city?: string;
    state?: string;
    country?: string;
    name?: string;
  }>;
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: string;
  };
};

type RecruiteeResponse = {
  offers?: RecruiteeOffer[];
};

export async function fetchRecruiteeJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const endpoint =
    `https://${encodeURIComponent(source.slug)}.recruitee.com/api/offers/`;

  const response = await fetch(endpoint, {
    headers: authHeaders(source),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Recruitee returned ${response.status}`);
  }

  const payload = (await response.json()) as RecruiteeResponse | RecruiteeOffer[];
  const offers = Array.isArray(payload) ? payload : payload.offers || [];

  return offers
    .filter(
      (job) =>
        job.status !== "closed" &&
        job.status !== "archived" &&
        job.kind !== "talent_pool" &&
        Boolean(job.id && job.title && (job.careers_url || job.url))
    )
    .map((job) => {
      const sourceUrl =
        job.careers_url ||
        job.url ||
        `https://${source.slug}.recruitee.com/o/${job.slug || job.id}`;

      return {
        provider: "recruitee" as const,
        sourceKey: `recruitee:${source.slug.toLowerCase()}`,
        companyName: source.companyName,
        externalId: String(job.id),
        title: job.title!.trim(),
        location: formatLocation(job),
        workArrangement: arrangement(job),
        employmentType: job.employment_type?.trim() || null,
        salaryText: formatSalary(job.salary),
        description: [
          htmlToText(job.description_html || job.description),
          htmlToText(job.requirements),
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim(),
        sourceUrl,
        applyUrl: sourceUrl,
        publishedAt: job.published_at || job.created_at || null,
        updatedAt: job.updated_at || null,
      };
    })
    .filter((job) => job.description.length >= 120);
}

function authHeaders(source: JobSourceConfig): HeadersInit {
  const headers: Record<string, string> = { accept: "application/json" };
  if (!source.tokenEnv) return headers;

  const token = process.env[source.tokenEnv]?.trim();
  if (!token) throw new Error(`${source.tokenEnv} is not configured.`);
  headers["X-Careers-Sites-Token"] = token;
  return headers;
}

function formatLocation(job: RecruiteeOffer) {
  if (job.location?.trim()) return job.location.trim();

  const first = job.locations?.[0];
  const parts = [
    first?.name,
    first?.city || job.city,
    first?.state || job.state,
    first?.country || job.country,
  ]
    .map((value) => value?.trim())
    .filter(Boolean);

  return parts.length ? [...new Set(parts)].join(", ") : null;
}

function arrangement(
  job: RecruiteeOffer
): NormalizedJobPosting["workArrangement"] {
  const value = `${job.remote_option || ""} ${job.location || ""}`.toLowerCase();
  if (job.remote || value.includes("remote")) return "remote";
  if (value.includes("hybrid")) return "hybrid";
  return formatLocation(job) ? "on-site" : null;
}

function formatSalary(salary?: RecruiteeOffer["salary"]) {
  if (!salary || salary.min == null || salary.max == null) return null;
  const currency = salary.currency || "";
  const period = salary.period ? ` / ${salary.period}` : "";
  return `${currency} ${salary.min.toLocaleString()}–${salary.max.toLocaleString()}${period}`.trim();
}
