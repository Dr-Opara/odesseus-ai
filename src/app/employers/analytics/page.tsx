import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerAnalytics } from "@/lib/employers/analytics-adapter";
import { getEmployerProfile } from "@/lib/employers/onboarding-adapter";

/** Employer Analytics (Figma screen 81, F13-L). Figma's own subtitle locks this to Growth+ plans. */
export default async function EmployerAnalyticsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const profileResult = await getEmployerProfile();

  if (profileResult.status === "ok" && profileResult.data.planId === "Starter") {
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

  const analyticsResult = await getEmployerAnalytics();

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
                const s = analyticsResult.data.stageDistribution;
                const reviewPlus = (s.REVIEWING ?? 0) + (s.SHORTLISTED ?? 0) + (s.INTERVIEW ?? 0) + (s.OFFER ?? 0) + (s.HIRED ?? 0);
                const interviewPlus = (s.INTERVIEW ?? 0) + (s.OFFER ?? 0) + (s.HIRED ?? 0);
                const offerPlus = (s.OFFER ?? 0) + (s.HIRED ?? 0);
                const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—");
                return (
                  <EmployerRowList>
                    <EmployerRow label="Applicants" value={analyticsResult.data.applicantVolume} />
                    <EmployerRow label="Strong Fits" value={analyticsResult.data.strongFitCandidates} />
                    <EmployerRow label="Interviews" value={s.INTERVIEW ?? 0} />
                    <EmployerRow label="Applicant → Review" value={pct(reviewPlus, analyticsResult.data.applicantVolume)} />
                    <EmployerRow label="Review → Interview" value={pct(interviewPlus, reviewPlus)} />
                    <EmployerRow label="Interview → Offer" value={pct(offerPlus, interviewPlus)} />
                  </EmployerRowList>
                );
              })()
            ) : (
              <EmployerStatePanel kind="empty" title="No Analytics Yet" message={analyticsResult.reason} actionHref="/employers/post-job" actionLabel="Post a Job" />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
