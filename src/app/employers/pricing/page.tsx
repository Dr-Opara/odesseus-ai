import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import MarketingFooter from "@/components/marketing-footer";

const plans = [
  { name:"Starter", price:"$79", jobs:"3 active job posts", copy:"For small teams making focused hires.", features:["Applicant pipeline","Employer dashboard","Global job posting"], cta:"Start with Starter" },
  { name:"Growth", price:"$149", jobs:"10 active job posts", copy:"For growing teams hiring across several roles.", features:["Everything in Starter","Basic analytics","More active hiring capacity"], cta:"Choose Growth", featured:true },
  { name:"Business", price:"$299", jobs:"25 active job posts", copy:"For companies running a larger recruiting pipeline.", features:["AI candidate matching","Multiple recruiter seats","Employer analytics"], cta:"Choose Business" },
];

const addOns = [
  { name:"Featured Job", term:"7 days", price:"$29", copy:"Give one priority opening additional visibility." },
  { name:"Featured Job", term:"14 days", price:"$49", copy:"Keep a priority opening featured for two weeks." },
  { name:"AI Featured Job", term:"30 days", price:"$129", copy:"Target high-match candidates with recommendations, alerts, matching and performance analytics." },
  { name:"Recruiter seat", term:"monthly", price:"$20", copy:"Add another recruiter to your hiring workspace." },
];

export default function EmployerPricingPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-page-hero inverse employer-pricing-hero">
          <span className="figma-eyebrow">EMPLOYER PRICING</span>
          <h1>Choose hiring capacity. Add reach when you need it.</h1>
          <p>Three straightforward monthly plans for active jobs, with optional featured placement for the roles you want to move faster.</p>
        </section>

        <section className="figma-three-grid employer-plan-grid">
          {plans.map((plan) => (
            <article className={`figma-info-card employer-plan-card ${plan.featured ? "employer-plan-featured" : "white"}`} key={plan.name}>
              {plan.featured ? <span className="pricing-popular">GROWING TEAMS</span> : null}
              <span className="figma-eyebrow">{plan.name.toUpperCase()}</span>
              <div className="employer-plan-price"><strong>{plan.price}</strong><span>/ month</span></div>
              <h2>{plan.jobs}</h2>
              <p>{plan.copy}</p>
              <div className="pricing-feature-list">{plan.features.map((feature)=><span key={feature}>✓ {feature}</span>)}</div>
              <Link className="figma-btn figma-btn-orange" href="/employers/signup">{plan.cta}</Link>
            </article>
          ))}
        </section>

        <section className="employer-addon-section">
          <div className="pricing-section-heading inverse-copy">
            <div><span className="figma-eyebrow">FEATURED ADD-ONS</span><h2>Put extra reach behind priority roles.</h2></div>
            <p>Add-ons are optional. Keep your base plan predictable and promote only the jobs that need more visibility or AI-assisted distribution.</p>
          </div>
          <div className="employer-addon-grid">
            {addOns.map((addOn)=>(
              <article className="employer-addon-card" key={`${addOn.name}-${addOn.term}`}>
                <div><span className="figma-eyebrow">{addOn.term.toUpperCase()}</span><h3>{addOn.name}</h3><p>{addOn.copy}</p></div>
                <strong>{addOn.price}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="employer-pricing-cta">
          <div><span className="figma-eyebrow">READY TO HIRE?</span><h2>Start with 3 active jobs for $79/month.</h2><p>Upgrade as your hiring volume grows.</p></div>
          <Link className="figma-btn figma-btn-orange" href="/employers/signup">Create employer account</Link>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
