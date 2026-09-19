import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Apply with Odysseus — $0.99 per successful application",
  description: "Odysseus matches the role, tailors your resume, completes the application, and tracks it — $0.99 only after a successful submission.",
};

const platforms = [
  "Workday",
  "Indeed",
  "UN Careers / UN job portals",
  "Greenhouse",
  "Lever",
  "Ashby",
  "iCIMS",
  "Direct company career websites",
  "Corporate ATS portals",
  "Other supported job boards and employer sites",
];

const stages = [
  {
    label: "Match",
    title: "Odysseus checks fit before anything else.",
    items: ["Match score", "Hard requirements", "Skills/experience alignment"],
  },
  {
    label: "Tailor",
    title: "Your resume, adjusted for this exact role.",
    items: ["Job-specific resume", "ATS optimization", "Cover letter when needed", "Verified facts only"],
  },
  {
    label: "Review",
    title: "You approve everything before it moves forward.",
    items: ["See changes", "Edit", "Regenerate", "Approve", "Reject job"],
  },
  {
    label: "Apply",
    title: "Odysseus completes the application itself.",
    items: ["Forms", "Work history", "Education", "Certifications", "Saved answers", "Authorization", "Sponsorship", "Salary", "Availability", "Document upload"],
  },
  {
    label: "Human Takeover",
    title: "Some steps are yours by design.",
    items: ["CAPTCHA", "MFA", "Identity verification", "Email verification", "Unknown/sensitive questions"],
  },
  {
    label: "Track",
    title: "Every submission becomes a permanent record.",
    items: ["Successful submission", "Application status", "Timeline", "Frozen resume", "Frozen job description", "Answers/application history"],
  },
];

const billingRules = [
  { label: "Successful submission", amount: "$0.99", charge: true },
  { label: "Unsupported", amount: "$0", charge: false },
  { label: "Failed", amount: "$0", charge: false },
  { label: "Cancelled", amount: "$0", charge: false },
  { label: "Closed role", amount: "$0", charge: false },
  { label: "Unconfirmed submission", amount: "$0", charge: false },
];

export default function ApplyPage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell page-hero">
        <div className="badge">$0.99 · Apply with Odysseus</div>
        <h1 className="font-display page-hero-headline">Apply anywhere your next opportunity lives.</h1>
        <p className="muted page-hero-copy">
          Odysseus matches the role, tailors your resume, completes the application, and tracks it—all for $0.99 after a successful submission.
        </p>
        <div className="hero-ctas" style={{ marginTop: 26 }}>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
          <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            $0.99 only after successful submission
          </span>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 50px" }}>
        <div className="card" style={{ padding: 30 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>Cross-platform coverage</h2>
          <p className="muted" style={{ margin: "0 0 4px", maxWidth: 620 }}>
            Odysseus applies across supported job boards and employer career sites — at the same $0.99 price, regardless of platform.
          </p>
          <div className="platform-coverage-grid">
            {platforms.map((platform) => (
              <div className="platform-coverage-item" key={platform}>{platform}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 20px" }}>
        {stages.map((stage) => (
          <div className="card stage-band" key={stage.label}>
            <span className="stage-band-label">{stage.label}</span>
            <h2 style={{ fontSize: 22, margin: "16px 0 4px" }}>{stage.title}</h2>
            <div className="stage-band-list">
              {stage.items.map((item) => (
                <div className="stage-band-list-item" key={item}>{item}</div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="shell" style={{ padding: "10px 0 100px" }}>
        <div className="card" style={{ padding: 30 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 4px" }}>Billing rule</h2>
          <p className="muted" style={{ margin: "0 0 4px" }}>
            You are only charged when Odysseus successfully completes the work.
          </p>
          <div className="billing-rule-grid">
            {billingRules.map((rule) => (
              <div className={`billing-rule-item${rule.charge ? " is-charge" : ""}`} key={rule.label}>
                <span>{rule.label}</span>
                <span className="billing-rule-amount">{rule.amount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="page-cta-band card">
          <div>
            <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>Ready to apply?</h2>
            <p className="muted" style={{ margin: 0 }}>Upload your resume and see your first matches.</p>
          </div>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
