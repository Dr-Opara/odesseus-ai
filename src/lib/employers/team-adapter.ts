/**
 * Recruiter seat and team adapter — real backend reads and invitations.
 *
 * Replaces a development fixture. The team backend exists
 * (`getOrgTeamView`, `createInvitation`, `revokeInvitation` in
 * `src/lib/employer/service.ts`, exposed through
 * `/api/employer/orgs/[orgId]/team`, `.../invitations`).
 *
 * What the backend can and cannot tell us, and why the UI reflects that:
 *
 *  - `employer_members` stores user ids, roles, and join dates. There is no
 *    employer-readable join to a person's name or email, so a member row
 *    shows a short id and never an invented name.
 *  - `employer_member_invitations` is owner/admin-only, so for a recruiter or
 *    viewer the invitation list is legitimately empty rather than an error.
 *  - Seat counts come from the backend's `SeatSummary` (seats paid, used,
 *    available, required). The seat price is approved commercial data, not
 *    something read from a subscription row.
 *
 * Invitations go over HTTP so the route's admin check and its rate limit stay
 * authoritative. No membership logic is reimplemented here — F13-M: the
 * frontend must not create membership client-side.
 */

import { createClient } from "@/lib/supabase/server";
import { createInvitation, getOrgTeamView, revokeInvitation } from "@/lib/employer/service";
import { EXTRA_RECRUITER_SEAT_PRICE_LABEL } from "@/lib/employer/plans";
import { resolveEmployerContext } from "./context";
import type { TeamMember, TeamMemberRole, TeamMemberStatus } from "./types";
import type { EmployerResult } from "./result";

/** A short, non-reversible identifier for display. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** The stored role vocabulary, rendered with its product label. */
function roleLabel(role: string): TeamMemberRole {
  const normalized = role.toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  if (normalized === "recruiter") return "Recruiter";
  return "Recruiter";
}

/** Invites the backend stores in a status vocabulary the UI simplifies. */
function invitationStatus(status: string): TeamMemberStatus {
  return status === "pending" ? "Pending" : "Active";
}

export type TeamView = {
  members: TeamMember[];
  pendingInvitations: TeamMember[];
  seats: {
    paid: number;
    used: number;
    available: number;
    required: number;
  };
  /** The caller's own role, so the UI can hide admin-only sections. */
  callerRole: string | null;
  isCallerAdmin: boolean;
  seatPriceLabel: string;
};

/**
 * The organization's roster, pending invitations, and seat state.
 *
 * The seat price is the approved $20/month figure from the plan table, not a
 * value read from a database row that could drift from what checkout charges.
 */
export async function getTeamView(): Promise<EmployerResult<TeamView>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const view = await getOrgTeamView(supabase, resolved.context.orgId, resolved.context.userId);

    const members: TeamMember[] = view.members.map((member) => ({
      // The backend's membership key is a user id. It is the only identifier
      // an employer session can read for a teammate, so it is what is shown.
      id: member.user_id,
      name: shortId(member.user_id),
      email: "",
      role: roleLabel(member.role),
      status: "Active",
      invitedAt: member.created_at ?? new Date(0).toISOString(),
      acceptedAt: member.created_at ?? undefined,
    }));

    const pendingInvitations: TeamMember[] = view.invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => ({
        id: invitation.id,
        // An invitation carries the invited address by design — it is the
        // thing the employer typed. Unlike a member row, this is readable.
        name: invitation.email,
        email: invitation.email,
        role: roleLabel(invitation.role),
        status: invitationStatus(invitation.status),
        invitedAt: invitation.created_at,
      }));

    return {
      status: "ok",
      source: "live",
      data: {
        members,
        pendingInvitations,
        seats: {
          paid: view.seats.seatsPaid,
          used: view.seats.seatsUsed,
          available: view.seats.seatsAvailable,
          required: view.seats.seatsRequired,
        },
        callerRole: view.callerRole,
        isCallerAdmin: view.isCallerAdmin,
        seatPriceLabel: EXTRA_RECRUITER_SEAT_PRICE_LABEL,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_TEAM] read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your team." };
  }
}

/** Convenience read for the Figma Team screen's row list. */
export async function getTeamMembers(): Promise<EmployerResult<TeamMember[]>> {
  const view = await getTeamView();
  if (view.status === "unavailable") return view;
  return { status: "ok", data: view.data.members, source: "live" };
}

/** Why an invitation did not go out, in the employer's words. */
const INVITE_REFUSALS: Record<string, string> = {
  invalid: "That email address does not look right.",
  not_an_admin: "Only a team owner or admin can invite teammates.",
  duplicate: "That person already has an invitation or is already on the team.",
  rate_limited: "Too many invitations were sent recently. Please try again later.",
  unknown: "Odesseus could not send that invitation.",
};

/**
 * Invites a teammate.
 *
 * Returns the created invitation on success. A refusal carries the backend's
 * own reason, so "you already invited them" is never shown as a generic
 * failure.
 */
export async function inviteTeamMember(
  email: string,
  role: "Admin" | "Recruiter"
): Promise<EmployerResult<TeamMember>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const result = await createInvitation(supabase, {
      orgId: resolved.context.orgId,
      email,
      role: role.toLowerCase() as "admin" | "recruiter",
      invitedBy: resolved.context.userId,
    });

    if (!result.ok) {
      return { status: "unavailable", reason: INVITE_REFUSALS[result.code] ?? INVITE_REFUSALS.unknown };
    }

    return {
      status: "ok",
      source: "live",
      data: {
        id: result.invitation.id,
        name: result.invitation.email,
        email: result.invitation.email,
        role: roleLabel(result.invitation.role),
        status: "Pending",
        invitedAt: result.invitation.created_at,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_TEAM] invite failed", message);
    return { status: "unavailable", reason: INVITE_REFUSALS.unknown };
  }
}

/** Revokes a pending invitation. The backend is the authority on who may. */
export async function revokeTeamMember(invitationId: string): Promise<EmployerResult<null>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(
      `/api/employer/orgs/${resolved.context.orgId}/invitations/${invitationId}`,
      { method: "DELETE" }
    );
    const payload = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      return {
        status: "unavailable",
        reason: payload.error ?? "Odesseus could not remove that invitation.",
      };
    }
    return { status: "ok", data: null, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_TEAM] revoke failed", message);
    return { status: "unavailable", reason: "Odesseus could not remove that invitation." };
  }
}
