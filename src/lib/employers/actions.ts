/**
 * Browser-callable employer actions.
 *
 * The read adapters in `@/lib/employers/*-adapter` are server-only: they open
 * a session-scoped Supabase client to resolve the caller's organization and
 * read through it so RLS scopes every row. Importing one of those from a
 * client component would pull `next/headers` into the browser bundle, which
 * fails the build.
 *
 * So every action a client component performs lives here instead. The split is
 * not cosmetic, and the boundary is worth stating precisely:
 *
 *  - **Nothing here resolves an organization, reads a row, or decides
 *    anything.** Each function is a thin `fetch` to the org's own API route.
 *    That route re-derives the session, re-checks the caller's role, and is
 *    the authority on the outcome.
 *  - **Nothing here invents a success.** A non-2xx response becomes
 *    `unavailable` carrying the route's own message, so a component that
 *    optimistically updated its UI rolls back instead of showing a state the
 *    server rejected.
 *  - **The organization id is the caller's**, resolved server-side and passed
 *    in by the page. It is a path segment, not an authority: the route ignores
 *    it as a permission source and re-checks membership.
 *
 * Reads stay on the server. A client component that needs data receives it as
 * a prop from the page that read it there.
 */

import { toStoredEmploymentType } from "@/lib/employer/service";
import type { EmployerPlanId, PipelineStage } from "./types";

/** The result shape every action here returns. */
export type EmployerActionResult<T = null> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; reason: string };

type ErrorPayload = { error?: string };

/** Reads the route's error message, or a stated default. Never invents one. */
async function toFailure(response: Response, fallback: string): Promise<{ status: "unavailable"; reason: string }> {
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  return { status: "unavailable", reason: payload.error ?? fallback };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Moves an applicant to a stage.
 *
 * The route appends to the insert-only stage history after verifying the
 * applicant belongs to the job through the attribution edge. A viewer or a
 * cross-org id is refused there, not here.
 */
export async function moveCandidateStageAction(
  orgId: string,
  applicationId: string,
  jobId: string,
  stage: PipelineStage
): Promise<EmployerActionResult<PipelineStage>> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, applicationId, stage, notes: null }),
    });
    if (!response.ok) return toFailure(response, "Could not move this applicant.");

    // Trust the recorded stage, not the requested one.
    const payload = (await response.json().catch(() => ({}))) as { entry?: { stage?: string } };
    const recorded = payload.entry?.stage;
    if (typeof recorded !== "string") {
      return { status: "unavailable", reason: "The stage change could not be confirmed." };
    }
    return { status: "ok", data: recorded.toUpperCase() as PipelineStage };
  } catch {
    return { status: "unavailable", reason: "Could not move this applicant." };
  }
}

// ---------------------------------------------------------------------------
// Fit Score
// ---------------------------------------------------------------------------

/**
 * Requests a Fit Score, or reads the cached one.
 *
 * The route returns the persisted row without recomputing unless
 * `refresh` is set, and gates computing on a hiring-manager role. The score
 * is never calculated here.
 */
export async function requestFitScoreAction(
  orgId: string,
  applicationId: string,
  jobId: string,
  options?: { refresh?: boolean }
): Promise<EmployerActionResult<{ score: number; explanation: string }>> {
  try {
    const response = await fetch(
      `/api/employer/orgs/${orgId}/candidates/${applicationId}/fit-score`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, refresh: options?.refresh ?? false }),
      }
    );
    if (!response.ok) return toFailure(response, "Could not score this applicant.");

    const payload = (await response.json().catch(() => ({}))) as {
      fitScore?: { score?: number; explanation?: string };
    };
    if (typeof payload.fitScore?.score !== "number") {
      return { status: "unavailable", reason: "The fit score could not be read." };
    }
    return {
      status: "ok",
      data: {
        score: payload.fitScore.score,
        explanation: payload.fitScore.explanation ?? "",
      },
    };
  } catch {
    return { status: "unavailable", reason: "Could not score this applicant." };
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

type JobInput = {
  title: string;
  location?: string;
  workArrangement?: string;
  description?: string;
  department?: string;
  employmentType?: string;
  compensationText?: string;
  requiredQualifications?: string[];
  preferredQualifications?: string[];
  responsibilities?: string[];
};

/**
 * Maps the form's fields onto the route's request body.
 *
 * The route takes the backend's own column names (`requirementsText`,
 * `preferredText`, `workArrangement`, and the four structured fields), and
 * `workArrangement` and `employmentType` in the stored vocabulary rather than
 * the form's capitalised one. Department, compensation, and responsibilities
 * are their own columns, so nothing is flattened into the description and
 * nothing the employer typed is lost.
 */
function toJobBody(input: JobInput) {
  const workArrangement = input.workArrangement?.trim().toLowerCase();
  return {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    location: input.location?.trim() || null,
    requirementsText: (input.requiredQualifications ?? []).join("\n").trim() || null,
    preferredText: (input.preferredQualifications ?? []).join("\n").trim() || null,
    workArrangement:
      workArrangement === "remote" ||
      workArrangement === "hybrid" ||
      workArrangement === "onsite"
        ? workArrangement
        : workArrangement === "on-site"
          ? "onsite"
          : null,
    department: input.department?.trim() || null,
    employmentType: toStoredEmploymentType(input.employmentType),
    compensationText: input.compensationText?.trim() || null,
    responsibilitiesText: (input.responsibilities ?? []).join("\n").trim() || null,
  };
}

/**
 * Creates a draft job, or updates an existing one.
 *
 * Creating never publishes, so the employer can review the role before it
 * consumes any of their plan's job posts. Both verbs are admin/owner-gated by
 * the route.
 */
export async function saveEmployerJobAction(
  orgId: string,
  input: JobInput,
  jobId?: string
): Promise<EmployerActionResult<{ id: string; status: string }>> {
  try {
    const response = await fetch(
      jobId ? `/api/employer/orgs/${orgId}/jobs/${jobId}` : `/api/employer/orgs/${orgId}/jobs`,
      {
        method: jobId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toJobBody(input)),
      }
    );
    if (!response.ok) return toFailure(response, "Could not save this job.");

    // Both routes answer with the job row directly, not wrapped.
    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
    };
    if (!payload.id) {
      return { status: "unavailable", reason: "The job could not be confirmed." };
    }
    return { status: "ok", data: { id: payload.id, status: payload.status ?? "draft" } };
  } catch {
    return { status: "unavailable", reason: "Could not save this job." };
  }
}

/** A job status transition the backend defines: publish, close, or delete a draft. */
export type JobTransition = "publish" | "close" | "delete";

/**
 * Applies one job transition.
 *
 * All three are the same route with an `action` discriminator. Each enforces
 * its own rule server-side: publish is refused without plan capacity, close is
 * refused for a non-published job, and delete is refused for anything but a
 * draft. The refusal text is the route's.
 */
export async function transitionJobAction(
  orgId: string,
  jobId: string,
  transition: JobTransition
): Promise<EmployerActionResult<{ id: string; status?: string }>> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: transition }),
    });
    if (!response.ok) return toFailure(response, "Could not update this job.");

    if (transition === "delete") {
      await response.json().catch(() => ({}));
      return { status: "ok", data: { id: jobId } };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
    };
    return { status: "ok", data: { id: payload.id ?? jobId, status: payload.status } };
  } catch {
    return { status: "unavailable", reason: "Could not update this job." };
  }
}

// ---------------------------------------------------------------------------
// Purchases — these open checkout and grant nothing
// ---------------------------------------------------------------------------

/** Starts a plan subscription checkout. */
export async function startPlanCheckoutAction(
  orgId: string,
  planId: EmployerPlanId
): Promise<EmployerActionResult<{ url: string }>> {
  const tier = planId === "Growth" ? "growth" : planId === "Business" ? "business" : "starter";
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/plans/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    if (!response.ok) return toFailure(response, "Could not start plan checkout.");
    const payload = (await response.json().catch(() => ({}))) as { url?: string };
    if (!payload.url) return { status: "unavailable", reason: "Checkout could not start." };
    return { status: "ok", data: { url: payload.url } };
  } catch {
    return { status: "unavailable", reason: "Could not start plan checkout." };
  }
}

/** Starts a checkout for additional recruiter seats. */
export async function startSeatCheckoutAction(
  orgId: string,
  seats = 1
): Promise<EmployerActionResult<{ url: string }>> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/seats/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seats }),
    });
    if (!response.ok) return toFailure(response, "Could not start seat checkout.");
    const payload = (await response.json().catch(() => ({}))) as { url?: string };
    if (!payload.url) return { status: "unavailable", reason: "Checkout could not start." };
    return { status: "ok", data: { url: payload.url } };
  } catch {
    return { status: "unavailable", reason: "Could not start seat checkout." };
  }
}

/**
 * Starts a featured-listing checkout.
 *
 * The job is not marked featured here. Visibility begins only once the
 * billing webhook confirms payment and the backend activates the listing.
 */
export async function startFeaturedCheckoutAction(
  orgId: string,
  jobId: string,
  tier: string
): Promise<EmployerActionResult<{ url: string; days: number }>> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/featured/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, tier }),
    });
    if (!response.ok) return toFailure(response, "Could not start the featured checkout.");
    const payload = (await response.json().catch(() => ({}))) as { url?: string; days?: number };
    if (!payload.url) return { status: "unavailable", reason: "Checkout could not start." };
    return { status: "ok", data: { url: payload.url, days: payload.days ?? 0 } };
  } catch {
    return { status: "unavailable", reason: "Could not start the featured checkout." };
  }
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/** Sends an invitation. Membership is created when it is accepted, not now. */
export async function inviteTeamMemberAction(
  orgId: string,
  email: string,
  role: "Admin" | "Recruiter"
): Promise<EmployerActionResult<{ id: string }>> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: role.toLowerCase() }),
    });
    if (!response.ok) return toFailure(response, "Could not send that invitation.");
    const payload = (await response.json().catch(() => ({}))) as {
      invitation?: { id?: string };
    };
    return { status: "ok", data: { id: payload.invitation?.id ?? "" } };
  } catch {
    return { status: "unavailable", reason: "Could not send that invitation." };
  }
}

/** Revokes a pending invitation. */
export async function revokeInvitationAction(
  orgId: string,
  invitationId: string
): Promise<EmployerActionResult> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/invitations/${invitationId}`, {
      method: "DELETE",
    });
    if (!response.ok) return toFailure(response, "Could not remove that invitation.");
    await response.json().catch(() => ({}));
    return { status: "ok", data: null };
  } catch {
    return { status: "unavailable", reason: "Could not remove that invitation." };
  }
}

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

type CompanyProfileInput = {
  companyName: string;
  companyWebsite?: string;
  industry?: string;
  companySize?: string;
};

/**
 * Saves the company profile. Owner-only; the PATCH route refuses anyone else
 * and this surfaces that refusal.
 */
export async function saveCompanyProfileAction(
  orgId: string,
  input: CompanyProfileInput
): Promise<EmployerActionResult> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.companyName,
        website: input.companyWebsite?.trim() || null,
        industry: input.industry?.trim() || null,
        companySize: input.companySize?.trim() || null,
      }),
    });
    if (!response.ok) return toFailure(response, "Could not save your company profile.");
    await response.json().catch(() => ({}));
    return { status: "ok", data: null };
  } catch {
    return { status: "unavailable", reason: "Could not save your company profile." };
  }
}

/** Provisions the caller's organization. Idempotent server-side. */
export async function provisionOrganizationAction(
  companyName: string
): Promise<EmployerActionResult<{ orgId: string }>> {
  try {
    const response = await fetch("/api/employer/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    if (!response.ok) return toFailure(response, "Odesseus could not set up your team.");
    const payload = (await response.json().catch(() => ({}))) as { org?: { id?: string } };
    if (!payload.org?.id) {
      return { status: "unavailable", reason: "Your workspace could not be confirmed." };
    }
    return { status: "ok", data: { orgId: payload.org.id } };
  } catch {
    return { status: "unavailable", reason: "Odesseus could not set up your team." };
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Marks one notification read. */
export async function markNotificationReadAction(
  orgId: string,
  notificationId: string
): Promise<EmployerActionResult> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/notifications/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [notificationId] }),
    });
    if (!response.ok) return toFailure(response, "Could not update that notification.");
    await response.json().catch(() => ({}));
    return { status: "ok", data: null };
  } catch {
    return { status: "unavailable", reason: "Could not update that notification." };
  }
}

/** Marks every unread notification read. */
export async function markAllNotificationsReadAction(orgId: string): Promise<EmployerActionResult> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/notifications/read-all`, {
      method: "POST",
    });
    if (!response.ok) return toFailure(response, "Could not update your notifications.");
    await response.json().catch(() => ({}));
    return { status: "ok", data: null };
  } catch {
    return { status: "unavailable", reason: "Could not update your notifications." };
  }
}

/**
 * Saves the org's notification channel preferences.
 *
 * The caller sends the full channel set rather than a single toggle, because
 * the route upserts a partial patch onto the stored row. Sending one key would
 * leave the other channels at whatever the row already held, which is not the
 * same as "leave the others as they were on screen".
 */
export async function saveNotificationPreferencesAction(
  orgId: string,
  channels: Record<string, boolean>
): Promise<EmployerActionResult> {
  try {
    const response = await fetch(`/api/employer/orgs/${orgId}/notification-preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(channels),
    });
    if (!response.ok) return toFailure(response, "Could not save your notification settings.");
    await response.json().catch(() => ({}));
    return { status: "ok", data: null };
  } catch {
    return { status: "unavailable", reason: "Could not save your notification settings." };
  }
}
