import type { HomepageJob } from "./homepage-types";

/**
 * DEV/TEST-ONLY FIXTURE — never returned when isProductionRuntime() is true.
 * See `getHomepageJobs` in `./homepage.ts` for the gate. Deliberately uses
 * fictional company names rather than real brands: these are illustrative
 * placeholder postings, not real listings, and must never be read as an
 * endorsement or hiring claim about a real company. `matchScore` is
 * intentionally omitted on every entry — it must only ever come from a real
 * signed-in backend response, never a fixture.
 */
export const HOMEPAGE_JOB_FIXTURES: HomepageJob[] = [
  {
    id: "fixture-1",
    title: "Security Engineer (GenAI)",
    company: "Nova Cloud",
    location: "Remote",
    workArrangement: "Remote",
    salaryText: "$210K – $260K",
    freshnessLabel: "Active",
    tags: ["Security", "GenAI"],
    applyUrl: "/jobs",
  },
  {
    id: "fixture-2",
    title: "Senior Cloud Security Engineer",
    company: "Meridian Labs",
    location: "Austin, USA",
    workArrangement: "Hybrid",
    salaryText: "$238K – $280K",
    freshnessLabel: "Just posted",
    tags: ["Cloud", "Security"],
    applyUrl: "/jobs",
  },
  {
    id: "fixture-3",
    title: "Staff Security Engineer",
    company: "Solace Systems",
    location: "Toronto, Canada",
    workArrangement: "On-site",
    salaryText: "$250K – $310K",
    freshnessLabel: "Active",
    tags: ["Security"],
    applyUrl: "/jobs",
  },
  {
    id: "fixture-4",
    title: "Product Designer",
    company: "Brightline Robotics",
    location: "London, UK",
    workArrangement: "Hybrid",
    freshnessLabel: "Just posted",
    tags: ["Design"],
    applyUrl: "/jobs",
  },
  {
    id: "fixture-5",
    title: "Backend Engineer",
    company: "Kite & Rivet",
    location: "Remote",
    workArrangement: "Remote",
    salaryText: "$150K – $190K",
    freshnessLabel: "Active",
    tags: ["Backend", "Platform"],
    applyUrl: "/jobs",
  },
  {
    id: "fixture-6",
    title: "Data Analyst",
    company: "Fernbank Health",
    location: "Lagos, Nigeria",
    workArrangement: "On-site",
    freshnessLabel: "Active",
    tags: ["Data"],
    applyUrl: "/jobs",
  },
];
