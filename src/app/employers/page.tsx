import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export default function EmployersPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <MarketingNav inverse />

        <section className="figma-page-hero inverse">
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Hire with a clearer view of every candidate.</h1>
          <p>Post roles, review applicants and manage your pipeline from one workspace.</p>
          <div className="figma-hero-actions">
            <Link className="figma-btn figma-btn-orange" href="/signup">Start Hiring</Link>
            <Link className="figma-text-cta is-inverse" href="#pricing">See Employer Pricing →</Link>
          </div>
        </section>

        <section className="figma-three-grid">
          <article className="figma-info-card white">
            <h2>Verified company setup</h2>
            <p>Layered verification helps protect job seekers and the platform.</p>
          </article>
          <article className="figma-info-card peach">
            <h2>AI-assisted matching</h2>
            <p>Surface relevant applicants using structured role and candidate context.</p>
          </article>
          <article className="figma-info-card cyan">
            <h2>Hiring pipeline</h2>
            <p>Move applicants from new to review, interview, offer and hired.</p>
          </article>
        </section>

        <section id="pricing" className="figma-pricing-section">
          <div className="figma-section-heading">
            <span className="figma-eyebrow">EMPLOYER PRICING</span>
            <h2>Simple Pricing</h2>
            <p>Transparent, credit-based pricing built for teams hiring at any scale.</p>
          </div>

          <div className="figma-two-grid employer-prices">
            <article className="figma-info-card lavender">
              <span className="figma-eyebrow">AI STARTER BUNDLE</span>
              <h2>$100 every 30 days</h2>
              <p>Includes 5 base job-post credits.</p>
            </article>
            <article className="figma-info-card white">
              <span className="figma-eyebrow">ADDITIONAL POSTS</span>
              <h2>$10 each</h2>
              <p>Active subscribers can purchase extra job-post credits.</p>
            </article>
          </div>

          <div className="figma-pricing-cta">
            <Link className="figma-btn figma-btn-orange" href="/signup">Start Hiring</Link>
          </div>
        </section>
      </div>

      <MarketingFooter />
    </main>
  );
}
