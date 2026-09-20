import type { JobSourceConfig, NormalizedJobPosting } from "../types";
import { fetchAshbyJobs } from "./ashby";
import { fetchGreenhouseJobs } from "./greenhouse";
import { fetchLeverJobs } from "./lever";
import { fetchWorkableJobs } from "./workable";

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
  }
}
