"use client";

import { APPLY_TIERS, type ApplyTier } from "@/lib/pricing/candidate-pricing";

const TIER_ORDER: ApplyTier[] = ["standard", "smart"];

export default function ApplyTierSelect({
  selected,
  onChange,
}: {
  selected: ApplyTier;
  onChange: (tier: ApplyTier) => void;
}) {
  return (
    <div className="apply-tier-select" role="radiogroup" aria-label="Apply tier">
      {TIER_ORDER.map((tier) => {
        const info = APPLY_TIERS[tier];
        const isSelected = tier === selected;
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`apply-tier-option${isSelected ? " is-selected" : ""}`}
            onClick={() => onChange(tier)}
          >
            <div className="apply-tier-option-top">
              <strong>{info.label}</strong>
              <span className="apply-tier-price">{info.priceLabel}</span>
            </div>
            <p className="muted">{info.description}</p>
          </button>
        );
      })}
    </div>
  );
}
