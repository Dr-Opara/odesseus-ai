import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const candidateOptions = [
  {
    name: "Apply",
    price: "$0.49",
    detail: "per successful application",
    description: "Use your approved master resume and verified profile. Odesseus completes the application without rewriting your resume.",
    bullets: ["Existing approved resume", "Verified profile answers", "Automated submission", "Charged only after success"],
  },
  {
    name: "Smart Apply",
    price: "$1.99",
    detail: "per successful application",
    description: "For roles where you want Odesseus to optimize the application before it submits.",
    bullets: ["Analyze the job description", "Select your best resume", "Customize the resume", "Generate application answers", "Submit the application"],
    featured: true,
  },
];

const liveOptions = [
  { name: "1 Live session", price: "$24.99", detail: "One interview" },
  { name: "3 Live passes", price: "$59.99", detail: "Three interview sessions" },
  { name: "Live Annual", price: "$499", detail: "12 months · fair use" },
];

export default function PricingPage() {
  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <MarketingNav />
        <section className="figma-page-hero pricing-hero">
          <span className="figma-eyebrow">SIMPLE PRICING</span>
          <h1>Pay when Odesseus makes progress.</h1>
          <p>Use Apply for fast submissions with your existing resume. Choose Smart Apply when the role deserves a tailored application. No candidate subscription required.</p>
          <div className="pricing-wallet-callout">
            <div><span className="figma-eyebrow">ODESSEUS WALLET</span><h3>Fund once. Apply for 49¢ or $1.99.</h3></div>
            <p>Add $10, $20, or $50 to your wallet. Odesseus deducts the application price only after a successful submission — not when the browser starts.</p>
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

        <section className="pricing-live-section">
          <div className="pricing-section-heading">
            <div><span className="figma-eyebrow">ODESSEUS LIVE</span><h2>Interview help when the conversation starts.</h2></div>
            <p>Real-time conversational guidance that listens for interview questions and displays suggested answers and talking points. Coding interview assistance is not included.</p>
          </div>
          <div className="figma-three-grid compact pricing-live-grid">
            {liveOptions.map((option) => (
              <article className="figma-price-card" key={option.name}>
                <span className="figma-eyebrow">{option.name.toUpperCase()}</span>
                <strong>{option.price}</strong>
                <p>{option.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing-bottom-cta">
          <div><span className="figma-eyebrow">START SMALL</span><h2>Your wallet balance stays yours until Odesseus submits successfully.</h2><p>Localized market pricing may be shown based on account or billing region.</p></div>
          <Link className="figma-btn figma-btn-orange" href="/signup">Get Started</Link>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
