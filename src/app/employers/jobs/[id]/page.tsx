import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import JobDetailActions from "@/components/employers/job-detail-actions";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";

/** Employer Job Detail (Figma screen 77) — the click-through target from the Jobs list. */
export default async function EmployerJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireEmployerPage(`/employers/jobs/${id}`);

  const [jobResult, candidatesResult, billingResult] = await Promise.all([
    getEmployerJob(orgId, id),
    getCandidates(orgId, { jobId: id }),
    getEmployerBilling(orgId),
  ]);

  if (jobResult.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <EmployerStatePanel kind="error" title="We couldn't load this job" message={jobResult.reason} actionHref="/employers/jobs" actionLabel="Back to Jobs" />
          </section>
        </div>
      </main>
    );
  }

  const job = jobResult.data;
  const applicants = candidatesResult.status === "ok" ? candidatesResult.data : [];
  const billing = billingResult.status === "ok" ? billingResult.data : null;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>{job.title}</h1>
          <p className="muted">
            {[job.location, job.workArrangement, job.status].filter(Boolean).join(" · ")}
          </p>

          <div style={{ marginTop: 20 }}>
            <EmployerRowList>
              <EmployerRow label="Applicants" value={applicants.length} href={`/employers/candidates?job=${job.id}`} />
              <EmployerRow
                label="Strong Fits"
                value={applicants.filter((candidate) => typeof candidate.fitScoreOverall === "number" && candidate.fitScoreOverall >= 85).length}
              />
              <EmployerRow
                label="Interviews"
                value={applicants.filter((candidate) => candidate.stage === "INTERVIEW").length}
              />
              <EmployerRow label="Featured status" value={job.featured ? "Featured" : "Not featured"} />
              <EmployerRow
                label="Plan capacity"
                value={billing ? `${billing.capacity.published} of ${billing.capacity.included} active` : "Not available"}
              />
            </EmployerRowList>
          </div>

          {job.description ? (
            <div className="figma-info-card white" style={{ padding: 24, marginTop: 24 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>Job description</strong>
              <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {job.description}
              </p>
            </div>
          ) : null}

          {job.requiredQualificationsText || job.preferredQualificationsText ? (
            <div className="figma-two-grid" style={{ marginTop: 20 }}>
              {job.requiredQualificationsText ? (
                <article className="figma-info-card white" style={{ padding: 24 }}>
                  <strong style={{ display: "block", marginBottom: 10 }}>Required qualifications</strong>
                  <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {job.requiredQualificationsText}
                  </p>
                </article>
              ) : null}
              {job.preferredQualificationsText ? (
                <article className="figma-info-card white" style={{ padding: 24 }}>
                  <strong style={{ display: "block", marginBottom: 10 }}>Preferred qualifications</strong>
                  <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {job.preferredQualificationsText}
                  </p>
                </article>
              ) : null}
            </div>
          ) : null}

          <JobDetailActions job={job} orgId={orgId} />
        </section>
      </div>
    </main>
  );
}
