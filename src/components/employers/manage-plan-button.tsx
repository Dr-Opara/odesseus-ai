"use client";

import { useState } from "react";
import { startPlanCheckoutAction } from "@/lib/employers/actions";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";
import type { EmployerPlanId } from "@/lib/employers/types";

/**
 * Plan management (F13-N).
 *
 * The AI Starter Bundle is the only plan for sale. This starts its Stripe
 * subscription checkout and sends the employer to the hosted page; base
 * credits appear only once the billing webhook confirms a paid invoice.
 * Employers on an earlier plan can move to the bundle from here.
 */
export default function ManagePlanButton({
  orgId,
  currentPlanId,
}: {
  orgId: string;
  currentPlanId: EmployerPlanId;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const bundle = EMPLOYER_PLANS[0];

  if (currentPlanId === "AI Starter Bundle") return null;

  async function startCheckout() {
    setPending(true);
    setFailure(null);
    const result = await startPlanCheckoutAction(orgId, "AI Starter Bundle");
    setPending(false);

    if (result.status === "unavailable") {
      setFailure(result.reason);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Switch to the AI Starter Bundle</h2>
      <div className="emp-page-actions">
        <button type="button" className="emp-btn-secondary" disabled={pending} onClick={startCheckout}>
          {pending ? "Opening checkout…" : `${bundle.name} · ${bundle.priceLabel} USD ${bundle.unit}`}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
        Opens our payment provider&rsquo;s checkout. Your current plan stays active until the new one is confirmed.
      </p>
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <EmployerStatePanel kind="error" title="Could not start plan checkout" message={failure} />
        </div>
      ) : null}
    </div>
  );
}
