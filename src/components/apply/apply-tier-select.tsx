"use client";

import { APPLY_TIERS, canAffordTier, type ApplyTier } from "@/lib/pricing/candidate-pricing";

const TIER_ORDER: ApplyTier[] = ["standard", "smart"];

export default function ApplyTierSelect({
  selected,
  onChange,
  walletBalanceCents,
}: {
  selected: ApplyTier;
  onChange: (tier: ApplyTier) => void;
  walletBalanceCents: number;
}) {
  return (
    <div className="apply-tier-select" role="radiogroup" aria-label="Apply tier">
      {TIER_ORDER.map((tier) => {
        const info = APPLY_TIERS[tier];
        const isSelected = tier === selected;
        const affordable = canAffordTier(tier, walletBalanceCents);
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={!affordable}
            aria-disabled={!affordable}
            className={`apply-tier-option${isSelected ? " is-selected" : ""}${affordable ? "" : " is-locked"}`}
            onClick={() => {
              if (affordable) onChange(tier);
            }}
          >
            <div className="apply-tier-option-top">
              <strong>{info.label}</strong>
              <span className="apply-tier-price">{info.priceLabel}</span>
            </div>
            <p className="muted">{info.description}</p>
            {!affordable ? (
              <span className="apply-tier-lock-message">
                Needs {info.priceLabel} in wallet
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
