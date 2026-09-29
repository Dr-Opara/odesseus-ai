/**
 * Recruiter seat / team adapter (F1). Production uses the real backend:
 * GET `/api/employer/orgs/{orgId}/team` (roster, outstanding invitations,
 * seat arithmetic), POST `…/invitations`, DELETE `…/invitations/{id}`,
 * DELETE `…/members/{userId}`.
 *
 * Membership stays backend-owned: the frontend never creates a membership,
 * never grants a seat, and never removes anyone locally. The org owner cannot
 * be removed, and that refusal comes from the backend.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { TEAM_MEMBER_FIXTURES } from "./fixtures/team";
import type {
  EmployerRole,
  EmployerTeam,
  TeamMember,
  TeamMemberRole,
} from "./types";
import type { EmployerResult } from "./result";

type BackendMember = { user_id: string; role: string; created_at?: string | null; isYou?: boolean };
type BackendInvitation = {
  id: string;
  email: string;
  role: string;
  status?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

type BackendTeam = {
  callerRole?: string | null;
  isCallerAdmin?: boolean;
  seats?: {
    seatsPaid?: number;
    seatsUsed?: number;
    seatsAvailable?: number;
    seatsRequired?: number;
  } | null;
  members?: BackendMember[];
  invitations?: BackendInvitation[];
};

const ROLE_LABELS: Record<EmployerRole, TeamMemberRole> = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  viewer: "Viewer",
};

function toRoleLabel(role: string | null | undefined): TeamMemberRole {
  if (role === "admin" || role === "recruiter" || role === "viewer") return ROLE_LABELS[role];
  return "Owner";
}

/**
 * Members are identified by their membership, not by a name: the employer
 * backend deliberately returns no emails or profiles for the roster, so the
 * row is labelled by role and the identity column is not invented here.
 */
function toMembers(members: BackendMember[]): TeamMember[] {
  return members.map((member) => ({
    id: `member:${member.user_id}`,
    name: toRoleLabel(member.role),
    role: toRoleLabel(member.role),
    status: "Active",
    ...(member.created_at ? { joinedAt: member.created_at } : {}),
    ...(member.isYou ? { isYou: true } : {}),
  }));
}

function toInvitations(invitations: BackendInvitation[]): TeamMember[] {
  return invitations
    .filter((invitation) => (invitation.status ?? "pending") === "pending")
    .map((invitation) => ({
      id: `invitation:${invitation.id}`,
      // The invited address is the only identifier the backend returns, and it
      // is the address the admin typed.
      name: invitation.email,
      role: toRoleLabel(invitation.role),
      status: "Pending",
      ...(invitation.created_at ? { joinedAt: invitation.created_at } : {}),
      ...(invitation.expires_at ? { expiresAt: invitation.expires_at } : {}),
    }));
}

function toTeam(team: BackendTeam): EmployerTeam {
  const role = team.callerRole ?? null;
  return {
    members: toMembers(team.members ?? []),
    invitations: toInvitations(team.invitations ?? []),
    seats: {
      required: team.seats?.seatsRequired ?? 0,
      active: team.seats?.seatsUsed ?? 0,
      ...(team.seats &&
      (team.seats.seatsUsed ?? 0) > (team.seats.seatsPaid ?? 0)
        ? { isOverEntitled: true }
        : {}),
    },
    isCallerAdmin: Boolean(team.isCallerAdmin),
    callerRole: role as EmployerRole | null,
  };
}

export async function getEmployerTeam(orgId: string): Promise<EmployerResult<EmployerTeam>> {
  const response = await employerApi<{ team?: BackendTeam }>(`/api/employer/orgs/${orgId}/team`);
  if (response.ok) return { status: "ok", data: toTeam(response.data?.team ?? {}), source: "live" };
  if (isProductionRuntime()) return { status: "unavailable", reason: response.reason };
  return {
    status: "ok",
    source: "fixture",
    data: {
      members: TEAM_MEMBER_FIXTURES.filter((member) => member.status === "Active"),
      invitations: TEAM_MEMBER_FIXTURES.filter((member) => member.status === "Pending"),
      seats: { required: 3, active: TEAM_MEMBER_FIXTURES.filter((m) => m.status === "Active").length },
      isCallerAdmin: true,
      callerRole: "owner",
    },
  };
}

export type InviteTeamResult = {
  /** Set only when the backend did not manage to email the invitee. */
  redemptionLink?: string;
  emailed: boolean;
};

/** Invite a teammate. The backend writes the invitation and sends the email. */
export async function inviteTeamMember(
  orgId: string,
  email: string,
  role: Exclude<TeamMemberRole, "Owner">
): Promise<EmployerResult<InviteTeamResult>> {
  const response = await employerApi<{ token?: string; emailed?: boolean }>(
    `/api/employer/orgs/${orgId}/invitations`,
    { method: "POST", body: { email, role: role.toLowerCase() } }
  );
  if (response.ok) {
    return {
      status: "ok",
      source: "live",
      data: {
        emailed: Boolean(response.data?.emailed),
        // A delivery failure still leaves a real invitation the admin can pass
        // on, so the link is surfaced rather than treated as a dead end.
        ...(response.data?.token ? { redemptionLink: `/employers/invitations/${response.data.token}` } : {}),
      },
    };
  }
  return { status: "unavailable", reason: response.reason };
}

/** Withdraw a pending invitation. */
export async function revokeInvitation(
  orgId: string,
  invitationId: string
): Promise<EmployerResult<null>> {
  const response = await employerApi<{ revoked?: boolean }>(
    `/api/employer/orgs/${orgId}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" }
  );
  if (response.ok) return { status: "ok", data: null, source: "live" };
  return { status: "unavailable", reason: response.reason };
}

/** Remove a teammate and resize their paid seat. Owner removal is refused. */
export async function removeTeamMember(
  orgId: string,
  userId: string
): Promise<EmployerResult<null>> {
  const response = await employerApi<{ removed?: string }>(
    `/api/employer/orgs/${orgId}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
  if (response.ok) return { status: "ok", data: null, source: "live" };
  return { status: "unavailable", reason: response.reason };
}
