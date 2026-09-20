import type { JobSourceConfig, NormalizedJobPosting } from "../types";
import { fetchAshbyJobs } from "./ashby";
import { fetchGreenhouseJobs } from "./greenhouse";
import { fetchLeverJobs } from "./lever";
import { fetchWorkableJobs } from "./workable";
import { fetchSmartRecruitersJobs } from "./smartrecruiters";
import { fetchRecruiteeJobs } from "./recruitee";

export async function fetchSourceJobs(
  source: JobSourceConfig
): Promise<NormalizedJobPosting[]> {
  switch (source.provider) {
    case "greenhouse":
      return fetchGreenhouseJobs(source);
    case "lever":
      return fetchLeverJobs(source);
    case "ashby":
      return fetchAshbyJobs(source);
    case "workable":
      return fetchWorkableJobs(source);
    case "smartrecruiters":
      return fetchSmartRecruitersJobs(source);
    case "recruitee":
      return fetchRecruiteeJobs(source);
  }
}
