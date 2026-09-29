/**
 * INTEGRATION POINT — employer onboarding/provisioning backend (OpenCode
 * Phase 2P-2S, not yet shipped). `getEmployerProfile` is a dev-fixtured
 * read, gated like every other adapter. Every submission function
 * (company details, plan selection, final review, and the F13-Q Company
 * Profile edit) always reports `unavailable` — provisioning/editing must
 * never appear to succeed before the backend confirms it (F13-B).
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { EMPLOYER_PROFILE_FIXTURE } from "./fixtures/profile";
import type { EmployerPlanId, EmployerProfile } from "./types";
import type { EmployerResult } from "./result";

export async function getEmployerProfile(): Promise<EmployerResult<EmployerProfile>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Employer profile API is not yet available." };
  }
  return { status: "ok", data: EMPLOYER_PROFILE_FIXTURE, source: "fixture" };
}

export type CompanyDetailsInput = {
  companyName: string;
  companyWebsite?: string;
  industry?: string;
  companySize?: string;
  contactName?: string;
  contactEmail?: string;
};

/** INTEGRATION POINT: replace with a real submission call once the backend ships. */
export async function submitCompanyDetails(_input: CompanyDetailsInput): Promise<EmployerResult<EmployerProfile>> {
  return { status: "unavailable", reason: "Saving company details is not yet available." };
}

export async function submitPlanSelection(_planId: EmployerPlanId): Promise<EmployerResult<EmployerProfile>> {
  return { status: "unavailable", reason: "Saving plan selection is not yet available." };
}

export async function completeOnboarding(): Promise<EmployerResult<EmployerProfile>> {
  return { status: "unavailable", reason: "Completing onboarding is not yet available." };
}

/** F13-Q Company Profile edit — reuses the same company-details shape captured at onboarding. */
export async function updateCompanyProfile(_input: CompanyDetailsInput): Promise<EmployerResult<EmployerProfile>> {
  return { status: "unavailable", reason: "Updating company profile is not yet available." };
}
