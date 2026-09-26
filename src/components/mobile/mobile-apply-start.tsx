import Link from "next/link";
import ApplyTierAndStart from "@/components/apply/apply-tier-and-start";
import { applyRates } from "@/lib/billing/catalog";
import { formatCents } from "@/lib/pricing/candidate-pricing";

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
 * and apply tier + start flow (POST /api/apply/start) the desktop approval
 * page uses. No separate approval logic; the same wallet/tailoring gate
 * applies.
 *
 * Eligibility is funded from `wallet_balance_cents` only. `application_credits`
 * is legacy, is not a source of truth, and must never gate Apply. The minimum
 * balance to start is the Standard Apply rate; Smart Apply ($1.99) is debited
 * later, only after a verified successful submission.
 */
export default function MobileApplyStart({
  job,
  matchScore,
  approvedVersion,
  walletBalanceCents,
}: {
  job: Job;
  matchScore: number | null;
  approvedVersion: number | null;
  walletBalanceCents: number;
}) {
  const canApply =
    approvedVersion !== null && walletBalanceCents >= applyRates.standard.amountCents;

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
      ) : !canApply ? (
        <div className="m-warning" style={{ marginTop: 14 }}>
          <strong>
            Your wallet needs funds to start Apply. <Link href="/billing">Top up</Link>
          </strong>
        </div>
      ) : (
        <div style={{ margin: "14px 4px 0" }}>
          <ApplyTierAndStart jobId={job.id} defaultUrl={job.source_url} />
        </div>
      )}

      <div className="m-note" style={{ opacity: canApply ? 1 : 0.7 }}>
        No charge when you start. {applyRates.standard.label} {formatCents(applyRates.standard.amountCents)} and{" "}
        {applyRates.smart.label} {formatCents(applyRates.smart.amountCents)} are charged only after Odesseus
        verifies a successful submission.
      </div>
    </main>
  );
}
