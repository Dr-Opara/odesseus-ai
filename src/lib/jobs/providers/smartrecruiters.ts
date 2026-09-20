import { htmlToText } from "../text";
import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type SmartRecruitersListItem = {
  id?: string;
  uuid?: string;
};

type SmartRecruitersList = {
  content?: SmartRecruitersListItem[];
  totalFound?: number;
};

type SmartRecruitersDetails = {
  id?: string;
  uuid?: string;
  name?: string;
  releasedDate?: string;
  postingUrl?: string;
  applyUrl?: string;
  active?: boolean;
  typeOfEmployment?: { label?: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
  };
  compensation?: {
    minSalary?: number;
    maxSalary?: number;
    currency?: string;
    period?: string;
  };
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string } | undefined>;
  };
};

export async function fetchSmartRecruitersJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const headers = authHeaders(source);
  const listUrl =
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.slug)}/postings?limit=100&offset=0&destination=PUBLIC`;

  const response = await fetch(listUrl, {
    headers,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`SmartRecruiters returned ${response.status}`);
  }

  const payload = (await response.json()) as SmartRecruitersList;
  const items = (payload.content || []).slice(0, 100);
  const details: SmartRecruitersDetails[] = [];

  for (let start = 0; start < items.length; start += 10) {
    const batch = items.slice(start, start + 10);
    const rows = await Promise.all(
      batch.map(async (item) => {
        const postingId = item.id || item.uuid;
        if (!postingId) return null;

        const detailResponse = await fetch(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.slug)}/postings/${encodeURIComponent(postingId)}`,
          {
            headers,
            signal: AbortSignal.timeout(15_000),
            cache: "no-store",
          }
        );

        if (!detailResponse.ok) return null;
        return (await detailResponse.json()) as SmartRecruitersDetails;
      })
    );
    details.push(...rows.filter((row): row is SmartRecruitersDetails => Boolean(row)));
  }

  return details
    .filter(
      (job) =>
        job.active !== false &&
        Boolean(job.name && (job.id || job.uuid) && job.postingUrl && job.applyUrl)
    )
    .map((job) => ({
      provider: "smartrecruiters" as const,
      sourceKey: `smartrecruiters:${source.slug.toLowerCase()}`,
      companyName: source.companyName,
      externalId: String(job.id || job.uuid),
      title: job.name!.trim(),
      location: formatLocation(job.location),
      workArrangement: arrangement(job.location),
      employmentType: job.typeOfEmployment?.label?.trim() || null,
      salaryText: formatCompensation(job.compensation),
      description: description(job),
      sourceUrl: job.postingUrl!,
      applyUrl: job.applyUrl!,
      publishedAt: job.releasedDate || null,
      updatedAt: null,
    }))
    .filter((job) => job.description.length >= 120);
}

function authHeaders(source: JobSourceConfig): HeadersInit {
  const headers: Record<string, string> = { accept: "application/json" };
  if (!source.tokenEnv) return headers;

  const token = process.env[source.tokenEnv]?.trim();
  if (!token) throw new Error(`${source.tokenEnv} is not configured.`);
  headers["x-smarttoken"] = token;
  return headers;
}

function description(job: SmartRecruitersDetails) {
  const sections = job.jobAd?.sections || {};
  return Object.values(sections)
    .map((section) => htmlToText(section?.text))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function formatLocation(location?: SmartRecruitersDetails["location"]) {
  if (!location) return null;
  const parts = [location.city, location.region, location.country]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : location.remote ? "Remote" : null;
}

function arrangement(
  location?: SmartRecruitersDetails["location"]
): NormalizedJobPosting["workArrangement"] {
  if (location?.remote) return "remote";
  return formatLocation(location) ? "on-site" : null;
}

function formatCompensation(comp?: SmartRecruitersDetails["compensation"]) {
  if (!comp || comp.minSalary == null || comp.maxSalary == null) return null;
  const currency = comp.currency || "";
  const period = comp.period ? ` / ${comp.period}` : "";
  return `${currency} ${comp.minSalary.toLocaleString()}–${comp.maxSalary.toLocaleString()}${period}`.trim();
}
