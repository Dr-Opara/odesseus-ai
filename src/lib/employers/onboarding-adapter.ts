/**
 * Employer organization / onboarding adapter (F1). Production uses the real
 * backend:
 * POST `/api/employer/orgs` — idempotently provisions the caller's org and
 * owner membership (this is the step that closes the signup loop),
 * GET `/api/employer/orgs/{orgId}` — company profile,
 * PATCH `/api/employer/orgs/{orgId}` — company profile update (owner only).
 *
 * Plan selection is not a profile write: a plan is bought through Stripe, so
 * the onboarding flow hands the tier to the billing checkout and never claims
 * a subscription it has not been given. Every write reports only what the
 * backend confirmed.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { EMPLOYER_PROFILE_FIXTURE } from "./fixtures/profile";
import type { EmployerProfile } from "./types";
import type { EmployerResult } from "./result";

type BackendOrg = {
  id: string;
  name: string;
  ownerUserId?: string;
  website?: string | null;
  industry?: string | null;
  companySize?: string | null;
  description?: string | null;
  createdAt?: string | null;
};

type OrgPayload = { org?: BackendOrg; yourRole?: string | null };

function toProfile(org: BackendOrg, yourRole?: string | null): EmployerProfile {
  return {
    id: org.id,
    companyName: org.name,
    ...(org.website ? { companyWebsite: org.website } : {}),
    ...(org.industry ? { industry: org.industry } : {}),
    ...(org.companySize ? { companySize: org.companySize } : {}),
    ...(org.description ? { description: org.description } : {}),
    ...(yourRole ? { yourRole: yourRole as EmployerProfile["yourRole"] } : {}),
  };
}

export async function getEmployerProfile(orgId: string): Promise<EmployerResult<EmployerProfile>> {
  const response = await employerApi<OrgPayload>(`/api/employer/orgs/${orgId}`);
  if (response.ok && response.data?.org) {
    return { status: "ok", data: toProfile(response.data.org, response.data.yourRole), source: "live" };
  }
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: response.ok ? "That team could not be found." : response.reason };
  }
  return { status: "ok", data: EMPLOYER_PROFILE_FIXTURE, source: "fixture" };
}

export type CompanyDetailsInput = {
  companyName: string;
  companyWebsite?: string;
  industry?: string;
  companySize?: string;
  description?: string;
};

/**
 * Provision the caller's organization. The backend's provisioning function is
 * idempotent, so a retry or a double submit converges on one organization
 * rather than duplicating it.
 */
export async function provisionEmployerOrg(
  input: CompanyDetailsInput
): Promise<EmployerResult<EmployerProfile>> {
  const response = await employerApi<OrgPayload>("/api/employer/orgs", {
    method: "POST",
    body: { companyName: input.companyName },
  });
  if (response.ok && response.data?.org) {
    // Company profile fields are a separate owner-only write; failing to apply
    // them is reported rather than folded into a false success.
    const patch = await updateCompanyProfile(response.data.org.id, input);
    if (patch.status === "ok") return patch;
    return {
      status: "unavailable",
      reason: `Your company was created, but the profile could not be saved. ${patch.reason}`,
    };
  }
  return {
    status: "unavailable",
    reason: response.ok ? "Odesseus could not set up your team." : response.reason,
  };
}

/** Update the company profile. Owner-only on the backend; 403s are surfaced. */
export async function updateCompanyProfile(
  orgId: string,
  input: CompanyDetailsInput
): Promise<EmployerResult<EmployerProfile>> {
  const response = await employerApi<OrgPayload>(`/api/employer/orgs/${orgId}`, {
    method: "PATCH",
    body: {
      name: input.companyName,
      website: input.companyWebsite ?? null,
      industry: input.industry ?? null,
      companySize: input.companySize ?? null,
      description: input.description ?? null,
    },
  });
  if (response.ok && response.data?.org) {
    return { status: "ok", data: toProfile(response.data.org), source: "live" };
  }
  return {
    status: "unavailable",
    reason: response.ok ? "Odesseus could not save the company profile." : response.reason,
  };
}
