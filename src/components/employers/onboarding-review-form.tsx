"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { provisionEmployerOrg, type CompanyDetailsInput } from "@/lib/employers/onboarding-adapter";
import { startPlanCheckout } from "@/lib/employers/billing-adapter";
import type { EmployerPlanId } from "@/lib/employers/types";
import EmployerStatePanel from "@/components/employers/state-panel";

/**
 * Final onboarding submission (F13-B): loading/success/failure/retry states,
 * never an optimistic "you're all set".
 *
 * Two real calls, in order, and only what each confirmed is reported:
 * 1. `POST /api/employer/orgs` provisions the organization and owner
 *    membership (idempotent, so a retry converges instead of duplicating).
 * 2. The chosen plan is a paid subscription, so the employer is handed to
 *    Stripe's checkout. Their plan is not "set" until the billing webhook
 *    confirms payment, and the screen never says otherwise.
 */
export default function OnboardingReviewForm({
  companyDetails,
  planId,
}: {
  companyDetails: CompanyDetailsInput;
  planId: EmployerPlanId;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle");
  const [reason, setReason] = useState("");

  async function handleComplete() {
    setStatus("saving");
    setReason("");

    const provisioned = await provisionEmployerOrg({
      ...companyDetails,
      companyName: companyDetails.companyName.trim(),
    });

    if (provisioned.status === "unavailable") {
      setReason(provisioned.reason);
      setStatus("failed");
      return;
    }

    const checkout = await startPlanCheckout(provisioned.data.id, planId);
    if (checkout.status === "unavailable") {
      setReason(
        `Your company is set up. ${checkout.reason} You can pick a plan any time from Employer Billing.`
      );
      setStatus("failed");
      router.refresh();
      return;
    }

    window.location.assign(checkout.data.checkoutUrl);
  }

  if (status === "saving") {
    return <EmployerStatePanel kind="loading" />;
  }

  return (
    <>
      {status === "failed" ? (
        <div style={{ marginTop: 24 }}>
          <EmployerStatePanel kind="error" title="Setup isn't finished yet" message={reason} onRetry={handleComplete} />
        </div>
      ) : null}
      <button className="figma-btn figma-btn-orange" type="button" style={{ width: "100%", marginTop: 22 }} onClick={handleComplete}>
        Create company and continue to payment
      </button>
    </>
  );
}
