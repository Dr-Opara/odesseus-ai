import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import MarketingFooter from "@/components/marketing-footer";

const plans = [
  {
    name: "Starter",
    price: "$79",
    jobs: "3 active job posts",
    features: ["Applicant pipeline", "Employer dashboard", "Global job posting capability"],
  },
  {
    name: "Growth",
    price: "$149",
    jobs: "10 active job posts",
    features: ["Basic analytics", "Applicant pipeline", "Employer dashboard"],
  },
  {
    name: "Business",
    price: "$299",
    jobs: "25 active job posts",
    features: ["AI candidate matching", "Multiple recruiter seats", "Employer analytics"],
  },
];

const addOns = [
  ["Featured Job — 7 days", "$29"],
  ["Featured Job — 14 days", "$49"],
  ["AI Featured Job — 30 days", "$129"],
  ["Additional recruiter seat", "$20/month"],
];

export default function EmployerPricingPage() {
  return (
    <main className="figma-site figma-dark-page">
      <div className="figma-page-wrap">
        <EmployerNav inverse />
        <section className="figma-page-hero inverse" style={{ minHeight: 0 }}>
          <span className="figma-eyebrow">EMPLOYER PRICING</span>
          <h1>Start small. Add reach when you need it.</h1>
          <p>Choose the hiring capacity you need, then feature the roles that need more visibility.</p>
        </section>

        <section className="figma-three-grid" style={{ paddingBottom: 32 }}>
          {plans.map((plan) => (
            <article className="figma-info-card white" key={plan.name}>
              <span className="figma-eyebrow">{plan.name.toUpperCase()}</span>
              <h2>{plan.price} <small>/ month</small></h2>
              <p><strong>{plan.jobs}</strong></p>
              {plan.features.map((feature) => <p key={feature}>✓ {feature}</p>)}
              <Link className="figma-btn figma-btn-orange" href="/employers/signup">Start Hiring</Link>
            </article>
          ))}
        </section>

        <section style={{ paddingBottom: 40 }}>
          <span className="figma-eyebrow">FEATURED ADD-ONS</span>
          <h2>Give priority roles more reach.</h2>
          <div className="figma-two-grid employer-prices">
            {addOns.map(([name, price]) => (
              <article className="figma-info-card lavender" key={name}>
                <h3>{name}</h3>
                <h2>{price}</h2>
              </article>
            ))}
          </div>
          <p>AI Featured adds targeted exposure to high-match candidates, AI candidate matching, recommended-job placement, candidate alerts, and performance analytics.</p>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
