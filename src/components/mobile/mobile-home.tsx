import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";
import CompanyLogo from "@/components/company-logo";
import type {
  CandidateDashboardActivityItem,
  CandidateDashboardApplication,
} from "@/lib/candidate/dashboard";
import type { CandidateJob, CreditBalance } from "@/lib/candidate/types";
import { formatCents } from "@/lib/pricing/candidate-pricing";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function initials(name?: string | null) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Every feed item is a real native event. The only distinction worth drawing
 * is whether it is waiting on the candidate: attention items get the action
 * mark, recorded milestones get a quiet check. There is no signal/feed split
 * here because there is no external data — the dashboard is native-only. */
function activityIcon(
  item: CandidateDashboardActivityItem
): { icon: string; color: "purple" | "green" } {
  return item.needsAttention
    ? { icon: "▶", color: "purple" }
    : { icon: "✓", color: "green" };
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
 * verified profile name, live wallet balance, strong matches, recent
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
  recentApplications: CandidateDashboardApplication[];
  activity: CandidateDashboardActivityItem[];
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
      showBack={false}
      right={
        <Link href="/profile" className="m-avatar-link" aria-label="Your profile">
          <span className="m-avatar-sm">{initials(fullName)}</span>
        </Link>
      }
      nav
    >
      <section className="m-ai-hero">
        <span className="m-ai-hero-accent" aria-hidden="true">↗</span>
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
          <strong>{formatCents(credits.walletBalanceCents)}</strong>
          <span>wallet</span>
        </div>
        <div>
          <strong>{credits.interviewPasses}</strong>
          <span>interview passes</span>
        </div>
        <Link href="/billing" className="m-balance-link">
          Wallet
        </Link>
      </div>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Top Matches for You</h2>
          <Link href="/jobs">See All</Link>
        </div>

        {matches.length ? (
          <div className="m-list">
            {matches.map((job) => (
              <Link className="m-match-card" href={`/match/${job.id}`} key={job.id}>
                <CompanyLogo
                  company={job.company_name}
                  sourceUrl={job.source_url}
                  className="m-icon m-icon-sm company-logo-mobile"
                />
                <span className="m-match-copy">
                  <span className="m-match-company">{job.company_name}</span>
                  <strong>{job.role_title}</strong>
                  <small>{job.salary_text || "Salary not listed"}</small>
                </span>
                <span className="m-match-badge">
                  <strong>{job.match_score ?? "—"}%</strong>
                  <small>Match</small>
                </span>
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
                <CompanyLogo
                  company={application.companyName}
                  sourceUrl={application.applicationUrl}
                  className="m-icon company-logo-mobile"
                />
                <span className="m-copy">
                  <strong>{application.roleTitle}</strong>
                  <small>
                    {application.companyName} · {when(application.lastEventAt)}
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
          <h2>Agent Activity</h2>
        </div>

        {feed.length ? (
          <div className="m-list">
            {feed.map((item) => {
              const { icon, color } = activityIcon(item);
              return (
                <div className="m-card" key={item.id}>
                  <span className={`m-icon m-icon-${color}`} aria-hidden="true">{icon}</span>
                  <span className="m-copy">
                    <strong>{item.title}</strong>
                    <small>{when(item.occurredAt)}</small>
                  </span>
                  <b className="m-chevron">›</b>
                </div>
              );
            })}
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