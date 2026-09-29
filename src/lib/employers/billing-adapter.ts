/**
 * INTEGRATION POINT — employer billing backend (OpenCode Phase 2P-2S, not
 * yet shipped). A separate surface from candidate wallet billing
 * (`src/lib/billing/*`) — never import from there, and never import this
 * from a candidate-facing page. `getEmployerBilling` is a dev-fixtured read;
 * plan changes never get a fixture path (no fake payment success, F13-N).
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { EMPLOYER_BILLING_FIXTURE } from "./fixtures/billing";
import type { EmployerBillingSummary, EmployerPlanId } from "./types";
import type { EmployerResult } from "./result";

export async function getEmployerBilling(): Promise<EmployerResult<EmployerBillingSummary>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Employer billing API is not yet available." };
  }
  return { status: "ok", data: EMPLOYER_BILLING_FIXTURE, source: "fixture" };
}

/** INTEGRATION POINT: replace with a real Stripe (or equivalent) checkout/plan-change call. */
export async function changeEmployerPlan(_planId: EmployerPlanId): Promise<EmployerResult<EmployerBillingSummary>> {
  return { status: "unavailable", reason: "Changing plans is not yet available." };
}

export async function purchaseRecruiterSeat(): Promise<EmployerResult<EmployerBillingSummary>> {
  return { status: "unavailable", reason: "Purchasing an additional seat is not yet available." };
}
