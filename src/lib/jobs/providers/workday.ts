import { htmlToText } from "../text";
import type { JobSourceConfig, NormalizedJobPosting } from "../types";

type WorkdayListPosting = {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
};

type WorkdayListResponse = {
  total?: number;
  jobPostings?: WorkdayListPosting[];
};

type WorkdayDetailResponse = {
  jobPostingInfo?: {
    jobDescription?: string;
    jobReqId?: string;
    location?: string;
    timeType?: string;
    workerSubType?: string;
  };
};

type WorkdayConfig = {
  origin: string;
  tenant: string;
  site: string;
  locale: string;
};

const PAGE_SIZE = 20;
const DEFAULT_MAX_JOBS = 100;

export async function fetchWorkdayJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  const config = parseWorkdayCareerUrl(source);
  const maxJobs = source.maxJobs ?? DEFAULT_MAX_JOBS;
  const listings: WorkdayListPosting[] = [];
  let offset = 0;
  let total: number | null = null;

  while (listings.length < maxJobs) {
    const response = await fetch(
      `${config.origin}/wday/cxs/${encodeURIComponent(config.tenant)}/${encodeURIComponent(config.site)}/jobs`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          referer: `${config.origin}/${config.locale}/${config.site}`,
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE_SIZE,
          offset,
          searchText: "",
        }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(`Workday returned ${response.status}`);
    }

    const payload = (await response.json()) as WorkdayListResponse;
    const page = payload.jobPostings || [];
    if (total == null && typeof payload.total === "number") total = payload.total;
    if (!page.length) break;

    listings.push(...page.slice(0, Math.max(0, maxJobs - listings.length)));
    offset += PAGE_SIZE;

    if (page.length < PAGE_SIZE) break;
    if (total != null && offset >= total) break;
  }

  const results: NormalizedJobPosting[] = [];

  for (let start = 0; start < listings.length; start += 8) {
    const batch = listings.slice(start, start + 8);
    const rows = await Promise.all(
      batch.map((listing) => normalizeListing(source, config, listing))
    );
    results.push(...rows.filter((row): row is NormalizedJobPosting => Boolean(row)));
  }

  return results;
}

async function normalizeListing(
  source: JobSourceConfig,
  config: WorkdayConfig,
  listing: WorkdayListPosting
): Promise<NormalizedJobPosting | null> {
  if (!listing.title || !listing.externalPath) return null;

  const detailResponse = await fetch(
    `${config.origin}/wday/cxs/${encodeURIComponent(config.tenant)}/${encodeURIComponent(config.site)}/job${listing.externalPath}`,
    {
      headers: {
        accept: "application/json",
        referer: `${config.origin}/${config.locale}/${config.site}${listing.externalPath}`,
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    }
  );

  if (!detailResponse.ok) return null;

  const detail = (await detailResponse.json()) as WorkdayDetailResponse;
  const info = detail.jobPostingInfo;
  const description = htmlToText(info?.jobDescription);
  if (description.length < 120) return null;

  const sourceUrl =
    `${config.origin}/${config.locale}/${config.site}${listing.externalPath}`;

  return {
    provider: "workday",
    sourceKey: `workday:${source.slug.toLowerCase()}`,
    companyName: source.companyName,
    externalId: info?.jobReqId || externalId(listing.externalPath),
    title: listing.title.trim(),
    location: info?.location?.trim() || listing.locationsText?.trim() || null,
    workArrangement: arrangement(
      info?.location || listing.locationsText || ""
    ),
    employmentType:
      info?.timeType?.trim() || info?.workerSubType?.trim() || null,
    salaryText: null,
    description,
    sourceUrl,
    applyUrl: sourceUrl,
    publishedAt: null,
    updatedAt: null,
  };
}

function parseWorkdayCareerUrl(source: JobSourceConfig): WorkdayConfig {
  if (!source.careerUrl) {
    throw new Error("Workday sources require careerUrl.");
  }

  let url: URL;
  try {
    url = new URL(source.careerUrl);
  } catch {
    throw new Error("Workday careerUrl is invalid.");
  }

  if (url.protocol !== "https:" || !url.hostname.endsWith(".myworkdayjobs.com")) {
    throw new Error("Workday careerUrl must use an HTTPS myworkdayjobs.com host.");
  }

  const tenant = url.hostname.split(".")[0];
  const segments = url.pathname.split("/").filter(Boolean);
  const locale =
    segments[0] && /^[a-z]{2}-[A-Z]{2}$/.test(segments[0])
      ? segments[0]
      : "en-US";
  const site = segments[locale === segments[0] ? 1 : 0];

  if (!tenant || !site) {
    throw new Error("Workday careerUrl must include the career site name.");
  }

  return {
    origin: url.origin,
    tenant,
    site,
    locale,
  };
}

function externalId(path: string) {
  const last = path.split("/").filter(Boolean).at(-1) || path;
  const parts = last.split("_");
  return parts.at(-1) || last;
}

function arrangement(
  value: string
): NormalizedJobPosting["workArrangement"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("remote")) return "remote";
  if (normalized.includes("hybrid")) return "hybrid";
  return value.trim() ? "on-site" : null;
}
