"use client";

import Link from "next/link";
import { useState } from "react";
import {
  APPLY_TIERS,
  EMPLOYER_PLANS,
  PREP_AGENT_PRICE_LABEL,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  WALLET_TOPUP_AMOUNTS_CENTS,
  formatCents,
} from "@/lib/pricing/candidate-pricing";

/**
 * Mobile /pricing — two public audience tabs (Applicants | Business).
 *
 * This is presentation-only copy built from the same display constants the
 * desktop pricing page uses (`src/lib/pricing/candidate-pricing.ts`). It
 * never touches the billing engine or wallet balances, and no login is
 * required — the route is public in the auth boundary proxy.
 */

type Tab = "applicants" | "business";

export default function MobilePricing() {
  const [tab, setTab] = useState<Tab>("applicants");

  return (
    <>
      <div className="m-segmented" role="tablist" aria-label="Pricing audience">
        <button
          className={tab === "applicants" ? "active" : ""}
          role="tab"
          aria-selected={tab === "applicants"}
          onClick={() => setTab("applicants")}
          type="button"
        >
          Applicants
        </button>
        <button
          className={tab === "business" ? "active" : ""}
          role="tab"
          aria-selected={tab === "business"}
          onClick={() => setTab("business")}
          type="button"
        >
          Business
        </button>
      </div>

      <section role="tabpanel" hidden={tab !== "applicants"}>
        <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>CANDIDATE</p>
        <div className="m-list">
          <div className="m-card">
            <span className="m-copy">
              <strong>{APPLY_TIERS.standard.label} · {APPLY_TIERS.standard.priceLabel}</strong>
              <small>{APPLY_TIERS.standard.description}</small>
            </span>
          </div>
          <div className="m-card">
            <span className="m-copy">
              <strong>{APPLY_TIERS.smart.label} · {APPLY_TIERS.smart.priceLabel}</strong>
              <small>{APPLY_TIERS.smart.description}</small>
            </span>
          </div>
          {WALLET_TOPUP_AMOUNTS_CENTS.map((amountCents) => (
            <div className="m-card" key={amountCents}>
              <span className="m-copy">
                <strong>Wallet top-up · {formatCents(amountCents)}</strong>
                <small>Spend on Standard or Smart Apply as you go</small>
              </span>
            </div>
          ))}
          <div className="m-card">
            <span className="m-copy">
              <strong>Interview preparation · {PREP_AGENT_PRICE_LABEL}</strong>
              <small>Role-based questions, STAR stories and technical prep</small>
            </span>
          </div>
        </div>

        <div className="m-card" style={{ marginTop: 14 }}>
          <span className="m-copy">
            <strong>Application tracking · Included</strong>
            <small>Tracked with every account</small>
          </span>
        </div>
      </section>

      <section role="tabpanel" hidden={tab !== "business"}>
        <p className="m-eyebrow" style={{ margin: "4px 4px 8px" }}>EMPLOYER</p>
        <div className="m-list">
          {EMPLOYER_PLANS.map((plan) => (
            <div className="m-card" key={plan.name}>
              <span className="m-copy">
                <strong>{plan.name} · {plan.priceLabel}{plan.unit}</strong>
                <small>{plan.jobs}</small>
              </span>
            </div>
          ))}
        </div>

        <p className="m-eyebrow" style={{ margin: "20px 4px 8px" }}>PROMOTIONS</p>
        <div className="m-list">
          {PROMOTION_PLANS.map((plan) => (
            <div className="m-card" key={`${plan.name}-${plan.unit}`}>
              <span className="m-copy">
                <strong>{plan.name} · {plan.priceLabel}</strong>
                <small>{plan.unit.replace(/^\//, "").trim()}</small>
              </span>
            </div>
          ))}
        </div>

        <p className="m-eyebrow" style={{ margin: "20px 4px 8px" }}>RECRUITER</p>
        <div className="m-list">
          <div className="m-card">
            <span className="m-copy">
              <strong>Recruiter seat · {RECRUITER_SEAT_PRICE_LABEL}/month</strong>
              <small>Per additional seat as your hiring team grows</small>
            </span>
          </div>
        </div>

        <p className="m-note">
          Business accounts are set up and managed through the desktop employer
          experience.
        </p>
      </section>

      <p className="m-note" style={{ marginTop: 20 }}>Localized market pricing can be shown based on account or billing region.</p>
      <Link className="m-action" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/signup">Get Started →</Link>
    </>
  );
}