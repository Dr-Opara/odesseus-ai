import Link from "next/link";

type Feature = {
  eyebrow: string;
  title: string;
  description: string;
  accent?: boolean;
  visual: "match" | "apply" | "resume" | "prep" | "track" | "live";
};

const features: Feature[] = [
  {
    eyebrow: "Job discovery + Match Score",
    title: "Find roles that actually fit you",
    description:
      "Odesseus brings matched roles into one place and explains why a job fits before you spend time applying.",
    visual: "match",
  },
  {
    eyebrow: "Smart Apply",
    title: "Let the Application Agent handle supported application steps",
    description:
      "Choose Apply or Smart Apply. Odesseus can complete supported application flows, pause when your input is required, and track the result.",
    visual: "apply",
  },
  {
    eyebrow: "Resume Optimization",
    title: "Tailor the resume you already have",
    description:
      "Optimize your existing resume for a specific role without inventing experience. Review the changes before you use them.",
    visual: "resume",
  },
  {
    eyebrow: "Interview Prep + Mock Interviews",
    title: "Practice before the real conversation",
    description:
      "Prepare with role-specific questions, mock interviews, feedback, and interview context built from the job and your application.",
    visual: "prep",
  },
  {
    eyebrow: "Application Tracking",
    title: "Keep every application and next step together",
    description:
      "See what you applied to, where each application stands, interview activity, and what needs your attention next.",
    visual: "track",
  },
  {
    eyebrow: "Interview Support",
    title: "Interview support — plus a way to earn while you search",
    description:
      "Get real-time, non-coding interview support and post-interview analysis. Eligible candidates can also participate in the earning program while continuing their job search.",
    accent: true,
    visual: "live",
  },
];

function FeatureVisual({ type }: { type: Feature["visual"] }) {
  if (type === "match") {
    return (
      <div className="oh-feature-ui oh-feature-ui-match" aria-hidden="true">
        <div className="oh-feature-score">92</div>
        <div className="oh-feature-ui-copy">
          <span>Senior Product Analyst</span>
          <strong>Strong match</strong>
          <small>Skills · Experience · Role fit</small>
        </div>
      </div>
    );
  }

  if (type === "apply") {
    return (
      <div className="oh-feature-ui oh-feature-ui-apply" aria-hidden="true">
        <div className="oh-feature-mini-card">
          <span>Product Operations Manager</span>
          <small>London · Hybrid</small>
        </div>
        <div className="oh-feature-status">✓ Smart Apply running</div>
        <div className="oh-feature-mini-card is-soft">
          <small>Next step</small>
          <span>Review one employer question</span>
        </div>
      </div>
    );
  }

  if (type === "resume") {
    return (
      <div className="oh-feature-ui oh-feature-ui-resume" aria-hidden="true">
        <div className="oh-feature-resume-paper">
          <strong>YOUR RESUME</strong>
          <span />
          <span />
          <span className="short" />
          <div className="oh-feature-resume-highlight">
            <small>Role-specific optimization</small>
            <b>Review suggested revision →</b>
          </div>
        </div>
      </div>
    );
  }

  if (type === "prep") {
    return (
      <div className="oh-feature-ui oh-feature-ui-prep" aria-hidden="true">
        <div className="oh-feature-question">Tell me about a project where you influenced stakeholders.</div>
        <div className="oh-feature-answer">
          <small>Practice response</small>
          <span>Structure your answer around the challenge, your action, and the measurable result.</span>
        </div>
      </div>
    );
  }

  if (type === "track") {
    return (
      <div className="oh-feature-ui oh-feature-ui-track" aria-hidden="true">
        <div><span>Applied</span><strong>12</strong></div>
        <div><span>Reviewing</span><strong>5</strong></div>
        <div><span>Interview</span><strong>3</strong></div>
        <div><span>Offer</span><strong>1</strong></div>
      </div>
    );
  }

  return (
    <div className="oh-feature-ui oh-feature-ui-live" aria-hidden="true">
      <div className="oh-live-orb">AI</div>
      <div className="oh-live-copy">
        <span>Interview in progress</span>
        <strong>Stay ready for the next question</strong>
        <small>Real-time guidance · Post-interview analysis</small>
      </div>
      <div className="oh-live-earn">Earn while you search</div>
    </div>
  );
}

export default function HomepageFeatureShowcase() {
  return (
    <section className="oh-feature-section" aria-labelledby="what-odesseus-does">
      <div className="oh-feature-heading">
        <span>YOUR AI CAREER AGENT</span>
        <h2 id="what-odesseus-does">One place to search, apply, prepare, interview, and keep moving.</h2>
        <p>
          Odesseus helps you move through the entire job-search journey — from finding the right role
          to preparing for the interview — without turning the process into five different tools.
        </p>
      </div>

      <div className="oh-feature-grid">
        {features.map((feature) => (
          <article className={`oh-feature-card ${feature.accent ? "is-accent" : ""}`} key={feature.title}>
            <div className="oh-feature-copy">
              <span className="oh-feature-eyebrow">{feature.eyebrow}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              {feature.visual === "live" ? (
                <Link className="oh-feature-link" href="/signin">
                  Program details are available after sign in →
                </Link>
              ) : null}
            </div>
            <FeatureVisual type={feature.visual} />
          </article>
        ))}
      </div>

      <div className="oh-feature-cta">
        <div>
          <span>Ready to put Odesseus to work?</span>
          <strong>Start with your profile and the resume you already have.</strong>
        </div>
        <Link href="/signup">Get Started →</Link>
      </div>
    </section>
  );
}
