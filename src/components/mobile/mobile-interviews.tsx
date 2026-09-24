import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";

type InterviewRow = {
  id: string;
  stage: string | null;
  scheduled_at: string | null;
  status: string;
  meeting_provider: string | null;
  readiness_generated_at: string | null;
  applications: { company_name: string; role_title: string } | null;
};

const PREP_TOOLS = [
  ["◉", "Practice Questions", "Role-specific"],
  ["☆", "STAR Story Builder", "Your experience"],
  ["◉", "Technical Topics", "Skills & concepts"],
  ["◉", "Mock Interview", "Real-time practice"],
] as const;

/**
 * Mobile Prep Agent screen (screen 11) — the candidate's real upcoming
 * interviews (same `interviews` records desktop reads), plus the Prep Agent
 * tool menu. Preparation content itself is generated per-interview on the
 * existing interview detail page; this screen is the entry point to it.
 */
export default function MobileInterviews({
  upcoming,
}: {
  upcoming: InterviewRow[];
}) {
  const nextInterview = upcoming[0] ?? null;

  return (
    <MobileScreen index="11" title="Prep Agent" nav>
      <div className="m-grid">
        {PREP_TOOLS.map(([icon, title, sub]) => (
          <div className="m-card" key={title}>
            <span className="m-icon">{icon}</span>
            <span className="m-copy">
              <strong>{title}</strong>
              <small>{sub}</small>
            </span>
          </div>
        ))}
      </div>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Upcoming interviews</h2>
          {upcoming.length > 1 ? <Link href="/interviews">View all</Link> : null}
        </div>

        {nextInterview ? (
          <Link className="m-card" href={`/interviews/${nextInterview.id}`}>
            <span className="m-icon">✦</span>
            <span className="m-copy">
              <strong>{nextInterview.applications?.role_title || nextInterview.stage || "Interview"}</strong>
              <small>{nextInterview.applications?.company_name || nextInterview.meeting_provider || "Details pending"}</small>
            </span>
            <b className="m-tag">
              {nextInterview.readiness_generated_at ? "Prepared" : "Prepare"}
            </b>
          </Link>
        ) : (
          <div className="m-empty">
            When Odesseus detects an interview for a tracked application, it will connect
            the job, submitted resume, and application history automatically.
          </div>
        )}
      </section>

      {nextInterview ? (
        <Link className="m-action" href={`/interviews/${nextInterview.id}`} style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Generate Prep Plan →
        </Link>
      ) : null}
    </MobileScreen>
  );
}
