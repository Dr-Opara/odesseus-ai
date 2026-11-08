import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import MarketingFooter from "@/components/marketing-footer";
import {
  ADDON_JOB_POST_PRICE_LABEL,
  ADDON_JOB_POST_UNIT,
  EMPLOYER_PLANS,
  EMPLOYER_PRICING_NOTE,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  RECRUITER_SEAT_UNIT,
} from "@/lib/pricing/candidate-pricing";

export default function EmployerPricingPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-page-hero inverse" style={{ minHeight: 0 }}>
          <span className="figma-eyebrow">EMPLOYER PRICING</span>
          <h1>The AI Multi-Post Bundle.</h1>
          <p>{EMPLOYER_PRICING_NOTE} Prices are in USD.</p>
        </section>

        <section className="figma-three-grid employer-prices" style={{ paddingBottom: 20 }}>
          {EMPLOYER_PLANS.map((plan) => (
            <article className="figma-info-card lavender" key={plan.name}>
              <span className="figma-eyebrow">{plan.name.toUpperCase()}</span>
              <h2>{plan.priceLabel} <small>USD {plan.unit}</small></h2>
              {plan.features.map((feature) => (
                <p key={feature}>✓ {feature}</p>
              ))}
              {/* Employer accounts are created on desktop/web only. On a phone
                  the business entry point is Business Login, so the call to
                  action points at sign-in there instead of at a sign-up form
                  that is not offered. */}
              <Link className="figma-btn figma-btn-orange odesseus-desktop-only" href="/employers/signup">Start Hiring</Link>
              <Link className="figma-btn figma-btn-orange odesseus-mobile-only" href="/employers/login">Business Login</Link>
            </article>
          ))}
        </section>

        <section className="figma-two-grid employer-prices" style={{ paddingBottom: 40 }}>
          <article className="figma-info-card white">
            <h2>Job promotions</h2>
            {PROMOTION_PLANS.map((plan) => (
              <p key={`${plan.name}-${plan.unit}`}><strong>{plan.name} {plan.unit}</strong><br />{plan.priceLabel}</p>
            ))}
          </article>
          <article className="figma-info-card white">
            <h2>Additional job posts</h2>
            <p>
              <strong>{ADDON_JOB_POST_PRICE_LABEL} USD</strong> {ADDON_JOB_POST_UNIT}, available while your AI Starter
              Bundle is active. Each credit is valid for 30 days from purchase.
            </p>
            <p>
              Base credits must be used during their 30-day billing cycle and do not roll over. Every published post
              stays live for 30 days from the moment its credit is used.
            </p>
          </article>
          <article className="figma-info-card white">
            <h2>Recruiter seats</h2>
            <p><strong>Additional seat</strong><br />{RECRUITER_SEAT_PRICE_LABEL} {RECRUITER_SEAT_UNIT}</p>
          </article>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
