import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const candidateOptions = [
  {
    name: "Apply",
    price: "$0.49",
    detail: "per successful application",
    description: "Use your existing resume and verified profile to complete and submit the application.",
  },
  {
    name: "Smart Apply",
    price: "$1.99",
    detail: "per successful application",
    description: "Analyzes the job description, selects your best resume, customizes it, generates answers, and submits the application.",
    featured: true,
  },
];

const liveOptions = [
  ["1 Live session", "$24.99"],
  ["3 Live passes", "$59.99"],
  ["Live Annual", "$499/year"],
];

export default function PricingPage() {
  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <MarketingNav />
        <section className="figma-page-hero">
          <span className="figma-eyebrow">PRICING</span>
          <h1>Pay for the help you want.</h1>
          <p>Start with a low-cost application or choose Smart Apply when you want Odesseus to optimize the application for the role.</p>
        </section>

        <section className="figma-two-grid">
          {candidateOptions.map((option) => (
            <article className={`figma-price-card ${option.featured ? "lavender" : ""}`} key={option.name}>
              <span className="figma-eyebrow">{option.name.toUpperCase()}</span>
              <strong>{option.price}</strong>
              <p>{option.detail}</p>
              <p>{option.description}</p>
            </article>
          ))}
        </section>

        <section style={{ paddingTop: 28 }}>
          <span className="figma-eyebrow">ODESSEUS LIVE</span>
          <h2>Real-time conversational interview guidance.</h2>
          <p>Odesseus Live listens for interview questions and displays suggested answers and talking points on screen. Coding interview assistance is not included.</p>
          <div className="figma-three-grid compact">
            {liveOptions.map(([name, price]) => (
              <article className="figma-price-card" key={name}>
                <strong>{price}</strong>
                <p>{name}</p>
              </article>
            ))}
          </div>
        </section>

        <p className="figma-price-note">Localized market pricing can be shown based on account or billing region.</p>
        <Link className="figma-text-cta" href="/signup">Get Started →</Link>
      </div>
      <MarketingFooter />
    </main>
  );
}
