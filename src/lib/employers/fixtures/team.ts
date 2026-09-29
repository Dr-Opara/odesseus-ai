import type { TeamMember } from "../types";

/**
 * DEV/TEST-ONLY FIXTURE — see gate in `../team-adapter.ts`. The employer
 * backend returns no names or emails for a team roster, so these rows are
 * labelled by role and the invited address stands in for a pending invitee.
 */
export const TEAM_MEMBER_FIXTURES: TeamMember[] = [
  {
    id: "member:1",
    name: "Owner",
    role: "Owner",
    status: "Active",
    joinedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "member:2",
    name: "Recruiter",
    role: "Recruiter",
    status: "Active",
    joinedAt: "2026-07-10T00:00:00.000Z",
  },
  {
    id: "invitation:1",
    name: "pending.recruiter@example.com",
    role: "Recruiter",
    status: "Pending",
    joinedAt: "2026-09-01T00:00:00.000Z",
  },
];
