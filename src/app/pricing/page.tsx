import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Pricing — Odysseus",
  description: "No subscription. Pay when Odysseus works for you. $0.99 per successful application, $24.99 per live interview, with savings bundles available.",
};

const applyFeatures = [
  "Job Match & Hard-Requirement Check",
  "Job-Specific Resume Tailoring",
  "Cover Letter When Needed",
  "Applications Across Supported Job Boards & Employer Sites",
  "AI Form Completion + Saved Answers",
  "Resume & Document Upload",
  "Human Takeover for CAPTCHA/MFA/Verification",
  "Successful Submission + Tracking",
  "Complete Application Memory",
];

const liveFeatures = [
  "Free Preparation",
  "Realtime Transcription",
  "Question Detection",
  "Live Guidance",
  "STAR / Shorter / Technical",
  "Transcript",
  "Analysis",
  "Round Memory",
  "Follow-Up",
];

const interviewPassFeatures = [
  "Free Interview Preparation",
  "Exact Resume, Job & Application Context",
  "Previous-Round Interview Memory",
  "Realtime Transcription + Question Detection",
  "Context-Aware Live Guidance",
  "STAR / Shorter / Technical / Follow-Up",
  "Full Interview Transcript",
  "Post-Interview Analysis",
  "Next-Round Memory & Preparation",
  "Contextual Follow-Up Email",
];

const freeFeatures = [
  "Candidate Profile",
  "Job Discovery & Match Scoring",
  "Application Dashboard",
  "Interview Workspace",
  "Interview Preparation",
];

export default function PricingPage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell page-hero" style={{ textAlign: "center", maxWidth: 700, margin: "0 auto" }}>
        <h1 className="font-display page-hero-headline">No subscription. Pay when Odysseus works for you.</h1>
      </section>

      <section className="shell" style={{ padding: "10px 0 20px" }}>
        <div className="pricing-section-heading">
          <p className="pricing-section-eyebrow">Pay As You Go</p>
        </div>

        <div className="pricing-full-grid">
          <div className="card pricing-full-card">
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.05em" }}>$0.99</div>
            <h2 style={{ fontSize: 24, margin: "10px 0 6px" }}>Apply with Odysseus</h2>
            <p className="muted" style={{ margin: 0 }}>Charged only after successful submission.</p>
            <div className="pricing-feature-list">
              {applyFeatures.map((feature) => (
                <div className="pricing-feature-item" key={feature}>
                  <span className="pricing-feature-check">✓</span> {feature}
                </div>
              ))}
            </div>
            <Link className="btn btn-primary" href="/apply" style={{ marginTop: 24 }}>
              Learn more about Apply →
            </Link>
          </div>

          <div className="card pricing-full-card">
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.05em" }}>$24.99</div>
            <h2 style={{ fontSize: 24, margin: "10px 0 6px" }}>Odysseus Live</h2>
            <p className="muted" style={{ margin: 0 }}>One complete live interview round.</p>
            <div className="pricing-feature-list">
              {liveFeatures.map((feature) => (
                <div className="pricing-feature-item" key={feature}>
                  <span className="pricing-feature-check">✓</span> {feature}
                </div>
              ))}
            </div>
            <Link className="btn btn-primary" href="/live" style={{ marginTop: 24 }}>
              Learn more about Live →
            </Link>
          </div>
        </div>
      </section>

      <section className="shell pricing-section">
        <div className="pricing-section-heading">
          <p className="pricing-section-eyebrow">Bundle & Save</p>
          <h2 className="pricing-section-title">Save with Application Credits</h2>
          <p className="pricing-section-note">1 application credit = 1 successfully submitted application.</p>
        </div>

        <div className="card bundle-band">
          <div className="bundle-row">
            <div className="bundle-option">
              <div className="bundle-option-quantity">25 credits</div>
              <div className="bundle-option-price">$20</div>
              <Link className="btn btn-secondary" href="/signup">Get Started →</Link>
            </div>
            <div className="bundle-option is-featured">
              <div className="bundle-option-quantity">50 credits</div>
              <div className="bundle-option-price">$35</div>
              <Link className="btn btn-primary" href="/signup">Get Started →</Link>
            </div>
            <div className="bundle-option">
              <div className="bundle-option-quantity">100 credits</div>
              <div className="bundle-option-price">$59</div>
              <Link className="btn btn-secondary" href="/signup">Get Started →</Link>
            </div>
          </div>

          <div className="pricing-feature-list" style={{ marginTop: 26 }}>
            {applyFeatures.map((feature) => (
              <div className="pricing-feature-item" key={feature}>
                <span className="pricing-feature-check">✓</span> {feature}
              </div>
            ))}
          </div>
          <p className="bundle-fine-print">
            Same billing guarantees as pay-as-you-go: a successful submission consumes 1 credit. Failed, unsupported, cancelled, and closed-role applications, and submissions that cannot be confirmed, consume 0. Credits only change the price — every credit includes the full Apply with Odysseus workflow.
          </p>
        </div>
      </section>

      <section className="shell pricing-section">
        <div className="pricing-section-heading">
          <p className="pricing-section-eyebrow">Bundle & Save</p>
          <h2 className="pricing-section-title">Interview Passes</h2>
          <p className="pricing-section-note">1 interview pass = 1 successfully activated Odysseus Live interview round.</p>
        </div>

        <div className="card bundle-band">
          <div className="bundle-row bundle-row-2">
            <div className="bundle-option">
              <div className="bundle-option-quantity">3 Odysseus Live Passes</div>
              <div className="bundle-option-price">$59.99</div>
              <Link className="btn btn-secondary" href="/signup">Get Started →</Link>
            </div>
            <div className="bundle-option is-featured">
              <div className="bundle-option-quantity">Odysseus Live Annual</div>
              <div className="bundle-option-price">$499</div>
              <div className="bundle-option-unit">per year</div>
              <Link className="btn btn-primary" href="/signup">Get Started →</Link>
            </div>
          </div>

          <div className="pricing-feature-list" style={{ marginTop: 26 }}>
            {interviewPassFeatures.map((feature) => (
              <div className="pricing-feature-item" key={feature}>
                <span className="pricing-feature-check">✓</span> {feature}
              </div>
            ))}
          </div>

          <p className="pricing-flow-chain" style={{ marginTop: 18 }}>
            Odysseus Live Annual: Prepare → Live Guidance → Transcript → Analysis → Follow-Up
          </p>
          <p className="bundle-fine-print">
            Unlimited Odysseus Live interviews for 12 months, subject to fair use. A failed Live activation never consumes a pass or counts against the annual plan.
          </p>
        </div>
      </section>

      <section className="shell pricing-section" style={{ paddingBottom: 20 }}>
        <div className="pricing-section-heading">
          <p className="pricing-section-eyebrow">Included</p>
          <h2 className="pricing-section-title">Free with Odysseus</h2>
          <p className="pricing-section-note">No subscription.</p>
        </div>

        <div className="card free-features-band">
          <div className="free-features-grid">
            {freeFeatures.map((feature) => (
              <div className="pricing-feature-item" key={feature}>
                <span className="pricing-feature-check">✓</span> {feature}
              </div>
            ))}
          </div>
        </div>

        <div className="page-cta-band card">
          <div>
            <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>Ready to start?</h2>
            <p className="muted" style={{ margin: 0 }}>No subscription. Pay only when Odysseus works for you.</p>
          </div>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
