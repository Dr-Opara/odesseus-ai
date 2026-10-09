import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerAnalytics, getAnalyticsEntitlement } from "@/lib/employers/analytics-adapter";
import { STAGE_LABELS } from "@/lib/employers/stages";
import type { PipelineStage } from "@/lib/employers/types";

/**
 * Employer Analytics (Figma screen 81, F13-L).
 *
 * Every figure is the backend's real aggregate: the applicant total is the sum
 * of the per-job counts it returned, the strong-fit count is the sum of its
 * strong-fit-by-job rows, and the conversion rates are computed from its own
 * stage distribution. Nothing is estimated and nothing is defaulted to a
 * positive number.
 *
 * The Growth+ gate is presentation. The analytics route is readable by any org
 * member; Figma frames this screen as a Growth+ feature, so the tier is read
 * from the stored subscription and an org below it gets the upgrade prompt.
 * That is a product framing decision, not an access control — the backend is
 * the only thing that decides who may read what.
 */
export default async function EmployerAnalyticsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [analytics, entitlement] = await Promise.all([
    getEmployerAnalytics({ days: 30 }),
    getAnalyticsEntitlement(),
  ]);

  if (entitlement.status === "ok" && !entitlement.data.isGrowthOrAbove) {
    return (
      <main className="figma-site figma-soft-page employer-portal">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <span className="figma-eyebrow">ANALYTICS</span>
            <h1>Hiring Analytics</h1>
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="billing-required"
                title="Growth+ analytics for your hiring funnel."
                message="Hiring analytics are included on the Growth and Business plans. Upgrade to unlock funnel conversion data."
                actionHref="/employers/dashboard/billing"
                actionLabel="Upgrade Plan"
              />
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Hiring Analytics</h1>
          <p className="muted">Growth+ analytics for your hiring funnel.</p>

          <div style={{ marginTop: 24 }}>
            {analytics.status === "ok" ? (
              (() => {
                const s = analytics.data.stageDistribution;
                // A stage the backend omitted has no applicants in it. That is
                // a real zero, not a missing value: the distribution is a
                // complete snapshot of the pipeline, so absent means empty.
                const at = (stage: PipelineStage) => s[stage] ?? 0;
                const reviewPlus =
                  at("REVIEWING") + at("SHORTLISTED") + at("INTERVIEW") + at("OFFER") + at("HIRED");
                const interviewPlus = at("INTERVIEW") + at("OFFER") + at("HIRED");
                const offerPlus = at("OFFER") + at("HIRED");
                // A ratio with no denominator is undefined, not zero. Showing
                // "0%" would claim the employer converted nobody.
                const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "Not enough data");

                return (
                  <>
                    <EmployerRowList>
                      <EmployerRow label="Applicants" value={analytics.data.applicantVolume} />
                      <EmployerRow label="Strong fits" value={analytics.data.strongFitCandidates} />
                      <EmployerRow label="Active jobs" value={analytics.data.jobsActive} />
                      <EmployerRow label="Closed jobs" value={analytics.data.jobsClosed} />
                      <EmployerRow label="Hired" value={analytics.data.outcomes.hired} />
                      <EmployerRow label="Rejected" value={analytics.data.outcomes.rejected} />
                      <EmployerRow label="Applicant → Review" value={pct(reviewPlus, analytics.data.applicantVolume)} />
                      <EmployerRow label="Review → Interview" value={pct(interviewPlus, reviewPlus)} />
                      <EmployerRow label="Interview → Offer" value={pct(offerPlus, interviewPlus)} />
                    </EmployerRowList>

                    <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>Pipeline</h2>
                    <EmployerRowList>
                      {(Object.keys(s) as PipelineStage[])
                        .filter((stage) => at(stage) > 0)
                        .map((stage) => (
                          <EmployerRow
                            key={stage}
                            label={STAGE_LABELS[stage]}
                            value={at(stage)}
                            href={`/employers/candidates?stage=${stage}`}
                          />
                        ))}
                    </EmployerRowList>
                    {Object.keys(s).length === 0 ? (
                      <p className="muted" style={{ marginTop: 12 }}>
                        No applicants have moved through your pipeline yet.
                      </p>
                    ) : null}

                    <h2 style={{ fontSize: 20, margin: "32px 0 12px" }}>Team</h2>
                    <EmployerRowList>
                      <EmployerRow label="Team members" value={analytics.data.team.members} />
                      <EmployerRow label="Seats required" value={analytics.data.team.seatsRequired} />
                      <EmployerRow label="Seats active" value={analytics.data.team.seatsActive} />
                    </EmployerRowList>
                  </>
                );
              })()
            ) : (
              <EmployerStatePanel
                kind="empty"
                title="No Analytics Yet"
                message={analytics.reason}
                actionHref="/employers/post-job"
                actionLabel="Post a Job"
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
