/**
 * Employer billing adapter (F1). Production uses the real backend:
 * GET `/api/employer/orgs/{orgId}/billing` (plan, period, capacity, seats,
 * featured), POST `…/plans/checkout`, POST `…/seats/checkout`, and
 * POST `…/featured/checkout` for promotions.
 *
 * A separate surface from candidate wallet billing — nothing here imports
 * `@/lib/billing/*` or `@/lib/wallet/*`, and no candidate-facing page reads
 * this module. Plan and seat changes start a Stripe checkout; capacity only
 * changes once the billing webhook confirms payment, so nothing here reports
 * a plan or seat change the backend has not confirmed.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { EMPLOYER_BILLING_FIXTURE } from "./fixtures/billing";
import {
  toEmployerPlanId,
  type EmployerBillingSummary,
  type EmployerPlanId,
} from "./types";
import type { EmployerResult } from "./result";

type BackendBilling = {
  plan?: { tier?: string; name?: string; priceLabel?: string } | null;
  subscriptionStatus?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  capacity?: { included: number; published: number; remaining: number } | null;
  seats?: { required: number; active: number; activeUntil?: string | null } | null;
  featuredActive?: number;
};

const TIER_BY_NAME: Record<string, EmployerPlanId> = {
  Starter: "Starter",
  Growth: "Growth",
  Business: "Business",
};

function toSummary(billing: BackendBilling): EmployerBillingSummary {
  const tier = billing.plan?.tier ?? null;
  const planId = tier ? toEmployerPlanId(tier) : billing.plan?.name ? (TIER_BY_NAME[billing.plan.name] ?? null) : null;
  return {
    planId,
    priceLabel: billing.plan?.priceLabel ?? null,
    subscriptionStatus: billing.subscriptionStatus ?? null,
    periodStart: billing.periodStart ?? null,
    periodEnd: billing.periodEnd ?? null,
    capacity: billing.capacity ?? { included: 0, published: 0, remaining: 0 },
    seats: billing.seats
      ? {
          required: billing.seats.required,
          active: billing.seats.active,
          activeUntil: billing.seats.activeUntil ?? null,
        }
      : null,
    featuredActive: billing.featuredActive ?? 0,
  };
}

export async function getEmployerBilling(orgId: string): Promise<EmployerResult<EmployerBillingSummary>> {
  const response = await employerApi<{ billing?: BackendBilling }>(`/api/employer/orgs/${orgId}/billing`);
  if (response.ok) return { status: "ok", data: toSummary(response.data?.billing ?? {}), source: "live" };
  if (isProductionRuntime()) return { status: "unavailable", reason: response.reason };
  return { status: "ok", data: EMPLOYER_BILLING_FIXTURE, source: "fixture" };
}

const PLAN_TIERS: Record<EmployerPlanId, string> = {
  Starter: "starter",
  Growth: "growth",
  Business: "business",
};

/** Start a plan checkout. The plan changes only after Stripe confirms. */
export async function startPlanCheckout(
  orgId: string,
  planId: EmployerPlanId
): Promise<EmployerResult<{ checkoutUrl: string }>> {
  const response = await employerApi<{ url?: string }>(`/api/employer/orgs/${orgId}/plans/checkout`, {
    method: "POST",
    body: { tier: PLAN_TIERS[planId] },
  });
  if (response.ok && response.data?.url) {
    return { status: "ok", data: { checkoutUrl: response.data.url }, source: "live" };
  }
  return {
    status: "unavailable",
    reason: response.ok ? "Checkout could not start." : response.reason,
  };
}

/** Start a checkout for additional recruiter seats. */
export async function startSeatCheckout(
  orgId: string,
  seatCount: number
): Promise<EmployerResult<{ checkoutUrl: string; seatCount: number }>> {
  const response = await employerApi<{ url?: string; seatCount?: number }>(
    `/api/employer/orgs/${orgId}/seats/checkout`,
    { method: "POST", body: { seatCount } }
  );
  if (response.ok && response.data?.url) {
    return {
      status: "ok",
      data: { checkoutUrl: response.data.url, seatCount: response.data.seatCount ?? seatCount },
      source: "live",
    };
  }
  return {
    status: "unavailable",
    reason: response.ok ? "Checkout could not start." : response.reason,
  };
}
