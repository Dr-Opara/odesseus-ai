"use client";

import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";
import { billingCatalog, liveSkus } from "@/lib/billing/catalog";
import GuestLinkButton from "@/components/live/guest-link-button";

// Same derivation as src/app/billing/page.tsx / live-entry-card.tsx — kept
// out of the shared candidate-pricing module by design; only ever renders
// behind an authenticated mobile screen.
const LIVE_PLANS = liveSkus.filter((sku) => "planType" in billingCatalog[sku]);
function liveCadence(sku: (typeof liveSkus)[number]): string {
  return "planType" in billingCatalog[sku] && billingCatalog[sku].planType === "monthly" ? "/month" : "/year";
}

type MobileLiveProps = {
  interview: {
    id: string;
    stage: string | null;
    scheduled_at: string | null;
    meeting_provider: string | null;
    status: string;
    applications: { company_name: string; role_title: string } | null;
  } | null;
  interviewPasses: number;
  liveUnlimitedUntil: string | null;
  /**
   * Whether this owner may mint Guest Live links, read server-side with the
   * same predicate the mint route enforces. A mobile screen offering a button
   * whose request would be refused is worse than one that says the plan does
   * not include it.
   */
  canCreateGuestLinks: boolean;
  liveSession: {
    id: string;
    status: string;
    ended_at: string | null;
    activated_at: string | null;
    created_at: string;
  } | null;
};

export default function MobileLive({
  interview,
  interviewPasses,
  liveUnlimitedUntil,
  canCreateGuestLinks,
  liveSession,
}: MobileLiveProps) {
  const hasAnnualAccess = liveUnlimitedUntil && new Date(liveUnlimitedUntil) > new Date();
  const canAccessLive = interview && (interviewPasses > 0 || hasAnnualAccess);
  const isEnded = liveSession?.status === "ended";
  const isActive = liveSession?.status === "active" || liveSession?.status === "prepared";

  return (
    <MobileScreen index="11" title="Odesseus Live" nav>
      <section className="m-section">
        <div className="m-section-heading">
          <h2>Odesseus Live</h2>
        </div>

        <div className="m-card live-mobile-header">
          <div className="m-copy">
            <strong>Real-time interview assistance</strong>
            <small>Private, on-screen guidance while you interview. You remain the speaker.</small>
          </div>
          <div className="m-badge">
            {hasAnnualAccess ? (
              <>
                Annual active through{" "}
                {new Date(liveUnlimitedUntil!).toLocaleDateString()}
              </>
            ) : (
              <>
                {interviewPasses} pass{interviewPasses === 1 ? "" : "es"} available
              </>
            )}
          </div>
        </div>

        <div className="m-card live-mobile-boundary">
          <strong>You remain the interviewee.</strong>
          <span>
            Odesseus listens only after you start it, shows private on-screen guidance,
            and never joins the meeting or speaks for you.
          </span>
        </div>

        {interview ? (
          <>
            <div className="m-section-heading" style={{ marginTop: 20 }}>
              <h2>Linked interview</h2>
            </div>
            <Link className="m-card" href={`/interviews/${interview.id}`}>
              <span className="m-icon">✦</span>
              <span className="m-copy">
                <strong>{interview.applications?.role_title || "Interview"}</strong>
                <small>{interview.applications?.company_name || "Company"}</small>
              </span>
              <b className="m-tag">
                {interview.scheduled_at
                  ? new Date(interview.scheduled_at).toLocaleString()
                  : "Time pending"}
              </b>
            </Link>

            {liveSession ? (
              <>
                <div className="m-section-heading" style={{ marginTop: 20 }}>
                  <h2>Live session</h2>
                </div>
                <div className="m-card">
                  <span className="m-copy">
                    <strong>
                      {isEnded
                        ? "Completed"
                        : isActive
                        ? "Active"
                        : liveSession.status === "failed"
                        ? "Failed"
                        : "Prepared"}
                    </strong>
                    <small>
                      {liveSession.ended_at
                        ? `Ended ${new Date(liveSession.ended_at).toLocaleString()}`
                        : liveSession.activated_at
                        ? `Started ${new Date(liveSession.activated_at).toLocaleString()}`
                        : `Created ${new Date(liveSession.created_at).toLocaleString()}`}
                    </small>
                  </span>
                </div>
                {isEnded ? (
                  <Link
                    className="m-action"
                    href={`/interviews/${interview.id}/analysis`}
                    style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 14 }}
                  >
                    View analysis →
                  </Link>
                ) : isActive ? (
                  <div className="m-card" style={{ marginTop: 14, background: "var(--accent-bg)", borderColor: "var(--accent)" }}>
                    <span className="m-copy">
                      <strong>Live session in progress</strong>
                      <small>Return to desktop to use Odesseus Live</small>
                    </span>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="m-section-heading" style={{ marginTop: 20 }}>
                  <h2>Start Live</h2>
                </div>
                {canAccessLive ? (
                  <Link
                    className="m-action"
                    href={`/interviews/${interview.id}/live`}
                    style={{ display: "block", textAlign: "center", textDecoration: "none" }}
                  >
                    Open on desktop to start Live →
                  </Link>
                ) : (
                  <div className="m-card" style={{ opacity: 0.7 }}>
                    <span className="m-copy">
                      <strong>No passes available</strong>
                      <small>Purchase interview passes on desktop to use Live</small>
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="m-empty" style={{ marginTop: 14 }}>
            No interview linked. When you have an upcoming interview, it will appear here.
          </div>
        )}

      </section>

      <section className="m-section" style={{ marginTop: 20 }}>
        <div className="m-section-heading">
          <h2>Live plans</h2>
        </div>
        <div className="m-list">
          {LIVE_PLANS.map((sku) => (
            <div className="m-card" key={sku}>
              <span className="m-copy">
                <strong>
                  {billingCatalog[sku].label} · ${(billingCatalog[sku].amountCents / 100).toFixed(2)}
                  {liveCadence(sku)}
                </strong>
              </span>
            </div>
          ))}
        </div>
        <p className="m-note" style={{ marginTop: 12 }}>
          Purchase passes or Annual on desktop at <strong>/billing</strong>.
        </p>
      </section>

      <section className="m-section" style={{ marginTop: 20 }}>
        <div className="m-section-heading">
          <h2>Guest Live Access</h2>
        </div>

        <div className="m-card">
          <span className="m-copy">
            <strong>Share one interview of Live with a guest</strong>
            <small>
              They need no account and no payment, and they enter their own
              name, role, company, and resume. Nothing they type reaches your
              profile, Resume Hub, or interview history.
            </small>
          </span>
        </div>

        {canCreateGuestLinks ? (
          <GuestLinkButton />
        ) : (
          <div className="m-card" style={{ opacity: 0.7, marginTop: 12 }}>
            <span className="m-copy">
              <strong>Not included in your plan</strong>
              <small>
                Guest Live links come with Share Annual. Manage your Live plan
                on desktop at <strong>/billing</strong>.
              </small>
            </span>
          </div>
        )}
      </section>

      <section className="m-section" style={{ marginTop: 20 }}>
        <div className="m-section-heading">
          <h2>Desktop only</h2>
        </div>
        <div className="m-card">
          <span className="m-copy">
            <strong>Odesseus Live requires desktop</strong>
            <small>
              The real-time transcription and guidance experience runs on desktop/web only.
              Use this screen to check your pass balance, view session history, and see
              which interview is linked. Start and run Live sessions from your computer.
            </small>
          </span>
        </div>
      </section>
    </MobileScreen>
  );
}