"use client";

import Link from "next/link";
import { APPLY_TIERS, formatCents, MIN_APPLY_PRICE_CENTS } from "@/lib/pricing/candidate-pricing";
import ApplyTierAndStart from "@/components/apply/apply-tier-and-start";
import CompanyLogo from "@/components/company-logo";

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
 * page uses. No separate approval logic; eligibility is the wallet-based
 * per-tier check (Apply 39¢ / Smart 99¢), matching the desktop gate.
 *
 * A client component because the Back control is a real button with a click
 * handler. It was a server component, which made the whole `/apply/start` page
 * fail to render — React refuses to serialize an event handler out of a server
 * component, and that error took down the desktop review surface too, not just
 * the phone one. It takes only serializable props from the server (a plain
 * job shape and three scalars), all of which cross the boundary unchanged.
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
        <CompanyLogo
          company={job.company_name}
          sourceUrl={job.source_url}
          className="m-icon company-logo-mobile"
        />
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
      ) : walletBalanceCents < MIN_APPLY_PRICE_CENTS ? (
        <div className="m-warning" style={{ marginTop: 14 }}>
          <strong>
            You need wallet balance to apply. <Link href="/billing">Go to Wallet</Link>
          </strong>
        </div>
      ) : (
        <div style={{ margin: "14px 4px 0" }}>
          <ApplyTierAndStart jobId={job.id} defaultUrl={job.source_url} walletBalanceCents={walletBalanceCents} />
        </div>
      )}

      <div className="m-note">
        No charge when you start. {APPLY_TIERS.standard.label} {formatCents(APPLY_TIERS.standard.priceCents)} and{" "}
        {APPLY_TIERS.smart.label} {formatCents(APPLY_TIERS.smart.priceCents)} are charged only after Odesseus verifies
        a successful submission.
      </div>
    </main>
  );
}
