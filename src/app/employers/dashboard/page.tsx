import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerProfile } from "@/lib/employers/onboarding-adapter";
import { getEmployerJobs } from "@/lib/employers/jobs-adapter";
import { getEmployerAnalytics } from "@/lib/employers/analytics-adapter";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

/** Employer Dashboard (Figma screen 73, F13-C). Every number here is adapter-sourced — never hardcoded. */
export default async function EmployerDashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [profileResult, jobsResult, analyticsResult, candidatesResult] = await Promise.all([
    getEmployerProfile(),
    getEmployerJobs(),
    getEmployerAnalytics(),
    getCandidates(),
  ]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Hiring Overview</h1>

          {profileResult.status === "ok" && jobsResult.status === "ok" ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge
                capacity={{
                  activeJobCount: jobsResult.data.filter((j) => j.status === "Published").length,
                  planLimit: EMPLOYER_PLANS.find((p) => p.name === profileResult.data.planId)?.activeJobLimit ?? 0,
                  planId: profileResult.data.planId,
                }}
              />
            </div>
          ) : null}

          <div style={{ marginTop: 24 }}>
            {analyticsResult.status === "ok" && jobsResult.status === "ok" ? (
              <EmployerRowList>
                <EmployerRow label="Active jobs" value={jobsResult.data.filter((j) => j.status === "Published").length} href="/employers/jobs" />
                <EmployerRow label="Applicants" value={analyticsResult.data.applicantVolume} />
                <EmployerRow label="Strong Fits" value={analyticsResult.data.strongFitCandidates} />
                <EmployerRow label="Interviews" value={analyticsResult.data.stageDistribution.INTERVIEW ?? 0} />
                {candidatesResult.status === "ok" && candidatesResult.data.length > 0 ? (
                  (() => {
                    const top = [...candidatesResult.data].sort((a, b) => (b.fitScoreOverall ?? 0) - (a.fitScoreOverall ?? 0))[0];
                    return top.fitScoreOverall ? (
                      <EmployerRow label="Top match" value={`${top.name} · ${Math.round(top.fitScoreOverall)}% Fit`} />
                    ) : null;
                  })()
                ) : null}
              </EmployerRowList>
            ) : (
              <EmployerStatePanel
                kind="empty"
                title="No Analytics Yet"
                message={analyticsResult.status === "unavailable" ? analyticsResult.reason : "Post a job to start seeing hiring data here."}
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
