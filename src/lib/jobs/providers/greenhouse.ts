import { htmlToText } from "../text";
import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type GreenhouseJob = {
  id: number | string;
  title: string;
  absolute_url: string;
  updated_at?: string;
  content?: string;
  location?: { name?: string };
  metadata?: Array<{ name?: string; value?: string | string[] | null }>;
};

type GreenhouseResponse = { jobs?: GreenhouseJob[] };

export async function fetchGreenhouseJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const endpoint =
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.slug)}/jobs?content=true`;

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Greenhouse returned ${response.status}`);
  }

  const payload = (await response.json()) as GreenhouseResponse;

  return (payload.jobs || [])
    .filter((job) => Boolean(job.id && job.title && job.absolute_url))
    .map((job) => ({
      provider: "greenhouse" as const,
      sourceKey: `greenhouse:${source.slug.toLowerCase()}`,
      companyName: source.companyName,
      externalId: String(job.id),
      title: job.title.trim(),
      location: job.location?.name?.trim() || null,
      workArrangement: inferArrangement(job.location?.name || ""),
      employmentType: metadataValue(job.metadata, "employment type"),
      salaryText: metadataValue(job.metadata, "compensation"),
      description: htmlToText(job.content),
      sourceUrl: job.absolute_url,
      applyUrl: job.absolute_url,
      publishedAt: null,
      updatedAt: job.updated_at || null,
    }))
    .filter((job) => job.description.length >= 120);
}

function metadataValue(
  metadata: GreenhouseJob["metadata"],
  wanted: string
) {
  const item = metadata?.find(
    (entry) => entry.name?.trim().toLowerCase() === wanted
  );
  if (!item?.value) return null;
  return Array.isArray(item.value) ? item.value.join(", ") : String(item.value);
}

function inferArrangement(location: string): NormalizedJobPosting["workArrangement"] {
  const normalized = location.toLowerCase();
  if (normalized.includes("remote")) return "remote";
  if (normalized.includes("hybrid")) return "hybrid";
  return location ? "on-site" : null;
}
