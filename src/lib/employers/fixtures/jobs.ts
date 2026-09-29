import type { EmployerJobDetail } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../jobs-adapter.ts`. */
export const EMPLOYER_JOB_FIXTURES: EmployerJobDetail[] = [
  {
    id: "job-1",
    title: "Senior Backend Engineer",
    location: "Remote",
    workArrangement: "Remote",
    status: "Published",
    createdAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-02T00:00:00.000Z",
    featured: true,
    featuredUntil: "2026-09-15T00:00:00.000Z",
    description: "Own core services for our platform.",
    requiredQualificationsText: "5+ years backend experience\nTypeScript or Go",
    preferredQualificationsText: "Distributed systems experience",
  },
  {
    id: "job-2",
    title: "Product Designer",
    location: "Austin, USA",
    workArrangement: "Hybrid",
    status: "Published",
    createdAt: "2026-08-10T00:00:00.000Z",
    publishedAt: "2026-08-11T00:00:00.000Z",
    featured: false,
    requiredQualificationsText: "Portfolio of shipped product work",
  },
  {
    id: "job-3",
    title: "Recruiting Coordinator",
    location: "Toronto, Canada",
    workArrangement: "On-site",
    status: "Draft",
    createdAt: "2026-09-01T00:00:00.000Z",
    featured: false,
  },
  {
    id: "job-4",
    title: "Data Analyst",
    location: "Lagos, Nigeria",
    workArrangement: "On-site",
    status: "Closed",
    createdAt: "2026-06-01T00:00:00.000Z",
    publishedAt: "2026-06-02T00:00:00.000Z",
    featured: false,
  },
];
