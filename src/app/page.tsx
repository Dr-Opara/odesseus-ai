import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const platforms = [
  "Workday",
  "Indeed",
  "Greenhouse",
  "Lever",
  "Ashby",
  "iCIMS",
  "UN Careers",
  "Direct Company Career Sites",
];

const activityMoments = [
  "Found 6 strong matches",
  "Resume tailored",
  "Waiting for your approval",
  "Application submitted ✓",
  "Interview detected",
];

const howItWorks = [
  {
    n: "01",
    title: "Build Your Profile",
    body: "Upload your resume once. Odysseus learns your verified experience, skills, education, certifications, and preferences.",
    pills: [],
  },
  {
    n: "02",
    title: "Find Your Matches",
    body: "Odysseus finds relevant opportunities and explains why they fit.",
    pills: ["85%+ Match", "Hard Requirements Checked", "No Fabricated Qualifications"],
  },
  {
    n: "03",
    title: "Review & Apply",
    body: "Odysseus tailors the resume and prepares the application for approval.",
    pills: ["ATS-Ready Resume", "Cover Letter When Needed", "Cross-Platform Applications", "$0.99 Only After Successful Submission"],
  },
  {
    n: "04",
    title: "Interview",
    body: "Employer responses flow into the Interview Workspace.",
    pills: ["Free Interview Preparation", "Odysseus Live", "Multi-Round Memory", "Post-Interview Follow-Up"],
  },
];

export default function Home() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell hero-section">
        <div>
          <div className="badge">A more connected way to move your career forward</div>
          <h1 className="font-display hero-headline">Your next move, handled.</h1>
          <p className="muted hero-copy">
            Odysseus finds strong-match jobs, tailors your resume, applies across supported platforms, and tracks every application — then prepares you for the interview and stays with you live when it begins.
          </p>
          <div className="hero-ctas">
            <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
            <Link className="btn btn-secondary" href="/how-it-works">See How It Works</Link>
          </div>
        </div>

        <div className="card agent-visual">
          <div className="agent-visual-score">94% Match</div>
          <div className="agent-visual-role">Senior Compliance Analyst</div>
          <div className="muted" style={{ marginTop: 2 }}>Remote</div>

          <div className="agent-visual-status">
            <span className="agent-visual-dot" />
            <span>Odysseus Agent — Active</span>
          </div>

          <div className="agent-visual-steps">
            <div className="agent-visual-step">
              <span className="agent-visual-check">✓</span> Strong match found
            </div>
            <div className="agent-visual-step">
              <span className="agent-visual-check">✓</span> Resume tailored
            </div>
            <div className="agent-visual-step">
              <span className="agent-visual-check">✓</span> Cover letter prepared
            </div>
            <div className="agent-visual-step">
              <span className="agent-visual-check">✓</span> Application approved
            </div>
            <div className="agent-visual-step active-step">
              <span>→</span> Applying on Workday...
            </div>
          </div>
        </div>
      </section>

      <section className="shell platform-strip-section">
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <h2 className="font-display" style={{ fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>
            Apply wherever the opportunity lives
          </h2>
          <p className="muted" style={{ marginTop: 10 }}>
            One Odysseus. Across supported job boards and employer career sites.
          </p>
        </div>
        <div className="platform-strip-track-wrap">
          <div className="platform-strip-track">
            {[...platforms, ...platforms].map((platform, index) => (
              <span className="platform-strip-item" key={`${platform}-${index}`}>{platform}</span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 26 }}>
          <Link className="btn btn-secondary" href="/apply">See supported platforms →</Link>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 30px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <p className="muted" style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".12em" }}>
            How Odysseus Works
          </p>
          <h2 className="font-display" style={{ fontSize: 40, letterSpacing: "-0.02em", margin: "10px 0" }}>
            One connected flow, start to offer.
          </h2>
        </div>

        <div className="how-it-works-grid">
          {howItWorks.map((step) => (
            <div className="card how-it-works-card" key={step.n}>
              <div className="how-it-works-number">{step.n}</div>
              <h3 style={{ fontSize: 21, margin: "16px 0 8px" }}>{step.title}</h3>
              <p className="muted" style={{ lineHeight: 1.55, margin: 0 }}>{step.body}</p>
              {step.pills.length ? (
                <div className="how-it-works-pills">
                  {step.pills.map((pill) => (
                    <span className="how-it-works-pill" key={pill}>{pill}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 30 }}>
          <Link className="btn btn-secondary" href="/how-it-works">See the full lifecycle →</Link>
        </div>
      </section>

      <section className="shell activity-strip-section">
        <div className="activity-strip">
          {activityMoments.map((moment) => (
            <span className="activity-chip" key={moment}>{moment}</span>
          ))}
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 20px" }}>
        <div className="page-cta-band card">
          <div>
            <div className="badge">$0.99 · Apply with Odysseus</div>
            <h2 style={{ fontSize: 26, margin: "14px 0 8px" }}>Apply anywhere your next opportunity lives.</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 520 }}>
              Odysseus matches the role, tailors your resume, completes the application, and tracks it — charged only after a successful submission.
            </p>
          </div>
          <Link className="btn btn-primary" href="/apply">Explore Apply →</Link>
        </div>
      </section>

      <section className="shell" style={{ padding: "0 0 20px" }}>
        <div className="page-cta-band card">
          <div>
            <div className="badge">$24.99 · Odysseus Live</div>
            <h2 style={{ fontSize: 26, margin: "14px 0 8px" }}>Go into your interview with your entire application behind you.</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 520 }}>
              Free preparation, private real-time guidance, and a complete post-interview recap — one pass, everything included.
            </p>
          </div>
          <Link className="btn btn-primary" href="/live">Explore Live →</Link>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 110px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <p className="muted" style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".12em" }}>
            Pricing
          </p>
          <h2 className="font-display" style={{ fontSize: 40, letterSpacing: "-0.02em", margin: "10px 0" }}>
            No subscription. Pay when Odysseus works for you.
          </h2>
        </div>

        <div className="pricing-preview-grid">
          <div className="card" style={{ padding: 28 }}>
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.05em" }}>$0.99</div>
            <h3 style={{ fontSize: 22, margin: "10px 0 4px" }}>Apply with Odysseus</h3>
            <p className="pricing-flow-chain">Match → Tailor → Apply → Track</p>
            <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
              Charged only after successful submission.
            </p>
          </div>
          <div className="card" style={{ padding: 28 }}>
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.05em" }}>$24.99</div>
            <h3 style={{ fontSize: 22, margin: "10px 0 4px" }}>Odysseus Live</h3>
            <p className="pricing-flow-chain">Prepare → Live Guidance → Transcript → Analysis → Follow-Up</p>
            <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
              One interview. One pass. Everything included.
            </p>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 30 }}>
          <Link className="btn btn-secondary" href="/pricing">See full pricing →</Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
