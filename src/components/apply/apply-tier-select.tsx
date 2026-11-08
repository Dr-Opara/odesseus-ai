"use client";

import { APPLY_TIERS, type ApplyTier } from "@/lib/pricing/candidate-pricing";

const TIER_ORDER: ApplyTier[] = ["standard", "smart"];

export default function ApplyTierSelect({
  selected,
  onChange,
  canApply,
}: {
  selected: ApplyTier;
  onChange: (tier: ApplyTier) => void;
  canApply: boolean;
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
            disabled={!canApply}
            aria-disabled={!canApply}
            className={`apply-tier-option${isSelected ? " is-selected" : ""}${canApply ? "" : " is-locked"}`}
            onClick={() => {
              if (canApply) onChange(tier);
            }}
          >
            <div className="apply-tier-option-top">
              <strong>{info.label}</strong>
              <span className="apply-tier-price">1 credit</span>
            </div>
            <p className="muted">{info.description}</p>
            {!canApply ? (
              <span className="apply-tier-lock-message">Needs 1 application credit</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
