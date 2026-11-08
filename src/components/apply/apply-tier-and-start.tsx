"use client";

import { useState } from "react";
import ApplyStartForm from "@/components/apply-start-form";
import ApplyTierSelect from "@/components/apply/apply-tier-select";
import { APPLICATION_PRICE_LABEL, APPLY_TIERS, type ApplyTier } from "@/lib/pricing/candidate-pricing";

export default function ApplyTierAndStart({
  jobId,
  defaultUrl,
  canApply,
}: {
  jobId: string;
  defaultUrl?: string | null;
  canApply: boolean;
}) {
  const [tier, setTier] = useState<ApplyTier>("standard");

  return (
    <div className="apply-tier-and-start">
      <ApplyTierSelect selected={tier} onChange={setTier} canApply={canApply} />
      <ApplyStartForm jobId={jobId} defaultUrl={defaultUrl} applyTier={tier} />
      <p className="muted apply-tier-charge-note">
        {APPLY_TIERS[tier].label} uses 1 application credit ({APPLICATION_PRICE_LABEL}) only after a
        verified successful submission.
      </p>
    </div>
  );
}
