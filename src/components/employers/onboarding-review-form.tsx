"use client";

import { useState } from "react";
import Link from "next/link";
import { submitCompanyDetails, submitPlanSelection, completeOnboarding, type CompanyDetailsInput } from "@/lib/employers/onboarding-adapter";
import type { EmployerPlanId } from "@/lib/employers/types";
import EmployerStatePanel from "@/components/employers/state-panel";

/**
 * Final onboarding submission (F13-B): loading/success/failure/retry states,
 * never an optimistic "you're all set" — `completeOnboarding()` is honest
 * about the backend not existing yet, so this shows that plainly rather than
 * pretending, while still letting the employer continue exploring the
 * dashboard (which renders from dev fixtures regardless of this step).
 */
export default function OnboardingReviewForm({
  companyDetails,
  planId,
}: {
  companyDetails: Partial<CompanyDetailsInput>;
  planId: EmployerPlanId;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [reason, setReason] = useState("");

  async function handleComplete() {
    setStatus("loading");
    const companyResult = await submitCompanyDetails({ companyName: companyDetails.companyName || "", ...companyDetails });
    const planResult = await submitPlanSelection(planId);
    const finalResult = await completeOnboarding();

    const firstFailure = [companyResult, planResult, finalResult].find((r) => r.status === "unavailable");
    if (firstFailure && firstFailure.status === "unavailable") {
      setReason(firstFailure.reason);
      setStatus("unavailable");
      return;
    }
    setStatus("idle");
  }

  if (status === "loading") {
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
          You can still explore your dashboard while this connects.{" "}
          <Link href="/employers/dashboard" className="link">
            Continue to Dashboard →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <button className="figma-btn figma-btn-orange" type="button" style={{ width: "100%", marginTop: 22 }} onClick={handleComplete}>
      Go to Employer Dashboard
    </button>
  );
}
