import type { EmployerAnalyticsSnapshot } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../analytics-adapter.ts`. */
export const EMPLOYER_ANALYTICS_FIXTURE: EmployerAnalyticsSnapshot = {
  activeJobs: 2,
  applicantVolume: 42,
  stageDistribution: {
    APPLIED: 18,
    REVIEWING: 10,
    SHORTLISTED: 6,
    INTERVIEW: 4,
    OFFER: 1,
    HIRED: 1,
    REJECTED: 2,
  },
  strongFitCandidates: 9,
  hiringActivityOverTime: [
    { date: "2026-08-01", count: 3 },
    { date: "2026-08-08", count: 7 },
    { date: "2026-08-15", count: 12 },
    { date: "2026-08-22", count: 9 },
  ],
};
