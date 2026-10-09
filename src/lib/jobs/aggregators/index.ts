import { fetchArbeitnowJobs } from "./arbeitnow";
import { fetchJobicyJobs, type AggregatedJob } from "./jobicy";

export type PublicAggregatorResult = {
  source: string;
  jobs: AggregatedJob[];
  error?: string;
};

export async function fetchPublicAggregators(): Promise<PublicAggregatorResult[]> {
  const sources = [
    ["jobicy", () => fetchJobicyJobs()],
    ["arbeitnow", () => fetchArbeitnowJobs()],
  ] as const;

  return Promise.all(
    sources.map(async ([source, fetcher]) => {
      try {
        return { source, jobs: await fetcher() };
      } catch (error) {
        return {
          source,
          jobs: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
}
