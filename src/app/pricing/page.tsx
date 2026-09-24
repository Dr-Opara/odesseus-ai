import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";
import {
  APPLY_TIERS,
  EMPLOYER_PLANS,
  PROMOTION_PLANS,
  RECRUITER_SEAT_PRICE_LABEL,
  RECRUITER_SEAT_UNIT,
  LIVE_PLANS,
  WALLET_TOPUP_AMOUNTS_CENTS,
  formatCents,
} from "@/lib/pricing/candidate-pricing";

export default function PricingPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />

          <section className="figma-page-hero">
            <span className="figma-eyebrow">PRICING</span>
            <h1>Flexible pricing for candidates and employers.</h1>
            <p>Choose what you need without forcing every user into the same plan.</p>
          </section>

          <section style={{ margin: "0 20px 8px" }}>
            <span className="figma-eyebrow">CANDIDATE</span>
          </section>
          <section className="figma-three-grid">
            <article className="figma-price-card">
              <strong>{APPLY_TIERS.standard.priceLabel}</strong>
              <p>{APPLY_TIERS.standard.label} — {APPLY_TIERS.standard.description}</p>
            </article>
            <article className="figma-price-card">
              <strong>{APPLY_TIERS.smart.priceLabel}</strong>
              <p>{APPLY_TIERS.smart.label} — {APPLY_TIERS.smart.description}</p>
            </article>
            <article className="figma-price-card green">
              <strong>Free</strong>
              <p>Prep Agent interview preparation.</p>
            </article>
          </section>
          <section className="figma-three-grid compact">
            {WALLET_TOPUP_AMOUNTS_CENTS.map((amountCents) => (
              <article className="figma-price-card" key={amountCents}>
                <strong>{formatCents(amountCents)}</strong>
                <p>Wallet top-up — spend on Standard or Smart Apply as you go.</p>
              </article>
            ))}
          </section>

          <section style={{ margin: "40px 20px 8px" }}>
            <span className="figma-eyebrow purple">EMPLOYER</span>
          </section>
          <section className="figma-three-grid">
            {EMPLOYER_PLANS.map((plan) => (
              <article className="figma-price-card lavender" key={plan.name}>
                <strong>{plan.priceLabel}<small style={{ fontSize: 16, fontWeight: 700 }}> {plan.unit}</small></strong>
                <p>{plan.name} — {plan.jobs}.</p>
              </article>
            ))}
          </section>

          <section style={{ margin: "40px 20px 8px" }}>
            <span className="figma-eyebrow cyan">PROMOTIONS</span>
          </section>
          <section className="figma-three-grid compact">
            {PROMOTION_PLANS.map((plan) => (
              <article className="figma-price-card" key={`${plan.name}-${plan.unit}`}>
                <strong>{plan.priceLabel}</strong>
                <p>{plan.name} {plan.unit}</p>
              </article>
            ))}
          </section>

          <section style={{ margin: "40px 20px 8px" }}>
            <span className="figma-eyebrow">RECRUITER</span>
          </section>
          <section className="figma-two-grid" style={{ marginBottom: 0 }}>
            <article className="figma-info-card white">
              <h2>{RECRUITER_SEAT_PRICE_LABEL} <small style={{ fontSize: 16 }}>{RECRUITER_SEAT_UNIT}</small></h2>
              <p>Add teammates to your employer account as your hiring team grows.</p>
            </article>
          </section>

          <section style={{ margin: "40px 20px 8px" }}>
            <span className="figma-eyebrow purple">ODESSEUS LIVE</span>
          </section>
          <section className="figma-three-grid compact">
            {LIVE_PLANS.map((plan) => (
              <article className="figma-price-card" key={plan.name}>
                <strong>{plan.priceLabel}</strong>
                <p>{plan.name} {plan.unit}</p>
              </article>
            ))}
          </section>

          <p className="figma-price-note">Localized market pricing can be shown based on account or billing region.</p>
          <Link className="figma-text-cta" href="/signup">Get Started →</Link>
        </div>
        <MarketingFooter />
      </main>

      <MobileScreen index="30" title="Pricing" lead="Pay for what you use. Prep is free." minHeight={1840}>
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
              <strong>Interview preparation · Free</strong>
              <small>Role-based questions, STAR stories and technical prep</small>
            </span>
          </div>
        </div>

        <p className="m-eyebrow" style={{ margin: "20px 4px 8px" }}>EMPLOYER</p>
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
              <strong>Additional seat · {RECRUITER_SEAT_PRICE_LABEL}/mo</strong>
              <small>Add teammates as your hiring team grows</small>
            </span>
          </div>
        </div>

        <p className="m-eyebrow" style={{ margin: "20px 4px 8px" }}>ODESSEUS LIVE</p>
        <div className="m-list">
          {LIVE_PLANS.map((plan) => (
            <div className="m-card" key={plan.name}>
              <span className="m-copy">
                <strong>{plan.name} · {plan.priceLabel}</strong>
                <small>{plan.unit.replace(/^\//, "").trim() || "one pass per session"}</small>
              </span>
            </div>
          ))}
        </div>

        <div className="m-card" style={{ marginTop: 20 }}>
          <span className="m-copy">
            <strong>Application tracking · Included</strong>
            <small>Tracked with every account</small>
          </span>
        </div>

        <p className="m-note">Localized market pricing can be shown based on account or billing region.</p>
        <Link className="m-action" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/signup">Get Started →</Link>
      </MobileScreen>
    </>
  );
}
