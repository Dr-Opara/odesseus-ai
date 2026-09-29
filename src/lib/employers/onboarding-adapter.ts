/**
 * Employer onboarding and company profile adapter — real backend state.
 *
 * Replaces a development fixture. Organization provisioning exists
 * (`POST /api/employer/orgs` -> `odesseus_ensure_employer_organization`) and
 * the company profile is read and written through
 * `GET|PATCH /api/employer/orgs/[orgId]`.
 *
 * Two things this module deliberately does not do:
 *
 *  - **It does not fake a completed onboarding.** Signup creates only the auth
 *    user; the organization is provisioned by a separate, explicit step. An
 *    employer who has not provisioned yet gets `onboardingComplete: false` and
 *    an honest "your workspace is not set up" state — not a fabricated profile
 *    so the next screen can render.
 *  - **It does not store profile fields the schema does not have.** The
 *    organization row carries name, website, industry, company size, and
 *    description. A contact name or contact email captured at signup lives in
 *    the auth record and is surfaced from there, not written into a column
 *    that does not exist.
 *
 * Profile writes are owner-only, enforced by the PATCH route's role check and
 * by the org update RLS policy. This adapter reports that refusal rather than
 * working around it.
 */

import { createClient } from "@/lib/supabase/server";
import { getEmployerOrganization, getEmployerSubscription } from "@/lib/employer/service";
import { planForTier, type EmployerPlan } from "@/lib/employer/plans";
import { resolveEmployerContext } from "./context";
import type { EmployerPlanId, EmployerProfile } from "./types";
import type { EmployerResult } from "./result";

/** The stored plan name mapped onto the Figma plan vocabulary. */
function planIdFor(plan: EmployerPlan | null): EmployerPlanId {
  if (plan?.name === "Growth") return "Growth";
  if (plan?.name === "Business") return "Business";
  return "Starter";
}

/**
 * The company profile.
 *
 * Returns `unavailable` with a setup message when the org has not been
 * provisioned. That is a real state with a real next step, not a failure, and
 * the onboarding screens use exactly this reason to route the employer onward.
 */
export async function getEmployerProfile(): Promise<EmployerResult<EmployerProfile>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const [organization, subscription, account] = await Promise.all([
      getEmployerOrganization(supabase, resolved.context.userId),
      getEmployerSubscription(supabase, resolved.context.orgId),
      supabase.auth.getUser(),
    ]);

    if (!organization) {
      return {
        status: "unavailable",
        reason: "Your company workspace is not set up yet.",
      };
    }

    // The profile fields live on the organization row. They are read directly
    // rather than through the PATCH route's projection so this stays a
    // server-side read with no HTTP hop.
    const { data: profile } = await supabase
      .from("employer_organizations")
      .select("name,website,industry,company_size,description")
      .eq("id", resolved.context.orgId)
      .maybeSingle();

    const metadata = (account.data.user?.user_metadata ?? {}) as Record<string, unknown>;

    return {
      status: "ok",
      source: "live",
      data: {
        id: organization.id,
        companyName: organization.name,
        companyWebsite: (profile?.website as string | null) ?? undefined,
        industry: (profile?.industry as string | null) ?? undefined,
        companySize: (profile?.company_size as string | null) ?? undefined,
        contactName: typeof metadata.contact_name === "string" ? metadata.contact_name : undefined,
        contactEmail: account.data.user?.email ?? undefined,
        planId: planIdFor(planForTier(subscription?.tier)),
        // Onboarding is complete once the organization exists and a plan is on
        // file. Both are real records; neither is assumed.
        onboardingComplete: Boolean(organization) && Boolean(subscription),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_ONBOARDING] profile read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your company profile." };
  }
}

export type CompanyDetailsInput = {
  companyName: string;
  companyWebsite?: string;
  industry?: string;
  companySize?: string;
  contactName?: string;
  contactEmail?: string;
};

/**
 * Provisions the employer's organization.
 *
 * This is the step signup leaves open. It is idempotent server-side — the RPC
 * converges retries onto one organization — so a double submit cannot create
 * a second company.
 */
export async function submitCompanyDetails(
  input: CompanyDetailsInput
): Promise<EmployerResult<EmployerProfile>> {
  const companyName = input.companyName?.trim();
  if (!companyName) {
    return { status: "unavailable", reason: "Enter your company name." };
  }

  try {
    const response = await fetch("/api/employer/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      org?: { id: string; name: string };
      error?: string;
    };

    if (!response.ok || !payload.org) {
      return {
        status: "unavailable",
        reason: payload.error ?? "Odesseus could not set up your team.",
      };
    }

    // Re-read the profile so the caller sees the persisted state, including
    // the plan that is actually on file.
    return getEmployerProfile();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_ONBOARDING] provision failed", message);
    return { status: "unavailable", reason: "Odesseus could not set up your team." };
  }
}

/**
 * Records the employer's plan choice.
 *
 * A plan is a paid subscription, so this starts a Stripe checkout rather than
 * writing a tier. The subscription row appears only after the webhook confirms
 * payment, which is why the review screen shows "onboarding complete" only
 * once `getEmployerProfile` reports a real subscription.
 */
export async function submitPlanSelection(planId: EmployerPlanId): Promise<EmployerResult<{ url: string }>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  const tier = planId === "Growth" ? "growth" : planId === "Business" ? "business" : "starter";

  try {
    const response = await fetch(`/api/employer/orgs/${resolved.context.orgId}/plans/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !payload.url) {
      return { status: "unavailable", reason: payload.error ?? "Could not start plan checkout." };
    }
    return { status: "ok", data: { url: payload.url }, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_ONBOARDING] plan selection failed", message);
    return { status: "unavailable", reason: "Could not start plan checkout." };
  }
}

/**
 * Finishes onboarding.
 *
 * There is no backend "complete" flag to write: completion is derived from the
 * organization existing and a subscription being on file, both of which
 * `getEmployerProfile` already reports. This re-reads and returns the derived
 * state rather than pretending a step was saved.
 */
export async function completeOnboarding(): Promise<EmployerResult<EmployerProfile>> {
  return getEmployerProfile();
}

/** Saves the company profile. Owner-only; the PATCH route refuses anyone else. */
export async function updateCompanyProfile(
  input: CompanyDetailsInput
): Promise<EmployerResult<EmployerProfile>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  const name = input.companyName?.trim();
  if (!name) return { status: "unavailable", reason: "Enter your company name." };

  try {
    const response = await fetch(`/api/employer/orgs/${resolved.context.orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        website: input.companyWebsite?.trim() ?? null,
        industry: input.industry?.trim() ?? null,
        companySize: input.companySize?.trim() ?? null,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      return {
        status: "unavailable",
        reason: payload.error ?? "Odesseus could not save your company profile.",
      };
    }

    return getEmployerProfile();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_ONBOARDING] profile update failed", message);
    return { status: "unavailable", reason: "Odesseus could not save your company profile." };
  }
}
