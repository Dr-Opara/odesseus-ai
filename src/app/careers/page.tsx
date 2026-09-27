import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata = {
  title: "Careers \u2014 Odesseus",
  description: "Join the team building calm AI career tools. We are a small, focused team helping people navigate their job search with confidence.",
};

const roles = [
  {
    title: "Founding Product Engineer",
    type: "Full-time",
    location: "Remote (US/Canada/EU time zones)",
    description: "Own features end-to-end: from Figma specs to production TypeScript/React/Next.js. You will shape the product, not just implement tickets.",
    highlights: [
      "React/Next.js/TypeScript/Tailwind",
      "Supabase (Postgres, Auth, Storage)",
      "Vercel AI SDK + OpenAI",
      "Playwright + Vitest testing culture",
    ],
    applyUrl: "/signup?ref=careers-founding-engineer",
  },
  {
    title: "Founding ML/AI Engineer",
    type: "Full-time",
    location: "Remote (US/Canada/EU time zones)",
    description: "Design and ship the AI pipeline that powers resume tailoring, job matching, interview prep, and Live assistance. You care about latency, correctness, and grounded outputs.",
    highlights: [
      "Prompt engineering & evals",
      "RAG over candidate documents",
      "Streaming + tool use (Vercel AI SDK)",
      "Model routing & cost optimization",
    ],
    applyUrl: "/signup?ref=careers-founding-ml",
  },
  {
    title: "Developer Advocate / Community Lead",
    type: "Full-time",
    location: "Remote",
    description: "Build the community of job seekers, creators, and partners around Odesseus. Write, speak, demo, and gather feedback that drives the roadmap.",
    highlights: [
      "Technical content (blog, video, streams)",
      "Partner/creator program growth",
      "Discord/forum community management",
      "Conference talks & workshops",
    ],
    applyUrl: "/signup?ref=careers-dev-advocate",
  },
  {
    title: "Growth / Partnerships Lead",
    type: "Full-time",
    location: "Remote",
    description: "Own creator partnerships, affiliate program, and the first-100-users campaign. You enjoy outbound, relationship-building, and measurable growth.",
    highlights: [
      "Creator/affiliate program management",
      "Campaign design & execution",
      "Referral analytics & optimization",
      "Cross-functional with product/eng",
    ],
    applyUrl: "/partners/apply?ref=careers-growth",
  },
];

export default function CareersPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="shell careers-hero">
        <div className="badge">We are hiring</div>
        <h1>Build calm AI for job seekers.</h1>
        <p className="careers-tagline">
          Odesseus helps people navigate their job search with AI that is honest, private, and on their side.
          We are a small team shipping fast. No corporate theater.
        </p>
        <div className="careers-meta">
          <span>\uD83C\uDFE0 Remote-first</span>
          <span>\u26A1 Small team, high ownership</span>
          <span>\uD83D\uDCE3 Equity + competitive salary</span>
        </div>
      </section>

      <section className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">How we work</div>
          <h2>Small team, high trust.</h2>
        </div>
        <div className="careers-values">
          {[
            ["Calm over chaos", "No Slack fire drills. Async-first. Deep work blocks respected."],
            ["Outcomes over output", "Ship things that move the metric. Delete code that does not."],
            ["Candidate truth first", "We never invent experience. We optimize verified truth."],
            ["Build in public", "Share learnings. Open-source what we can. Earn trust daily."],
          ].map(([title, body]) => (
            <article className="card careers-value" key={title}>
              <h3>{title}</h3>
              <p className="muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">Open roles</div>
          <h2>Roles we are actively filling.</h2>
        </div>
        <div className="careers-roles">
          {roles.map((role) => (
            <article className="card careers-role" key={role.title}>
              <div className="careers-role-header">
                <div>
                  <h3>{role.title}</h3>
                  <div className="careers-role-meta">
                    <span className="badge">{role.type}</span>
                    <span className="muted">{role.location}</span>
                  </div>
                </div>
              </div>
              <p className="muted">{role.description}</p>
              <div className="careers-role-tech">
                {role.highlights.map((h, i) => <span className="badge" key={i}>{h}</span>)}
              </div>
              <Link className="btn btn-primary careers-apply" href={role.applyUrl}>
                Apply for this role
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">Not seeing your role?</div>
          <h2>We are always open to exceptional people.</h2>
        </div>
        <div className="card careers-open">
          <p className="muted">
            If you resonate with how we work and want to contribute, email us at{" "}
            <a href="mailto:careers@odesseus.ai">careers@odesseus.ai</a> with a short note
            and your best work (GitHub, portfolio, writing, anything you are proud of).
          </p>
          <p className="muted">
            We read every message. We reply to the ones that feel like a fit.
          </p>
        </div>
      </section>

      <section className="shell partner-cta card">
        <div>
          <div className="badge">Partner with us instead?</div>
          <h2>Creator? Affiliate? Brand ambassador?</h2>
        </div>
        <Link className="btn btn-primary" href="/partners/apply">
          Join the Partner Program
        </Link>
      </section>
      <MarketingFooter />
    </main>
  );
}