import type { EmployerAnalyticsSnapshot } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../analytics-adapter.ts`. */
export const EMPLOYER_ANALYTICS_FIXTURE: EmployerAnalyticsSnapshot = {
  jobsActive: 2,
  jobsClosed: 1,
  applicantVolume: 42,
  strongFitCandidates: 9,
  hired: 1,
  rejected: 2,
  stageDistribution: {
    APPLIED: 18,
    REVIEWING: 10,
    SHORTLISTED: 6,
    INTERVIEW: 4,
    OFFER: 1,
    HIRED: 1,
    REJECTED: 2,
  },
  applicationsOverTime: [
    { date: "2026-08-01", count: 3 },
    { date: "2026-08-08", count: 7 },
    { date: "2026-08-15", count: 12 },
    { date: "2026-08-22", count: 9 },
  ],
  applicantsByJob: [
    { jobId: "job-1", jobTitle: "Senior Backend Engineer", applicantCount: 24 },
    { jobId: "job-2", jobTitle: "Product Designer", applicantCount: 18 },
  ],
};
