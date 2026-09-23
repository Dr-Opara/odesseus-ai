import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import MarketingFooter from "@/components/marketing-footer";

export default function EmployerPricingPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-page-hero inverse" style={{ minHeight: 0 }}>
          <span className="figma-eyebrow">EMPLOYER PRICING</span>
          <h1>One plan. Predictable pricing. No surprises.</h1>
          <p>Pricing shown in your local currency, determined by your company’s billing country.</p>
        </section>

        <section className="figma-two-grid employer-prices" style={{ paddingBottom: 40 }}>
          <article className="figma-info-card lavender">
            <span className="figma-eyebrow">AI STARTER BUNDLE</span>
            <h2>$100 <small>/ 30 days</small></h2>
            <p>✓ 5 job-post credits</p>
            <p>✓ AI candidate matching</p>
            <p>✓ Applicant pipeline</p>
            <p>✓ Employer dashboard</p>
            <p>✓ Global job posting capability</p>
            <p>✓ Verified employer experience</p>
            <Link className="figma-btn figma-btn-orange" href="/employers/signup">Start Hiring</Link>
          </article>
          <article className="figma-info-card white">
            <h2>How credits work</h2>
            <p><strong>Base Credits</strong><br />5 per 30-day billing cycle. Unused base credits expire at the end of the cycle.</p>
            <p><strong>Additional Posts</strong><br />$10 each for active subscribers. Each add-on credit has its own 30-day expiration.</p>
            <p><strong>Published jobs stay live for 30 days</strong><br />Publishing a job starts its own 30-day live-listing clock.</p>
          </article>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
