"use client";

import { useState } from "react";
import Link from "next/link";
import { provisionOrganizationAction, startPlanCheckoutAction } from "@/lib/employers/actions";
import type { EmployerPlanId } from "@/lib/employers/types";
import EmployerStatePanel from "@/components/employers/state-panel";

/**
 * Final onboarding submission (F13-B), step 3 of 3.
 *
 * Two real steps, because the backend has two:
 *
 *  1. **Provision the organization.** Signup creates only the auth user, so
 *     this is the call that gives the employer a company workspace. The RPC
 *     is idempotent, so a double submit converges on one organization rather
 *     than creating two.
 *  2. **Choose a plan.** A plan is a paid subscription, so this starts a
 *     Stripe checkout and leaves for the hosted page. The subscription row and
 *     its job-post credits appear only once the webhook confirms payment.
 *
 * There is deliberately no optimistic "you're all set". A button that reported
 * success here would tell an employer their workspace and plan exist when the
 * server had recorded neither.
 */
export default function OnboardingReviewForm({
  companyName,
  planId,
  onProvisioned,
}: {
  companyName: string;
  planId: EmployerPlanId;
  /** Called with the new org id once the workspace really exists. */
  onProvisioned?: (orgId: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "provisioning" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleComplete() {
    setStatus("provisioning");
    setReason("");

    const provisioned = await provisionOrganizationAction(companyName);
    if (provisioned.status === "unavailable") {
      setReason(provisioned.reason);
      setStatus("unavailable");
      return;
    }

    onProvisioned?.(provisioned.data.orgId);

    // The plan is a purchase, so this leaves for checkout rather than
    // reporting a plan the server has not recorded.
    const checkout = await startPlanCheckoutAction(provisioned.data.orgId, planId);
    if (checkout.status === "unavailable") {
      setReason(checkout.reason);
      setStatus("unavailable");
      return;
    }

    window.location.assign(checkout.data.url);
  }

  if (status === "provisioning") {
    return <EmployerStatePanel kind="loading" />;
  }

  if (status === "unavailable") {
    return (
      <div style={{ marginTop: 24 }}>
        <EmployerStatePanel
          kind="error"
          title="Setup isn't fully saved yet"
          message={reason}
          onRetry={handleComplete}
        />
        <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: 13 }}>
          Your workspace may already be set up.{" "}
          <Link href="/employers/dashboard" className="link">
            Continue to Dashboard →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <button
      className="figma-btn figma-btn-orange"
      type="button"
      style={{ width: "100%", marginTop: 22 }}
      onClick={handleComplete}
    >
      Set up workspace and continue to checkout
    </button>
  );
}
