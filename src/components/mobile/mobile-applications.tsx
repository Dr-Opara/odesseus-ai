import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";
import { statusLabel } from "@/lib/applications/status";

type ApplicationRow = {
  id: string;
  company_name: string;
  role_title: string;
  status: string;
  last_event_at: string | null;
  submitted_at: string | null;
  match_score_snapshot: number | null;
  job_opportunities: { match_score: number | null } | null;
};

const FILTERS = [
  ["all", "All"],
  ["applied", "Submitted"],
  ["employer_response", "In Review"],
  ["interview", "Interview"],
  ["offer", "Offer"],
] as const;

function when(value: string | null) {
  if (!value) return "Not submitted";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value)
  );
}

/**
 * Mobile Applications screen (screen 10) — the same application rows and
 * status filter the desktop tracker uses. Filter chips are plain links to
 * `/applications?status=...`, the exact query param the real page already
 * reads server-side; there is no separate mobile filtering logic.
 */
export default function MobileApplications({
  applications,
  status,
}: {
  applications: ApplicationRow[];
  status: string;
}) {
  return (
    <MobileScreen index="10" title="Applications" nav>
      <div className="m-chip-row">
        {FILTERS.map(([value, label]) => (
          <Link
            key={value}
            href={value === "all" ? "/applications" : `/applications?status=${value}`}
            className={`m-chip${status === value ? " is-active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {applications.length ? (
        <div className="m-list">
          {applications.map((application) => {
            const score =
              application.match_score_snapshot ??
              application.job_opportunities?.match_score ??
              null;
            return (
              <Link
                className="m-card"
                href={`/applications/${application.id}`}
                key={application.id}
              >
                <span className="m-icon">{application.company_name.slice(0, 1)}</span>
                <span className="m-copy">
                  <strong>{application.company_name}</strong>
                  <small>
                    {application.role_title} · {when(application.submitted_at)}
                    {score !== null ? ` · ${score}%` : ""}
                  </small>
                </span>
                <b className="m-tag">{statusLabel(application.status)}</b>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="m-empty">
          Applications appear here after submission and stay connected to their exact
          job, resume, employer responses, and interviews.
        </div>
      )}
    </MobileScreen>
  );
}
