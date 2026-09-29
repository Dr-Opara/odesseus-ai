"use client";

import { useState } from "react";
import { startPlanCheckoutAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";
import type { EmployerPlanId } from "@/lib/employers/types";

/**
 * Plan management (F13-N).
 *
 * A plan is a paid subscription, so this never changes a plan itself: it
 * starts a Stripe checkout through the org's plans route and sends the employer
 * to the hosted page. The subscription row and its job-post credits appear
 * only once the billing webhook confirms a paid invoice, so the button is
 * labelled as taking them to checkout rather than as saving a change.
 *
 * The plan price comes from the billing catalog inside the route, not from
 * this list, which only exists to show what the choices are.
 */
export default function ManagePlanButton({
  orgId,
  currentPlanId,
}: {
  orgId: string;
  currentPlanId: EmployerPlanId;
}) {
  const [pending, setPending] = useState<EmployerPlanId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function startCheckout(planId: EmployerPlanId) {
    setPending(planId);
    setFailure(null);
    const result = await startPlanCheckoutAction(orgId, planId);
    setPending(null);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    // Leave for the hosted checkout. Nothing is granted until Stripe confirms.
    window.location.assign(result.data.url);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Change plan</h2>
      <div className="emp-page-actions">
        {EMPLOYER_PLANS.filter((plan) => plan.name !== currentPlanId).map((plan) => (
          <button
            key={plan.name}
            type="button"
            className="emp-btn-secondary"
            disabled={pending !== null}
            onClick={() => startCheckout(plan.name as EmployerPlanId)}
          >
            {pending === plan.name
              ? "Opening checkout…"
              : `Switch to ${plan.name} · ${plan.priceLabel}${plan.unit}`}
          </button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
        Plan changes open our payment provider&rsquo;s checkout. Your current plan stays active
        until the new one is confirmed.
      </p>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Could not start plan checkout" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
