"use client";

import Link from "next/link";
import { billingCatalog, liveSkus } from "@/lib/billing/catalog";

// Recurring Live plans only (excludes the one-time live_single pass), same
// derivation as src/app/billing/page.tsx — kept out of the public/shared
// candidate-pricing module by design (see that file's header comment: Live
// pricing must never be one import away from a public page). This component
// only ever renders behind an authenticated dashboard.
const LIVE_PLANS = liveSkus.filter((sku) => "planType" in billingCatalog[sku]);
function liveCadence(sku: (typeof liveSkus)[number]): string {
  return "planType" in billingCatalog[sku] && billingCatalog[sku].planType === "monthly" ? "/month" : "/year";
}

type LiveEntryCardProps = {
  interviewPasses: number;
  liveUnlimitedUntil: string | null;
  upcomingInterview?: {
    id: string;
    roleTitle: string;
    companyName: string;
    stage: string | null;
    scheduledAt: string | null;
    meetingProvider: string | null;
    readinessGeneratedAt: string | null;
  } | null;
};

export default function LiveEntryCard({
  interviewPasses,
  liveUnlimitedUntil,
  upcomingInterview,
}: LiveEntryCardProps) {
  const hasAnnualAccess = liveUnlimitedUntil && new Date(liveUnlimitedUntil) > new Date();
  const canLaunchLive = upcomingInterview && (interviewPasses > 0 || hasAnnualAccess);

  return (
    <section className="card live-entry-card">
      <div className="live-entry-header">
        <div>
          <div className="badge">Odesseus Live</div>
          <h2 style={{ fontSize: 24, margin: "8px 0 4px" }}>
            Real-time interview assistance
          </h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
            Private, on-screen guidance while you interview. You remain the speaker.
          </p>
        </div>
        <div className="live-entry-status">
          {hasAnnualAccess ? (
            <div className="badge live-annual-badge">
              Annual active through{" "}
              {new Date(liveUnlimitedUntil!).toLocaleDateString()}
            </div>
          ) : (
            <div className="live-pass-count">
              <strong>{interviewPasses} pass{interviewPasses === 1 ? "" : "es"}</strong>
              <span className="muted"> available</span>
            </div>
          )}
        </div>
      </div>

      <div className="live-boundary-note">
        <strong>You remain the interviewee.</strong>
        <span>
          Odesseus listens only after you start it, shows private on-screen guidance,
          and never joins the meeting or speaks for you.
        </span>
      </div>

      {upcomingInterview ? (
        <div className="live-upcoming-interview">
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            Next interview
          </div>
          <Link
            href={`/interviews/${upcomingInterview.id}`}
            className="live-interview-link"
          >
            <div>
              <strong>{upcomingInterview.roleTitle}</strong>
              <span className="muted"> at {upcomingInterview.companyName}</span>
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              {upcomingInterview.stage || "Interview"}{" "}
              {upcomingInterview.scheduledAt
                ? ` · ${new Date(upcomingInterview.scheduledAt).toLocaleString()}`
                : " · Time pending"}
              {" "}
              {upcomingInterview.meetingProvider
                ? ` · ${upcomingInterview.meetingProvider}`
                : " · Platform pending"}
            </div>
          </Link>
          {canLaunchLive ? (
            <Link
              className="btn btn-primary live-launch-btn"
              href={`/interviews/${upcomingInterview.id}/live`}
            >
              {upcomingInterview.readinessGeneratedAt
                ? "Launch Odesseus Live"
                : "Prepare first, then launch Live"}
            </Link>
          ) : (
            <div className="live-blocked-reason">
              {interviewPasses === 0 && !hasAnnualAccess
                ? "Purchase a pass or annual plan to launch Live"
                : "No upcoming interview linked to Live"}
            </div>
          )}
        </div>
      ) : (
        <div className="live-no-interview">
          <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
            When you have an upcoming interview, it will appear here with a direct
            link to launch Odesseus Live.
          </p>
          {interviewPasses === 0 && !hasAnnualAccess && (
            <Link href="/billing" className="btn btn-secondary" style={{ marginTop: 14 }}>
              Get interview passes
            </Link>
          )}
        </div>
      )}

      <Link href="/billing" className="live-plans-link">
        View Live plans:{" "}
        {LIVE_PLANS.map((sku) => (
          <span key={sku} className="live-plan-item">
            {billingCatalog[sku].label} · ${(billingCatalog[sku].amountCents / 100).toFixed(2)}
            {liveCadence(sku)}
          </span>
        ))}
      </Link>
    </section>
  );
}