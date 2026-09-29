import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerJobs, getEmployerCapacity } from "@/lib/employers/jobs-adapter";
import { getCandidates } from "@/lib/employers/candidates-adapter";

/**
 * The row value for a job in the list.
 *
 * A draft or closed job shows its status, which is a fact about the job. A
 * published job shows its real applicant count — counted from the applicants
 * the hiring backend returned for that job.
 *
 * It deliberately does not fall back to `0`. The jobs list has no applicant
 * count on the job row, so a default here would render "0 applicants" for
 * every live job whenever the applicant read was not available, which reads
 * as a measurement the product never made.
 */
function rowValue(
  job: { status: string; title: string },
  applicantCount: number | null
): string {
  if (job.status !== "Published") return job.status;
  if (applicantCount === null) return "Applicants unavailable";
  return `${applicantCount} applicant${applicantCount === 1 ? "" : "s"}`;
}

/**
 * Employer Jobs list (Figma screen 74, F13-D).
 *
 * Capacity comes from `getEmployerCapacity`, which reads the stored
 * subscription's plan limit — the same number the publish path enforces
 * server-side. An unrecognised tier yields a `null` limit, rendered as
 * unknown rather than as `0`, because "0 active jobs used" would be a false
 * statement about a plan the build does not recognise.
 */
export default async function EmployerJobsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [jobsResult, capacityResult, applicantsResult] = await Promise.all([
    getEmployerJobs(),
    getEmployerCapacity(),
    getCandidates(),
  ]);

  // One applicant read covers the whole list, so a published job's count is
  // the number of returned applicants on that job. Absent read -> null, which
  // renders as unavailable rather than as zero.
  const countsByJob = new Map<string, number>();
  if (applicantsResult.status === "ok") {
    for (const candidate of applicantsResult.data) {
      countsByJob.set(candidate.appliedJobId, (countsByJob.get(candidate.appliedJobId) ?? 0) + 1);
    }
  }

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

          {capacityResult.status === "ok" ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge
                capacity={{
                  activeJobCount: capacityResult.data.activeJobCount,
                  planLimit: capacityResult.data.planLimit,
                  planId: capacityResult.data.planId,
                }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <p className="muted">{capacityResult.reason}</p>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            {jobsResult.status === "ok" && jobsResult.data.length > 0 ? (
              <EmployerRowList>
                {jobsResult.data.map((job) => (
                  <EmployerRow
                    key={job.id}
                    label={job.title}
                    value={rowValue(
                      job,
                      applicantsResult.status === "ok"
                        ? (countsByJob.get(job.id) ?? 0)
                        : null
                    )}
                    href={`/employers/jobs/${job.id}`}
                  />
                ))}
              </EmployerRowList>
            ) : jobsResult.status === "ok" ? (
              <EmployerStatePanel
                kind="empty"
                title="No Jobs Yet"
                message="Post your first role to start receiving applicants."
                actionHref="/employers/post-job"
                actionLabel="Post a Job"
              />
            ) : (
              <EmployerStatePanel kind="error" title="Jobs aren't available yet" message={jobsResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
