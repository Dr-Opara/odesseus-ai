import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "How Odysseus Works — Odysseus",
  description: "The complete Odysseus lifecycle: build your profile, find strong matches, apply, track responses, prepare, go live, and follow up.",
};

const stages = [
  {
    n: "01",
    title: "Build Your Profile",
    body: "Upload your resume once. Odysseus learns your verified experience, skills, education, certifications, and preferences.",
    pills: [],
  },
  {
    n: "02",
    title: "Find Strong Matches",
    body: "Odysseus finds relevant opportunities and explains why they fit — a match score, hard-requirement checks, and skills/experience alignment.",
    pills: ["85%+ Match", "Hard Requirements Checked", "No Fabricated Qualifications"],
  },
  {
    n: "03",
    title: "Review & Apply",
    body: "Odysseus tailors your resume, prepares a cover letter when needed, and waits for your approval before completing the application on the employer's site.",
    pills: ["ATS-Ready Resume", "Cross-Platform Applications", "$0.99 Only After Successful Submission"],
  },
  {
    n: "04",
    title: "Track Responses",
    body: "Every submitted application becomes a tracked record — status, timeline, the frozen resume and job description you applied with, and employer responses as they arrive.",
    pills: ["Application Timeline", "Frozen Resume & Job Context"],
  },
  {
    n: "05",
    title: "Prepare",
    body: "When an interview is detected, the Interview Workspace opens at no cost — a readiness brief, verified experience examples, questions to ask, and memory from any prior rounds.",
    pills: ["Free Interview Preparation", "Multi-Round Memory"],
  },
  {
    n: "06",
    title: "Odysseus Live",
    body: "During the interview, Odysseus transcribes in real time and offers private, grounded guidance. You remain the speaker throughout.",
    pills: ["Realtime Guidance", "STAR / Shorter / Technical / Follow-Up"],
  },
  {
    n: "07",
    title: "Follow Up",
    body: "After the interview, Odysseus produces a factual recap and transcript, enriches your round memory, and drafts a contextual follow-up email for you to edit, approve, and send.",
    pills: ["Post-Interview Analysis", "Follow-Up Email Draft"],
  },
];

export default function HowItWorksPage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell page-hero">
        <div className="badge">How Odysseus Works</div>
        <h1 className="font-display page-hero-headline">The complete Odysseus lifecycle.</h1>
        <p className="muted page-hero-copy">
          From your first resume upload to your next offer, your context stays connected — nothing gets re-entered at every stage.
        </p>
      </section>

      <section className="shell" style={{ padding: "10px 0 100px" }}>
        <div className="lifecycle-list">
          {stages.map((stage, index) => (
            <div className="lifecycle-item" key={stage.n}>
              <div className="lifecycle-marker">
                <span className="lifecycle-number">{stage.n}</span>
                {index < stages.length - 1 ? <span className="lifecycle-connector" /> : null}
              </div>
              <div className="card lifecycle-card">
                <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>{stage.title}</h2>
                <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>{stage.body}</p>
                {stage.pills.length ? (
                  <div className="how-it-works-pills">
                    {stage.pills.map((pill) => (
                      <span className="how-it-works-pill" key={pill}>{pill}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="page-cta-band card">
          <div>
            <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>Ready to start?</h2>
            <p className="muted" style={{ margin: 0 }}>Upload your resume and see your first matches.</p>
          </div>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
