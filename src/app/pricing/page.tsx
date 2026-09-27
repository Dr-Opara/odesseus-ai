import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const candidateOptions = [
  {
    name: "Apply",
    price: "$0.39",
    detail: "per successful application",
    description: "Use your approved existing resume and verified profile. Odesseus completes the application without rewriting your resume.",
    bullets: ["Existing approved resume", "Verified profile answers", "Automated submission", "Tracking included", "Charged only after success"],
  },
  {
    name: "Smart Apply",
    price: "$0.99",
    detail: "per successful application",
    description: "For roles where you want Odesseus to optimize the application before it submits.",
    bullets: ["Analyze the job description", "Select your best existing resume", "Optimize it for the role", "Generate application answers", "Create a cover letter when required", "Submit and track"],
    featured: true,
  },
];

export default function PricingPage() {
  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <MarketingNav />
        <section className="figma-page-hero pricing-hero">
          <span className="figma-eyebrow">CANDIDATE PRICING</span>
          <h1>Pay when Odesseus successfully applies.</h1>
          <p>Find jobs, see your Match Score, and prepare for interviews without an application subscription. Pay only when Odesseus successfully submits an application.</p>
          <div className="pricing-wallet-callout">
            <div><span className="figma-eyebrow">ODESSEUS WALLET</span><h3>Fund once. Apply for 39¢ or Smart Apply for 99¢.</h3></div>
            <p>Your wallet funds application activity without a separate card transaction for every submission. Failed applications do not consume the application price.</p>
          </div>
        </section>

        <section className="figma-two-grid pricing-choice-grid">
          {candidateOptions.map((option) => (
            <article className={`figma-price-card pricing-choice-card ${option.featured ? "lavender pricing-featured" : ""}`} key={option.name}>
              {option.featured ? <span className="pricing-popular">MORE AI HELP</span> : null}
              <span className="figma-eyebrow">{option.name.toUpperCase()}</span>
              <strong>{option.price}</strong>
              <p className="pricing-detail">{option.detail}</p>
              <p>{option.description}</p>
              <div className="pricing-feature-list">
                {option.bullets.map((bullet) => <span key={bullet}>✓ {bullet}</span>)}
              </div>
              <Link className={`figma-btn ${option.featured ? "figma-btn-orange" : "pricing-outline-btn"}`} href="/signup">Choose {option.name}</Link>
            </article>
          ))}
        </section>

        <section className="pricing-live-section od-public-value-section">
          <div className="pricing-section-heading">
            <div><span className="figma-eyebrow">INCLUDED AROUND THE APPLICATION</span><h2>More than a submission button.</h2></div>
            <p>Odesseus keeps the job, resume version, application answers, status, and interview preparation connected in one workflow.</p>
          </div>
          <div className="figma-three-grid compact pricing-live-grid">
            <article className="figma-price-card"><span className="figma-eyebrow">MATCH</span><strong>Free</strong><p>Understand fit before you apply.</p></article>
            <article className="figma-price-card"><span className="figma-eyebrow">TRACK</span><strong>Free</strong><p>Keep applications and next steps organized.</p></article>
            <article className="figma-price-card"><span className="figma-eyebrow">PREPARE</span><strong>Free</strong><p>Prepare when interviews arrive.</p></article>
          </div>
        </section>

        <section className="od-pricing-earn">
          <div>
            <span className="figma-eyebrow">EARN WITH ODESSEUS</span>
            <h2>Your job search can pay you back.</h2>
            <p>Eligible annual members can share premium interview access with up to 10 unique friends and earn from guest sessions.</p>
          </div>
          <Link className="figma-btn figma-btn-orange" href="/earn">See how earning works</Link>
        </section>

        <section className="pricing-bottom-cta">
          <div><span className="figma-eyebrow">START FREE</span><h2>Upload the resume you already have and let Odesseus work from there.</h2><p>No resume builder. No invented experience. Odesseus optimizes your existing resume for the roles you choose.</p></div>
          <Link className="figma-btn figma-btn-orange" href="/signup">Get Started</Link>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
