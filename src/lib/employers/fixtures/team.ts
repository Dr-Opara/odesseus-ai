import type { TeamMember } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../team-adapter.ts`. */
export const TEAM_MEMBER_FIXTURES: TeamMember[] = [
  {
    id: "team-1",
    name: "Dana Whitfield",
    email: "dana@example.com",
    role: "Owner",
    status: "Active",
    invitedAt: "2026-07-01T00:00:00.000Z",
    acceptedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "team-2",
    name: "Ravi Patel",
    email: "ravi@example.com",
    role: "Recruiter",
    status: "Active",
    invitedAt: "2026-07-10T00:00:00.000Z",
    acceptedAt: "2026-07-11T00:00:00.000Z",
  },
  {
    id: "team-3",
    name: "Casey Nguyen",
    email: "casey@example.com",
    role: "Recruiter",
    status: "Pending",
    invitedAt: "2026-09-01T00:00:00.000Z",
  },
];
