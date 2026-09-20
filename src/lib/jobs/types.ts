export type JobProvider = "greenhouse" | "lever" | "ashby" | "workable";

export type JobSourceConfig = {
  provider: JobProvider;
  companyName: string;
  slug: string;
  region?: "global" | "eu";
};

export type NormalizedJobPosting = {
  provider: JobProvider;
  sourceKey: string;
  companyName: string;
  externalId: string;
  title: string;
  location: string | null;
  workArrangement: "remote" | "hybrid" | "on-site" | null;
  employmentType: string | null;
  salaryText: string | null;
  description: string;
  sourceUrl: string;
  applyUrl: string;
  publishedAt: string | null;
  updatedAt: string | null;
};

export type DiscoverySummary = {
  sourcesConfigured: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  postingsFetched: number;
  candidatePairsConsidered: number;
  matchesEvaluated: number;
  strongMatchesSaved: number;
  belowThresholdSaved: number;
  skippedExisting: number;
  skippedPrefilter: number;
  skippedMissingResume: number;
  closedStaleListings: number;
  errors: Array<{ source: string; message: string }>;
};
