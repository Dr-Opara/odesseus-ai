import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerJobs } from "@/lib/employers/jobs-adapter";
import { getEmployerProfile } from "@/lib/employers/onboarding-adapter";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

function rowValue(job: { status: string; applicantCount?: number }): string {
  if (job.status === "Published") {
    return `${job.applicantCount ?? 0} applicant${job.applicantCount === 1 ? "" : "s"}`;
  }
  return job.status;
}

/** Employer Jobs list (Figma screen 74, F13-D). */
export default async function EmployerJobsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [jobsResult, profileResult] = await Promise.all([getEmployerJobs(), getEmployerProfile()]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", flexWrap: "wrap" }}>
            <div>
              <h1>Jobs</h1>
              <p className="muted">Manage active, draft, and closed job posts.</p>
            </div>
            <a className="figma-btn figma-btn-orange" href="/employers/post-job">
              + Post a Job
            </a>
          </div>

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
            {jobsResult.status === "ok" && jobsResult.data.length > 0 ? (
              <EmployerRowList>
                {jobsResult.data.map((job) => (
                  <EmployerRow key={job.id} label={job.title} value={rowValue(job)} href={`/employers/jobs/${job.id}`} />
                ))}
              </EmployerRowList>
            ) : jobsResult.status === "ok" ? (
              <EmployerStatePanel kind="empty" title="No Jobs Yet" message="Post your first role to start receiving applicants." actionHref="/employers/post-job" actionLabel="Post a Job" />
            ) : (
              <EmployerStatePanel kind="error" title="Jobs aren't available yet" message={jobsResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
