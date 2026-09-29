/**
 * INTEGRATION POINT — recruiter seat/team backend (OpenCode Phase 2P-2S, not
 * yet shipped). `getTeamMembers` is a dev-fixtured read. Membership actions
 * (invite/revoke) never get a fixture path — F13-M: "frontend must not
 * create membership logic client-side."
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { TEAM_MEMBER_FIXTURES } from "./fixtures/team";
import type { TeamMember } from "./types";
import type { EmployerResult } from "./result";

export async function getTeamMembers(): Promise<EmployerResult<TeamMember[]>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Team API is not yet available." };
  }
  return { status: "ok", data: TEAM_MEMBER_FIXTURES, source: "fixture" };
}

/** INTEGRATION POINT: replace with a real invite call once the backend ships. */
export async function inviteTeamMember(_email: string, _role: "Admin" | "Recruiter"): Promise<EmployerResult<TeamMember>> {
  return { status: "unavailable", reason: "Inviting recruiters is not yet available." };
}

export async function revokeTeamMember(_memberId: string): Promise<EmployerResult<null>> {
  return { status: "unavailable", reason: "Removing recruiters is not yet available." };
}
