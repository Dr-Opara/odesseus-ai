"use client";

import { useState } from "react";
import { startPlanCheckout } from "@/lib/employers/billing-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";
import type { EmployerPlanId } from "@/lib/employers/types";

/**
 * Plan management (F13-N). Choosing a plan starts a Stripe subscription
 * checkout; the org's plan only changes once the billing webhook confirms the
 * paid invoice, so nothing here reports a plan it has not been given.
 */
export default function ManagePlanButton({
  orgId,
  currentPlanId,
}: {
  orgId: string;
  currentPlanId: EmployerPlanId | null;
}) {
  const [pending, setPending] = useState<EmployerPlanId | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  async function choose(planId: EmployerPlanId) {
    setPending(planId);
    setReason(null);
    const result = await startPlanCheckout(orgId, planId);
    setPending(null);
    if (result.status === "unavailable") {
      setReason(result.reason);
      return;
    }
    window.location.assign(result.data.checkoutUrl);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <strong>Plans</strong>
      <div className="emp-row-list" style={{ marginTop: 12 }}>
        {EMPLOYER_PLANS.map((plan) => (
          <div className="emp-row" key={plan.name} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span className="emp-row-value">
              {plan.name} · {plan.priceLabel}
              {plan.unit} · {plan.jobs}
            </span>
            {currentPlanId === plan.name ? (
              <span className="muted" style={{ fontSize: 13 }}>Current plan</span>
            ) : (
              <button
                type="button"
                className="emp-btn-secondary"
                onClick={() => choose(plan.name as EmployerPlanId)}
                disabled={pending !== null}
              >
                {pending === plan.name ? "Starting…" : `Choose ${plan.name}`}
              </button>
            )}
          </div>
        ))}
      </div>

      {reason ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="We couldn't start that checkout" message={reason} />
        </div>
      ) : null}
    </div>
  );
}
