import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import MarketingFooter from "@/components/marketing-footer";

export default function EmployersPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-page-hero inverse">
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Find candidates who already fit the role.</h1>
          <p>Post your opportunity. Let Odesseus AI surface qualified applicants across global markets — so you spend less time sorting resumes.</p>
          <div className="figma-hero-actions">
            <Link className="figma-btn figma-btn-orange" href="/employers/post-job">Post a Job</Link>
            <Link className="figma-text-cta is-inverse" href="/employers/pricing">See Employer Pricing →</Link>
          </div>
        </section>
        <section className="figma-three-grid">
          <article className="figma-info-card white"><h2>Global Reach</h2><p>Reach qualified candidates across North America, Europe, Africa, Asia and beyond.</p></article>
          <article className="figma-info-card peach"><h2>AI Matching</h2><p>Odesseus surfaces candidates who already fit the role — ranked, not just filtered.</p></article>
          <article className="figma-info-card cyan"><h2>Verified Employers</h2><p>Layered company verification keeps the platform trustworthy for every candidate.</p></article>
        </section>
        <section className="figma-pricing-section">
          <div className="figma-section-heading"><span className="figma-eyebrow">POST. MATCH. HIRE.</span><h2>Everything you need to hire well</h2></div>
          <div className="figma-three-grid">
            <article className="figma-info-card white"><h2>1 · Post your opportunity</h2><p>Publish role details, location, salary and work arrangement in minutes.</p></article>
            <article className="figma-info-card lavender"><h2>2 · Odesseus surfaces matches</h2><p>AI ranks candidates by fit — skills, experience and location alignment.</p></article>
            <article className="figma-info-card cyan"><h2>3 · Review and hire</h2><p>Review applicants, shortlist strong matches, and move forward with confidence.</p></article>
          </div>
        </section>
        <section id="pricing" className="figma-pricing-section">
          <div className="figma-section-heading">
            <span className="figma-eyebrow">EMPLOYER PLANS</span>
            <h2>Start at $79/month.</h2>
            <p>3 active jobs on Starter, 10 on Growth, or 25 on Business — then add featured reach only when you need it.</p>
          </div>
          <div className="figma-three-grid">
            <article className="figma-info-card white"><span className="figma-eyebrow">STARTER</span><h2>$79 / month</h2><p><strong>3 active jobs</strong></p></article>
            <article className="figma-info-card lavender"><span className="figma-eyebrow">GROWTH</span><h2>$149 / month</h2><p><strong>10 active jobs</strong> + basic analytics</p></article>
            <article className="figma-info-card cyan"><span className="figma-eyebrow">BUSINESS</span><h2>$299 / month</h2><p><strong>25 active jobs</strong> + AI matching + multiple recruiter seats</p></article>
          </div>
          <Link className="figma-btn figma-btn-orange" href="/employers/pricing">See plans & featured add-ons</Link>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
