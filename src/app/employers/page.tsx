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
          <div className="figma-section-heading"><span className="figma-eyebrow">AI STARTER BUNDLE</span><h2>$100 every 30 days</h2><p>5 job-post credits included.</p></div>
          <Link className="figma-btn figma-btn-orange" href="/employers/pricing">See Employer Pricing</Link>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
