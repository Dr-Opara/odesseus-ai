"use client";

import { useState } from "react";
import ApplyStartForm from "@/components/apply-start-form";
import ApplyTierSelect from "@/components/apply/apply-tier-select";
import { APPLY_TIERS, type ApplyTier } from "@/lib/pricing/candidate-pricing";

export default function ApplyTierAndStart({
  jobId,
  defaultUrl,
}: {
  jobId: string;
  defaultUrl?: string | null;
}) {
  const [tier, setTier] = useState<ApplyTier>("standard");

  return (
    <div className="apply-tier-and-start">
      <ApplyTierSelect selected={tier} onChange={setTier} />
      <ApplyStartForm jobId={jobId} defaultUrl={defaultUrl} applyTier={tier} />
      <p className="muted apply-tier-charge-note">
        Charged only after a successful submission — {APPLY_TIERS[tier].priceLabel} for{" "}
        {APPLY_TIERS[tier].label}.
      </p>
    </div>
  );
}
