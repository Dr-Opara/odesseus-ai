import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";
import type {
  CandidateActivity,
  CandidateApplication,
  CandidateJob,
  CreditBalance,
} from "@/lib/candidate/types";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function when(value: string | null) {
  if (!value) return "Time pending";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Mobile Home screen (screen 05) — the candidate's real dashboard data:
 * verified profile name, live credit balance, strong matches, recent
 * applications and recent agent activity. Empty sections show a proper
 * empty state; nothing here is demo content.
 */
export default function MobileHome({
  fullName,
  credits,
  strongMatches,
  recentApplications,
  activity,
}: {
  fullName: string | null;
  credits: CreditBalance;
  strongMatches: CandidateJob[];
  recentApplications: CandidateApplication[];
  activity: CandidateActivity[];
}) {
  const matches = strongMatches.slice(0, 5);
  const applications = recentApplications.slice(0, 5);
  const feed = activity.slice(0, 6);

  return (
    <MobileScreen
      index="05"
      eyebrow="Hello 👋"
      title={firstName(fullName)}
      minHeight={990}
      nav
    >
      <section className="m-ai-hero">
        <h2>
          Find better jobs
          <br />
          with AI.
        </h2>
        <p>Personalized matches. Smarter applications. Real results.</p>
        <Link href="/jobs" className="m-hero-search">
          <span>⌕ Search jobs, skills, or companies…</span>
          <b>≡</b>
        </Link>
      </section>

      <div className="m-balance-strip">
        <div>
          <strong>{credits.application_credits}</strong>
          <span>app credits</span>
        </div>
        <div>
          <strong>{credits.interview_passes}</strong>
          <span>interview passes</span>
        </div>
        <Link href="/billing" className="m-balance-link">
          Credits
        </Link>
      </div>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Strong matches</h2>
          <Link href="/jobs">View all</Link>
        </div>

        {matches.length ? (
          <div className="m-list">
            {matches.map((job) => (
              <Link className="m-card m-job-card" href={`/match/${job.id}`} key={job.id}>
                <span className="m-icon">◎</span>
                <span className="m-copy">
                  <strong>{job.role_title}</strong>
                  <small>
                    {job.company_name}
                    {job.location ? ` · ${job.location}` : ""}
                    {job.salary_text ? ` · ${job.salary_text}` : ""}
                  </small>
                </span>
                <b className="m-tag">{job.match_score ?? "—"}%</b>
              </Link>
            ))}
          </div>
        ) : (
          <div className="m-empty">
            No strong matches yet. Run a refresh in Match, or paste a role Odesseus
            should look at.
          </div>
        )}
      </section>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Recent applications</h2>
          <Link href="/applications">View all</Link>
        </div>

        {applications.length ? (
          <div className="m-list">
            {applications.map((application) => (
              <Link
                className="m-card"
                href={`/applications/${application.id}`}
                key={application.id}
              >
                <span className="m-icon">{application.role_title.slice(0, 1)}</span>
                <span className="m-copy">
                  <strong>{application.role_title}</strong>
                  <small>
                    {application.company_name} · {when(application.last_event_at)}
                  </small>
                </span>
                <b className="m-tag">{statusLabel(application.status)}</b>
              </Link>
            ))}
          </div>
        ) : (
          <div className="m-empty">Applications appear here after submission.</div>
        )}
      </section>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Odesseus activity</h2>
        </div>

        {feed.length ? (
          <div className="m-list">
            {feed.map((item) => (
              <div className="m-card" key={item.key}>
                <span className="m-icon">✦</span>
                <span className="m-copy">
                  <strong>{item.title}</strong>
                  {item.detail ? <small>{item.detail}</small> : null}
                </span>
                <small className="m-when">{when(item.at)}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="m-empty">
            Odesseus activity will appear here as your search moves forward.
          </div>
        )}
      </section>
    </MobileScreen>
  );
}