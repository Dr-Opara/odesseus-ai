import Link from "next/link";
import ApplyStartForm from "@/components/apply-start-form";

type Job = {
  id: string;
  company_name: string;
  role_title: string;
  location: string | null;
  match_score: number | null;
  source_url: string | null;
};

/**
 * Mobile Approval screen (screen 09) — reuses the exact same preflight data
 * and `ApplyStartForm` (POST /api/apply/start) the desktop approval page
 * uses. No separate approval logic; the same credit/tailoring gate applies.
 */
export default function MobileApplyStart({
  job,
  matchScore,
  approvedVersion,
  applicationCredits,
}: {
  job: Job;
  matchScore: number | null;
  approvedVersion: number | null;
  applicationCredits: number;
}) {
  const canApply = approvedVersion !== null && applicationCredits >= 1;

  return (
    <main className="odesseus-mobile-only m-screen m-screen-09">
      <header className="m-screen-header">
        <button type="button" onClick={() => history.back()} aria-label="Back">
          ←
        </button>
        <h1>
          <span>Ready to apply?</span>
        </h1>
      </header>
      <p className="m-lead">You stay in control before submission.</p>

      <div className="m-card" style={{ marginBottom: 14 }}>
        <span className="m-copy">
          <strong>{job.role_title}</strong>
          <small>
            {job.company_name}
            {job.location ? ` · ${job.location}` : ""}
          </small>
        </span>
        {matchScore !== null ? <b className="m-tag">{matchScore}% match</b> : null}
      </div>

      <div className="m-card" style={{ display: "block" }}>
        <strong style={{ fontSize: 13 }}>Application package</strong>
        <div className="m-checklist">
          <span className={approvedVersion ? "is-done" : ""}>
            {approvedVersion ? "✓" : "○"} Tailored resume
            {approvedVersion ? ` (v${approvedVersion})` : ""}
          </span>
          <span className="is-done">✓ Contact information</span>
          <span className="is-done">✓ Job-specific answers</span>
          <span className={approvedVersion ? "is-done" : ""}>
            {approvedVersion ? "✓" : "○"} Final review complete
          </span>
        </div>
      </div>

      {!approvedVersion ? (
        <div className="m-warning" style={{ marginTop: 14 }}>
          <strong>Approve a tailored resume before starting the application.</strong>
        </div>
      ) : applicationCredits < 1 ? (
        <div className="m-warning" style={{ marginTop: 14 }}>
          <strong>
            You need one application credit. <Link href="/billing">Buy credits</Link>
          </strong>
        </div>
      ) : (
        <div style={{ margin: "14px 4px 0" }}>
          <ApplyStartForm jobId={job.id} defaultUrl={job.source_url} />
        </div>
      )}

      <div className="m-note" style={{ opacity: canApply ? 1 : 0.7 }}>
        Charged only after a successful submission — $0.99.
      </div>
    </main>
  );
}
