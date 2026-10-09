"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  APPLY_TIERS,
  EMPLOYER_PLANS,
  PREP_AGENT_DESCRIPTION,
  PREP_AGENT_LABEL,
  PREP_AGENT_PRICE_LABEL,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  WALLET_TOPUP_AMOUNTS_CENTS,
  formatCents,
} from "@/lib/pricing/candidate-pricing";

type Tab = "applicants" | "business";
type Tone = "peach" | "green" | "purple" | "blue" | "neutral";

function PricingIcon({
  type,
  tone = "neutral",
}: {
  type:
    | "apply"
    | "smart"
    | "wallet"
    | "prep"
    | "shield"
    | "tracking"
    | "starter"
    | "growth"
    | "business"
    | "featured"
    | "ai"
    | "recruiter"
    | "desktop"
    | "globe";
  tone?: Tone;
}) {
  const paths: Record<string, ReactNode> = {
    apply: <><path d="M7 3.5h7l3 3V20H7z"/><path d="M14 3.5V7h3"/><path d="M10 11h4M10 14h4M10 17h3"/></>,
    smart: <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Zm5 10 .8 2.2L20 16l-2.2.8L17 19l-.8-2.2L14 16l2.2-.8L17 13Z"/>,
    wallet: <><path d="M4 7.5h15v10H4z"/><path d="M6 7.5V5h10v2.5M15.5 12h3.5M16 12h.01"/></>,
    prep: <><path d="m3 8 9-4 9 4-9 4-9-4Z"/><path d="M7 10.2V15c2.5 2 7.5 2 10 0v-4.8M21 8v6"/></>,
    shield: <><path d="M12 3 5.5 5.5V11c0 4.2 2.8 7.8 6.5 10 3.7-2.2 6.5-5.8 6.5-10V5.5L12 3Z"/><path d="M12 8v5M12 16h.01"/></>,
    tracking: <><path d="M5 19V12M10 19V8M15 19V5M20 19V10"/></>,
    starter: <><path d="M7 17c-1.5-2 .2-4.5 2.8-5.2C10 9 12.4 6 17 5c1 4.5-2 7-4.8 7.2C11.5 15 9 16.7 7 17Z"/><path d="M7 17c2-3 4.5-5 8-7"/></>,
    growth: <><path d="M5 19v-5M10 19V9M15 19V5M20 19v-9"/></>,
    business: <><path d="M5 20V7h14v13M8 7V4h8v3M9 11h2M13 11h2M9 15h2M13 15h2"/></>,
    featured: <><path d="M4 14V9l12-4v13L4 14Z"/><path d="m7 14 1 5h4l-1-4.2M18 8.5l2-1M18 15.5l2 1"/></>,
    ai: <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"/>,
    recruiter: <><path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15.5 10a2.5 2.5 0 1 0 0-5"/><path d="M3.5 19c.4-3.2 2.2-5 5-5s4.6 1.8 5 5M14 14c3.3 0 5.5 1.6 6 4.5"/></>,
    desktop: <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.6 5.8 3.6 9S14.5 18.2 12 21M12 3C9.5 5.8 8.4 8.8 8.4 12s1.1 6.2 3.6 9"/></>,
  };

  return (
    <span className={`pricing-icon pricing-icon-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[type]}
      </svg>
    </span>
  );
}

function PricingCard({
  icon,
  tone = "neutral",
  title,
  description,
  href,
  recommended = false,
}: {
  icon: Parameters<typeof PricingIcon>[0]["type"];
  tone?: Tone;
  title: ReactNode;
  description: ReactNode;
  href: string;
  recommended?: boolean;
}) {
  return (
    <Link
      className={`pricing-card pricing-card-${tone}${recommended ? " is-recommended" : ""}`}
      href={href}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <PricingIcon type={icon} tone={tone} />
      <span className="pricing-card-copy">
        <span className="pricing-card-title">
          <strong>{title}</strong>
          {recommended ? <span className="pricing-recommended">Recommended</span> : null}
        </span>
        <small>{description}</small>
      </span>
      <span className="pricing-chevron" aria-hidden="true">›</span>
    </Link>
  );
}

const WALLET_SKUS = ["wallet_10", "wallet_20", "wallet_50"] as const;
const PROMOTION_TIERS = ["featured_7d", "featured_14d", "ai_30d"] as const;

function pricingGo(params: Record<string, string>) {
  return `/pricing/go?${new URLSearchParams(params).toString()}`;
}

export default function MobilePricing() {
  const [tab, setTab] = useState<Tab>("applicants");

  return (
    <div className={`pricing-mobile pricing-mobile-${tab}`}>
      <div className="pricing-decor pricing-decor-applicant" aria-hidden="true">
        <span />
        <i />
      </div>
      <div className="pricing-decor pricing-decor-business" aria-hidden="true">
        <span />
        <i />
      </div>

      <div className="m-segmented pricing-tabs" role="tablist" aria-label="Pricing audience">
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

      <div className="pricing-audiences">
      <section className="pricing-panel pricing-panel-candidate" role="tabpanel" hidden={tab !== "applicants"}>
        <p className="pricing-column-title">Candidate Pricing</p>
        <p className="pricing-section-label">CANDIDATE</p>
        <div className="pricing-list">
          <PricingCard
            icon="apply"
            tone="peach"
            title={<>{APPLY_TIERS.standard.label} · {APPLY_TIERS.standard.priceLabel}</>}
            description={APPLY_TIERS.standard.description}
            href={pricingGo({ audience: "candidate", action: "apply" })}
          />
          <PricingCard
            icon="smart"
            tone="peach"
            title={<>{APPLY_TIERS.smart.label} · {APPLY_TIERS.smart.priceLabel}</>}
            description={APPLY_TIERS.smart.description}
            href={pricingGo({ audience: "candidate", action: "apply" })}
            recommended
          />
          {WALLET_TOPUP_AMOUNTS_CENTS.map((amountCents, index) => (
            <PricingCard
              key={amountCents}
              icon="wallet"
              tone={index === 0 ? "green" : index === 1 ? "purple" : "blue"}
              title={<>Wallet top-up · {formatCents(amountCents)}</>}
              description={<>Spend on {APPLY_TIERS.standard.label} or {APPLY_TIERS.smart.label} as you go.</>}
              href={pricingGo({ audience: "candidate", action: "wallet", sku: WALLET_SKUS[index] })}
            />
          ))}
          <PricingCard
            icon="prep"
            title={<>{PREP_AGENT_LABEL} · {PREP_AGENT_PRICE_LABEL}</>}
            description={PREP_AGENT_DESCRIPTION}
            href={pricingGo({ audience: "candidate", action: "dashboard" })}
          />
        </div>
      </section>

      <section className="pricing-panel pricing-panel-employer" role="tabpanel" hidden={tab !== "business"}>
        <p className="pricing-column-title">Employer Pricing</p>
        <p className="pricing-section-label">EMPLOYER PLANS</p>
        <div className="pricing-list">
          {EMPLOYER_PLANS.map((plan, index) => (
            <PricingCard
              key={plan.name}
              icon={index === 0 ? "starter" : index === 1 ? "growth" : "business"}
              tone={index === 1 ? "green" : "neutral"}
              title={<>{plan.name} · {plan.priceLabel}{plan.unit}</>}
              description={<>{plan.jobs}{index === 0 ? " · Great for getting started." : index === 1 ? " · Most popular for growing teams." : " · For larger teams with higher volume."}</>}
              href={pricingGo({ audience: "employer", action: "plan", plan: plan.name.toLowerCase() })}
              recommended={index === 1}
            />
          ))}
        </div>

        <p className="pricing-section-label pricing-section-spaced">PROMOTIONS</p>
        <div className="pricing-list">
          {PROMOTION_PLANS.map((plan, index) => (
            <PricingCard
              key={`${plan.name}-${plan.unit}`}
              icon={index === 2 ? "ai" : "featured"}
              tone={index === 0 ? "peach" : index === 1 ? "purple" : "purple"}
              title={<>{plan.name} · {plan.priceLabel}</>}
              description={plan.unit.replace(/^\//, "").trim()}
              href={pricingGo({ audience: "employer", action: "promotion", tier: PROMOTION_TIERS[index] })}
            />
          ))}
        </div>

        <p className="pricing-section-label pricing-section-spaced">RECRUITER</p>
        <div className="pricing-list">
          <PricingCard
            icon="recruiter"
            tone="peach"
            title={<>Recruiter seat · {RECRUITER_SEAT_PRICE_LABEL}/month</>}
            description={<>Per additional seat as your hiring team grows.</>}
            href={pricingGo({ audience: "employer", action: "seat" })}
          />
        </div>

        <div className="pricing-info-row">
          <PricingIcon type="desktop" />
          <span>Business accounts are set up and managed through the desktop employer experience.</span>
        </div>
      </section>
      </div>

      <div className="pricing-info-row pricing-region-note">
        <PricingIcon type="globe" />
        <span>Localized market pricing can be shown based on account or billing region.</span>
      </div>

      <Link className="m-action pricing-cta" href={pricingGo({ audience: tab === "business" ? "employer" : "candidate", action: "signup" })}>Get Started →</Link>
    </div>
  );
}
