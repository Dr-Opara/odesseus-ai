import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import MarketingFooter from "@/components/marketing-footer";
import { EMPLOYER_PLANS, PROMOTION_PLANS, RECRUITER_SEAT_PRICE_LABEL, RECRUITER_SEAT_UNIT } from "@/lib/pricing/candidate-pricing";

export default function EmployerPricingPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-page-hero inverse" style={{ minHeight: 0 }}>
          <span className="figma-eyebrow">EMPLOYER PRICING</span>
          <h1>Plans that scale with your hiring.</h1>
          <p>Pricing shown in your local currency, determined by your company’s billing country.</p>
        </section>

        <section className="figma-three-grid employer-prices" style={{ paddingBottom: 20 }}>
          {EMPLOYER_PLANS.map((plan) => (
            <article className="figma-info-card lavender" key={plan.name}>
              <span className="figma-eyebrow">{plan.name.toUpperCase()}</span>
              <h2>{plan.priceLabel} <small>{plan.unit}</small></h2>
              <p>✓ {plan.jobs}</p>
              <p>✓ AI candidate matching</p>
              <p>✓ Applicant pipeline</p>
              <p>✓ Employer dashboard</p>
              <p>✓ Verified employer experience</p>
              <Link className="figma-btn figma-btn-orange" href="/employers/signup">Start Hiring</Link>
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
            <h2>Recruiter seats</h2>
            <p><strong>Additional seat</strong><br />{RECRUITER_SEAT_PRICE_LABEL} {RECRUITER_SEAT_UNIT}</p>
          </article>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
