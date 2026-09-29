import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import JobDetailActions from "@/components/employers/job-detail-actions";
import { getEmployerJob, getEmployerJobs } from "@/lib/employers/jobs-adapter";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { getEmployerProfile } from "@/lib/employers/onboarding-adapter";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

/** Employer Job Detail (Figma screen 77) — the click-through target from the Jobs list. */
export default async function EmployerJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [jobResult, candidatesResult, allJobsResult, profileResult] = await Promise.all([
    getEmployerJob(id),
    getCandidates({ jobId: id }),
    getEmployerJobs(),
    getEmployerProfile(),
  ]);

  if (jobResult.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <EmployerStatePanel kind="error" title="This job isn't available yet" message={jobResult.reason} actionHref="/employers/jobs" actionLabel="Back to Jobs" />
          </section>
        </div>
      </main>
    );
  }

  const job = jobResult.data;
  const strongFits = candidatesResult.status === "ok" ? candidatesResult.data.filter((c) => (c.fitScoreOverall ?? 0) >= 80).length : 0;
  const interviews = candidatesResult.status === "ok" ? candidatesResult.data.filter((c) => c.stage === "INTERVIEW").length : 0;
  const activeCount = allJobsResult.status === "ok" ? allJobsResult.data.filter((j) => j.status === "Published").length : 0;
  const plan = profileResult.status === "ok" ? EMPLOYER_PLANS.find((p) => p.name === profileResult.data.planId) : undefined;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>{job.title}</h1>

          <div style={{ marginTop: 20 }}>
            <EmployerRowList>
              <EmployerRow label="Applicants" value={job.applicantCount ?? 0} href={`/employers/candidates?job=${job.id}`} />
              <EmployerRow label="Strong Fits" value={strongFits} />
              <EmployerRow label="Interviews" value={interviews} />
              <EmployerRow label="Featured status" value={job.featured ? "Featured" : "None"} />
              <EmployerRow label="Plan capacity" value={plan ? `${activeCount} of ${plan.activeJobLimit} active` : "—"} />
            </EmployerRowList>
          </div>

          <JobDetailActions job={job} />
        </section>
      </div>
    </main>
  );
}
