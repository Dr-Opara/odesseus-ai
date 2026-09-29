import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerAnalytics } from "@/lib/employers/analytics-adapter";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";

/**
 * Employer Analytics (Figma screen 81, F13-L). Figma's own subtitle locks this
 * to Growth+ plans. Every figure is the backend's own count; nothing is
 * derived, defaulted, or filled in when a section is empty.
 */
export default async function EmployerAnalyticsPage() {
  const { orgId } = await requireEmployerPage("/employers/analytics");

  const billingResult = await getEmployerBilling(orgId);
  const planId = billingResult.status === "ok" ? billingResult.data.planId : null;

  if (planId === "Starter") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <h1>Hiring Analytics</h1>
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="billing-required"
                title="Growth+ analytics for your hiring funnel."
                message="Hiring analytics are included on the Growth and Business plans. Upgrade to unlock funnel conversion data."
                actionHref="/employers/billing"
                actionLabel="Upgrade Plan"
              />
            </div>
          </section>
        </div>
      </main>
    );
  }

  const analyticsResult = await getEmployerAnalytics(orgId);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Hiring Analytics</h1>
          <p className="muted">Growth+ analytics for your hiring funnel.</p>

          <div style={{ marginTop: 24 }}>
            {analyticsResult.status === "ok" ? (
              (() => {
                const snapshot = analyticsResult.data;
                const s = snapshot.stageDistribution;
                const applicants = snapshot.applicantVolume;
                const reviewPlus =
                  (s.REVIEWING ?? 0) + (s.SHORTLISTED ?? 0) + (s.INTERVIEW ?? 0) + (s.OFFER ?? 0) + (s.HIRED ?? 0);
                const interviewPlus = (s.INTERVIEW ?? 0) + (s.OFFER ?? 0) + (s.HIRED ?? 0);
                const offerPlus = (s.OFFER ?? 0) + (s.HIRED ?? 0);
                const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—");
                return (
                  <>
                    <EmployerRowList>
                      <EmployerRow label="Applicants" value={applicants} />
                      <EmployerRow label="Strong Fits" value={snapshot.strongFitCandidates} />
                      <EmployerRow label="Interviews" value={s.INTERVIEW ?? 0} />
                      <EmployerRow label="Hired" value={snapshot.hired} />
                      <EmployerRow label="Rejected" value={snapshot.rejected} />
                      <EmployerRow label="Active jobs" value={snapshot.jobsActive} />
                      <EmployerRow label="Closed jobs" value={snapshot.jobsClosed} />
                      <EmployerRow label="Applicant → Review" value={pct(reviewPlus, applicants)} />
                      <EmployerRow label="Review → Interview" value={pct(interviewPlus, reviewPlus)} />
                      <EmployerRow label="Interview → Offer" value={pct(offerPlus, interviewPlus)} />
                    </EmployerRowList>

                    <h2 style={{ marginTop: 40 }}>Applicants by job</h2>
                    <div className="emp-row-list" style={{ marginTop: 14 }}>
                      {snapshot.applicantsByJob.length === 0 ? (
                        <EmployerStatePanel
                          kind="empty"
                          title="No applicants yet"
                          message="Post a job to start collecting hiring data."
                          actionHref="/employers/post-job"
                          actionLabel="Post a Job"
                        />
                      ) : (
                        snapshot.applicantsByJob.map((row) => (
                          <EmployerRow
                            key={row.jobId}
                            label={row.jobTitle}
                            value={row.applicantCount}
                            href={`/employers/candidates?job=${row.jobId}`}
                          />
                        ))
                      )}
                    </div>

                    <h2 style={{ marginTop: 40 }}>Applications over time</h2>
                    <div className="emp-row-list" style={{ marginTop: 14 }}>
                      {snapshot.applicationsOverTime
                        .filter((point) => point.count > 0)
                        .map((point) => (
                          <EmployerRow key={point.date} label={point.date} value={point.count} />
                        ))}
                    </div>
                  </>
                );
              })()
            ) : (
              <EmployerStatePanel kind="error" title="We couldn't load your analytics" message={analyticsResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
