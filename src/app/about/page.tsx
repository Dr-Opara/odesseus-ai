import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "About — Odysseus",
  description: "Odysseus gives every job seeker an agent for the work around getting hired.",
};

const fragments = [
  "Job discovery",
  "Resume tailoring",
  "Repeated ATS forms",
  "Application tracking",
  "Email/calendar updates",
  "Interview preparation",
  "Follow-up",
];

const beliefs = [
  {
    n: "01",
    title: "Your experience should stay yours.",
    body: "Never fabricate qualifications.",
  },
  {
    n: "02",
    title: "You should stay in control.",
    body: "Applications and sensitive decisions remain under user control.",
  },
  {
    n: "03",
    title: "You shouldn't pay just to have access.",
    body: "Pay when Odysseus completes meaningful work.",
  },
  {
    n: "04",
    title: "Your career context shouldn't reset at every stage.",
    body: "Resume, application, and interview context remain connected.",
  },
];

export default function AboutPage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell page-hero">
        <h1 className="font-display page-hero-headline">The job search shouldn&apos;t be a second full-time job.</h1>
        <p className="muted page-hero-copy">
          Odysseus was built around a simple idea: people should spend more time choosing the right opportunities and preparing to succeed—and less time repeating the same information across applications, resumes, portals, and interview rounds.
        </p>
      </section>

      <section className="shell" style={{ padding: "10px 0 50px" }}>
        <div className="card" style={{ padding: 34 }}>
          <h2 style={{ fontSize: 26, margin: "0 0 10px" }}>Why Odysseus exists</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 640, lineHeight: 1.6 }}>
            Job search today is fragmented across disconnected steps:
          </p>
          <div className="fragment-list">
            {fragments.map((fragment) => (
              <span className="fragment-chip" key={fragment}>{fragment}</span>
            ))}
          </div>
          <p className="muted" style={{ margin: "8px 0 0", maxWidth: 640, lineHeight: 1.6 }}>
            Odysseus unifies them into one connected lifecycle:
          </p>
          <p className="flow-chain-large">
            Discover → Match → Tailor → Apply → Track → Interview → Follow Up
          </p>
        </div>
      </section>

      <section className="shell" style={{ padding: "0 0 50px" }}>
        <div className="card mission-band">
          <div className="muted" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 14 }}>
            Mission
          </div>
          <h2 className="font-display mission-statement">
            Give every job seeker an agent for the work around getting hired.
          </h2>
          <p className="muted" style={{ maxWidth: 620, margin: "0 auto" }}>
            Odysseus does not replace the candidate. It handles the repetitive career-search work, while the person stays in control of decisions, applications, and interviews.
          </p>
        </div>
      </section>

      <section className="shell" style={{ padding: "0 0 50px" }}>
        <h2 style={{ fontSize: 26, margin: "0 0 20px" }}>What we believe</h2>
        <div className="belief-grid">
          {beliefs.map((belief) => (
            <div className="card belief-card" key={belief.n}>
              <div className="belief-number">{belief.n}</div>
              <h3 style={{ fontSize: 19, margin: "12px 0 6px" }}>{belief.title}</h3>
              <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>{belief.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="shell" style={{ padding: "0 0 50px" }}>
        <div className="card" style={{ padding: 34 }}>
          <h2 style={{ fontSize: 22, margin: "0 0 10px" }}>What we&apos;re building</h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6, maxWidth: 640 }}>
            A persistent AI career agent supporting the complete journey from opportunity discovery through interviews and follow-up.
          </p>
        </div>
      </section>

      <section className="shell" style={{ padding: "0 0 30px" }}>
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          Odysseus is developed by ProcessPilot Technologies LLC.
        </p>
      </section>

      <section className="shell" style={{ padding: "0 0 100px" }}>
        <div className="page-cta-band card">
          <div>
            <h2 style={{ fontSize: 24, margin: "0 0 6px" }}>See it for yourself.</h2>
            <p className="muted" style={{ margin: 0 }}>Upload your resume and see your first matches.</p>
          </div>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
