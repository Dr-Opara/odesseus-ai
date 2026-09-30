/**
 * Employer billing adapter — real subscription, quota, and seat state.
 *
 * Replaces a development fixture. Employer billing is a separate surface from
 * candidate wallet billing (`src/lib/billing/*` and `/billing`): the
 * candidate wallet holds Apply money, the employer subscription holds plan
 * and seat entitlements, and they never share a balance. Nothing in this
 * module may be imported by a candidate-facing page.
 *
 * Plan changes and seat purchases are Stripe checkouts. This adapter starts
 * them and returns a URL. It never changes a plan or grants a seat itself:
 * the webhook verifies the paid amount against the catalog and grants the
 * entitlement, so a button here can only ever open checkout, never report a
 * plan the backend did not record.
 */

import { createClient } from "@/lib/supabase/server";
// Aliased: the backend service and this adapter expose the same function name,
// and the service is the one that does the querying.
import { getEmployerBilling as readBackendBilling } from "@/lib/employer/analytics";
import { planForTier, type EmployerPlan } from "@/lib/employer/plans";
import { resolveEmployerContext } from "./context";
import type { EmployerBillingSummary, EmployerPlanId } from "./types";
import type { EmployerResult } from "./result";

/** The stored plan name mapped onto the Figma plan vocabulary. */
function planIdFor(plan: EmployerPlan | null): EmployerPlanId | null {
  if (!plan) return null;
  if (plan.name === "Growth") return "Growth";
  if (plan.name === "Business") return "Business";
  return "Starter";
}

/** The stored subscription status mapped onto the three states the UI shows. */
function paymentStatusFor(
  status: string | null | undefined
): "current" | "past_due" | "canceled" | null {
  if (status === "active" || status === "trialing") return "current";
  if (status === "past_due" || status === "incomplete") return "past_due";
  if (status === "canceled") return "canceled";
  return null;
}

/**
 * The full billing view: what the org is on, what it has used, what it costs.
 *
 * Standalone rather than extending the older `EmployerBillingSummary` display
 * type, because the fields that can legitimately be unknown here — the plan
 * name and price, for an org with no subscription — must be nullable. A
 * `Summary` that required them would force a fallback plan, which is exactly
 * the "borrowing another plan's number" failure this module avoids.
 */
export type EmployerBillingView = {
  /** `null` when the org has no subscription, or a tier this build does not know. */
  planId: EmployerPlanId | null;
  planName: string | null;
  priceLabel: string | null;
  unit: string | null;
  /** Job posts included by the plan, and what is left this period. */
  jobPostsIncluded: number | null;
  jobPostsRemaining: number | null;
  jobPostsPublished: number | null;
  subscriptionStatus: string | null;
  paymentStatus: "current" | "past_due" | "canceled" | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Convenience alias for the billing period end, for the "renews" line. */
  renewalDate: string | null;
  /** Recruiter seats: what the plan includes, and what is paid and active. */
  seatsUsed: number;
  seatLimit: number;
  seats: { required: number; active: number; activeUntil: string | null } | null;
  /** Promotions currently running across the org's jobs. */
  featuredActive: number;
};

/**
 * The organization's current billing state.
 *
 * Every number here is read from the backend's billing view. An org with no
 * subscription reports `planId: null` rather than inheriting Starter's price,
 * which is the difference between "you are not on a plan" and "you are on
 * the cheapest one".
 */
export async function getEmployerBilling(): Promise<EmployerResult<EmployerBillingView>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const [billing, subscription] = await Promise.all([
      readBackendBilling(supabase, resolved.context.orgId, resolved.context.userId),
      supabase
        .from("employer_subscriptions")
        .select("tier,status,period_start,period_end")
        .eq("org_id", resolved.context.orgId)
        .maybeSingle(),
    ]);

    const tier =
      typeof subscription.data?.tier === "string"
        ? subscription.data.tier
        : (billing.plan?.tier ?? null);
    const plan = planForTier(tier);

    return {
      status: "ok",
      source: "live",
      data: {
        planId: planIdFor(plan),
        planName: plan?.name ?? null,
        priceLabel: plan?.priceLabel ?? null,
        unit: plan?.unit ?? null,
        // The included count is the plan's approved figure, and the backend's
        // capacity block is the live truth. Both are shown: one is what they
        // bought, the other is what is left.
        jobPostsIncluded: plan ? plan.jobPostsIncluded : null,
        jobPostsRemaining: billing.capacity.remaining,
        jobPostsPublished: billing.capacity.published,
        subscriptionStatus: billing.subscriptionStatus,
        paymentStatus: paymentStatusFor(billing.subscriptionStatus),
        renewalDate: billing.periodEnd,
        periodStart: billing.periodStart,
        periodEnd: billing.periodEnd,
        seatsUsed: billing.seats?.active ?? 0,
        seatLimit: billing.seats?.required ?? 0,
        seats: billing.seats,
        featuredActive: billing.featuredActive,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_BILLING] read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your billing details." };
  }
}

/** The plan a checkout should start for, given a Figma plan name. */
function tierForPlan(planId: EmployerPlanId): "starter" | "growth" | "business" {
  if (planId === "Growth") return "growth";
  if (planId === "Business") return "business";
  return "starter";
}

/**
 * Starts a subscription checkout for a plan.
 *
 * The plan price comes from the billing catalog inside the route, never from
 * the request, so a client cannot choose what it pays. Nothing is granted
 * here: the subscription row and its job-post credits appear only once the
 * webhook confirms a paid invoice.
 */
export async function changeEmployerPlan(
  planId: EmployerPlanId
): Promise<EmployerResult<{ url: string }>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(
      `/api/employer/orgs/${resolved.context.orgId}/plans/checkout`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierForPlan(planId) }),
      }
    );
    const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !payload.url) {
      return { status: "unavailable", reason: payload.error ?? "Could not start plan checkout." };
    }
    return { status: "ok", data: { url: payload.url }, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_BILLING] plan checkout failed", message);
    return { status: "unavailable", reason: "Odesseus could not start plan checkout." };
  }
}

/**
 * Starts a checkout for additional recruiter seats.
 *
 * A paid purchase, so it returns a Stripe checkout URL and grants nothing.
 * The seat price ($20/month) and the allowed quantity come from the billing
 * catalog inside the route; the webhook confirms payment and syncs
 * `recruiter_seats`. Until that happens, the seat count on this page is
 * unchanged, and that is the honest state.
 */
export async function purchaseRecruiterSeat(
  seats = 1
): Promise<EmployerResult<{ url: string }>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(`/api/employer/orgs/${resolved.context.orgId}/seats/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
            // `seatCount`, not `seats`: the endpoint's schema, its response, and the
      // Stripe metadata key `odesseus_seat_count` that the webhook
      // re-verifies all name it that. This mismatch meant every seat purchase
      // from this caller was refused with a 400 before reaching Stripe, so no
      // seat was ever purchasable.
      body: JSON.stringify({ seatCount: seats }),
    });
    const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !payload.url) {
      return { status: "unavailable", reason: payload.error ?? "Could not start seat checkout." };
    }
    return { status: "ok", data: { url: payload.url }, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_BILLING] seat checkout failed", message);
    return { status: "unavailable", reason: "Odesseus could not start seat checkout." };
  }
}
