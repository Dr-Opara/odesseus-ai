import type { CandidateDetail } from "../types";

/**
 * DEV/TEST-ONLY FIXTURE — see gate in `../candidates-adapter.ts`. Fictional
 * placeholder applicants keyed by application id; no protected demographic
 * attributes, no candidate user ids, and no Live/Prep fields (see the header
 * note in `../types.ts`).
 */
export const CANDIDATE_FIXTURES: CandidateDetail[] = [
  {
    id: "candidate-1",
    appliedJobId: "job-1",
    appliedJobTitle: "Senior Backend Engineer",
    stage: "REVIEWING",
    fitScoreOverall: 88,
    location: "Remote",
    appliedAt: "2026-08-15T00:00:00.000Z",
    requiredQualificationsText: "5+ years backend experience\nTypeScript or Go",
    fitScore: {
      overall: 88,
      requiredMatches: ["5+ years backend experience", "TypeScript or Go"],
      preferredMatches: ["Distributed systems experience"],
      resumeEvidence: ["Led migration of payments service to Go at previous role"],
      missingQualifications: [],
      missingSkills: ["Kubernetes"],
      locationAlignment: true,
      blockers: [],
    },
  },
  {
    id: "candidate-2",
    appliedJobId: "job-1",
    appliedJobTitle: "Senior Backend Engineer",
    stage: "SHORTLISTED",
    fitScoreOverall: 74,
    location: "Toronto, Canada",
    appliedAt: "2026-08-16T00:00:00.000Z",
    fitScore: {
      overall: 74,
      requiredMatches: ["TypeScript or Go"],
      preferredMatches: [],
      resumeEvidence: ["Built internal tooling in TypeScript"],
      missingQualifications: ["5+ years backend experience"],
      missingSkills: ["Distributed systems"],
      locationAlignment: true,
      blockers: [],
    },
  },
  {
    id: "candidate-3",
    appliedJobId: "job-2",
    appliedJobTitle: "Product Designer",
    stage: "APPLIED",
    fitScoreOverall: 91,
    location: "Austin, USA",
    appliedAt: "2026-08-20T00:00:00.000Z",
  },
  {
    id: "candidate-4",
    appliedJobId: "job-1",
    appliedJobTitle: "Senior Backend Engineer",
    stage: "INTERVIEW",
    fitScoreOverall: 82,
    location: "Remote",
    appliedAt: "2026-08-10T00:00:00.000Z",
  },
  {
    id: "candidate-5",
    appliedJobId: "job-4",
    appliedJobTitle: "Data Analyst",
    stage: "REJECTED",
    location: "Lagos, Nigeria",
    appliedAt: "2026-06-05T00:00:00.000Z",
  },
];
