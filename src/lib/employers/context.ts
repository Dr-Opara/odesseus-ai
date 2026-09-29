/**
 * Server-side employer context.
 *
 * Every employer adapter used to open with "which organization is this
 * request for?" and answer it with a development fixture, because at the
 * time the employer backend did not exist. It does now, and it already owns
 * that answer: `employer_members` links a user to exactly one organization,
 * and every read downstream is scoped to that id.
 *
 * This module is the single place an adapter resolves it, so authorization
 * cannot diverge between two screens. The rules it enforces:
 *
 *  1. No session, no org. Adapters return an honest `unavailable`, never a
 *     fixture.
 *  2. A candidate account is not an employer account. `requireEmployerOverview`
 *     redirects those; adapters refuse them so no page has to remember.
 *  3. The org is resolved from the membership row, never from a URL
 *     parameter, so a page cannot be pointed at another company's data.
 *  4. The caller's role is read with the org, because "may I read" and "may I
 *     write" are different questions and several adapters need both.
 *
 * Server-only: it reads the Supabase session cookie.
 */

import { createClient } from "@/lib/supabase/server";
import { getEmployerOrganization, getEmployerRole, getEmployerUserId } from "@/lib/employer/service";
import type { OrgRole } from "@/lib/employer/service";

export type EmployerContext = {
  /** The session user. */
  userId: string;
  /** The one organization this user belongs to. */
  orgId: string;
  /** The user's role in that organization, when the membership row carries one. */
  role: OrgRole | null;
};

export type EmployerContextResult =
  | { status: "ok"; context: EmployerContext }
  | { status: "unavailable"; reason: string };

/**
 * The caller's organization id, or `null` when there is none.
 *
 * Client components need this to build their API paths. It is a path segment,
 * not an authority: every route re-derives the session and re-checks
 * membership, so a forged or stale id grants nothing. It exists so a page
 * resolves the org once on the server instead of each component resolving it
 * again.
 */
export async function getEmployerOrgId(): Promise<string | null> {
  const resolved = await resolveEmployerContext();
  return resolved.status === "ok" ? resolved.context.orgId : null;
}

/**
 * Roles that may move applicants, score fits, and edit jobs.
 * Mirrors `isHiringManager` in `@/lib/employer/hiring`, which the API routes
 * enforce independently — this is presentation, not authorization.
 */
const HIRING_MANAGER_ROLES = new Set<OrgRole>(["owner", "admin", "recruiter"]);

/** True when the caller may perform hiring-manager actions in their org. */
export function isHiringManagerContext(context: EmployerContext): boolean {
  return context.role !== null && HIRING_MANAGER_ROLES.has(context.role);
}

/**
 * Resolves the signed-in employer request to its organization.
 *
 * Never throws: a read failure is an honest `unavailable` so a page renders
 * its state panel rather than a 500.
 */
export async function resolveEmployerContext(): Promise<EmployerContextResult> {
  try {
    const supabase = await createClient();
    const userId = await getEmployerUserId(supabase);
    if (!userId) {
      return { status: "unavailable", reason: "Please sign in to your employer account." };
    }

    const organization = await getEmployerOrganization(supabase, userId);
    if (!organization) {
      return {
        status: "unavailable",
        reason:
          "Your company workspace is not set up yet. Complete setup to continue.",
      };
    }

    const role = await getEmployerRole(supabase, userId);

    return {
      status: "ok",
      context: { userId, orgId: organization.id, role: (role as OrgRole | null) ?? null },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_CTX] context resolution failed", message);
    return { status: "unavailable", reason: "Could not load your company workspace." };
  }
}
