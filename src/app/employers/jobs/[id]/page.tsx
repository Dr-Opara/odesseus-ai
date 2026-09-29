import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import JobDetailActions from "@/components/employers/job-detail-actions";
import { getEmployerJob, getEmployerCapacity } from "@/lib/employers/jobs-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { STAGE_LABELS } from "@/lib/employers/stages";
import { parseJobDescription } from "@/lib/employers/job-description";
import { PIPELINE_STAGES } from "@/lib/employers/types";

/**
 * Employer Job Detail (Figma screen 77) — the click-through from the Jobs list.
 *
 * Every figure is a real count from the hiring backend:
 *
 *  - The applicant count is the length of the org's applicant list for this
 *    job, not a field on the job row. The backend's `employer_jobs` has no
 *    applicant column, so the number is counted from the applicants it did
 *    return. When that read fails, the row says so rather than showing `0` —
 *    "0 applicants" and "we could not load applicants" are different
 *    statements, and only the first would be a claim.
 *  - Stage counts come from each applicant's real pipeline stage.
 *  - Plan capacity is the stored subscription's allowance, the same number the
 *    publish path enforces server-side.
 */
export default async function EmployerJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [jobResult, candidatesResult, capacityResult, orgId] = await Promise.all([
    getEmployerJob(id),
    getCandidates({ jobId: id }),
    getEmployerCapacity(),
    getEmployerOrgId(),
  ]);

  if (jobResult.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <h1>Job</h1>
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="This job isn't available"
                message={jobResult.reason}
                actionHref="/employers/dashboard/jobs"
                actionLabel="Back to Jobs"
              />
            </div>
          </section>
        </div>
      </main>
    );
  }

  const job = jobResult.data;
  const description = parseJobDescription(job.description);
  const applicants = candidatesResult.status === "ok" ? candidatesResult.data : null;

  const stageCounts = applicants
    ? Object.fromEntries(
        PIPELINE_STAGES.map((stage) => [
          stage,
          applicants.filter((candidate) => candidate.stage === stage).length,
        ])
      )
    : null;

  const inInterviews = stageCounts ? stageCounts.INTERVIEW : null;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>{job.title}</h1>
          <p className="muted">
            {job.location ?? "Location not set"}
            {description.department ? ` · ${description.department}` : ""}
            {description.employmentType ? ` · ${description.employmentType}` : ""}
          </p>

          <div style={{ marginTop: 20 }}>
            <EmployerRowList>
              <EmployerRow
                label="Applicants"
                value={applicants ? applicants.length : "Not available"}
                href={applicants ? `/employers/candidates?job=${job.id}` : undefined}
              />
              <EmployerRow
                label="In interview"
                value={inInterviews === null ? "Not available" : inInterviews}
                href={inInterviews ? `/employers/pipeline?job=${job.id}` : undefined}
              />
              <EmployerRow
                label="Featured status"
                value={job.featured ? "Featured" : "None"}
                href={job.featured ? undefined : `/employers/jobs/${job.id}/feature`}
              />
              <EmployerRow
                label="Plan capacity"
                value={
                  capacityResult.status === "ok"
                    ? `${capacityResult.data.activeJobCount} of ${
                        capacityResult.data.planLimit ?? "—"
                      } active`
                    : "Not available"
                }
              />
              <EmployerRow label="Status" value={job.status} />
            </EmployerRowList>
          </div>

          {description.body ? (
            <article className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>About this role</strong>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.6 }}>{description.body}</p>
              {description.compensationText ? (
                <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
                  Compensation: {description.compensationText}
                </p>
              ) : null}
            </article>
          ) : null}

          {job.requiredQualifications?.length ? (
            <article className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>Required qualifications</strong>
              <ul className="emp-fit-score-section">
                {job.requiredQualifications.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}

          {applicants && applicants.length > 0 ? (
            <article className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>Pipeline</strong>
              <EmployerRowList>
                {PIPELINE_STAGES.filter((stage) => (stageCounts?.[stage] ?? 0) > 0).map((stage) => (
                  <EmployerRow
                    key={stage}
                    label={STAGE_LABELS[stage]}
                    value={stageCounts?.[stage] ?? 0}
                    href={`/employers/candidates?job=${job.id}&stage=${stage}`}
                  />
                ))}
              </EmployerRowList>
            </article>
          ) : null}

          <JobDetailActions job={job} orgId={orgId ?? ""} />

          <div className="emp-page-actions">
            <Link className="emp-btn-secondary" href="/employers/dashboard/jobs">
              Back to Jobs
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
