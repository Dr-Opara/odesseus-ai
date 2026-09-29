import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerJobs } from "@/lib/employers/jobs-adapter";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";

/** Employer Jobs list (Figma screen 74, F13-D). Counts and capacity are backend-sourced. */
export default async function EmployerJobsPage() {
  const { orgId } = await requireEmployerPage("/employers/jobs");

  const [jobsResult, billingResult] = await Promise.all([
    getEmployerJobs(orgId),
    getEmployerBilling(orgId),
  ]);

  const billing = billingResult.status === "ok" ? billingResult.data : null;
  const capacity =
    billing && billing.planId
      ? {
          activeJobCount: billing.capacity.published,
          planLimit: billing.capacity.included,
          planId: billing.planId,
        }
      : null;

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

          {capacity ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge capacity={capacity} />
            </div>
          ) : null}

          <div style={{ marginTop: 24 }}>
            {jobsResult.status === "ok" && jobsResult.data.length > 0 ? (
              <EmployerRowList>
                {jobsResult.data.map((job) => (
                  <EmployerRow
                    key={job.id}
                    label={job.title}
                    value={`${job.status}${job.featured ? " · Featured" : ""}`}
                    href={`/employers/jobs/${job.id}`}
                  />
                ))}
              </EmployerRowList>
            ) : jobsResult.status === "ok" ? (
              <EmployerStatePanel kind="empty" title="No Jobs Yet" message="Post your first role to start receiving applicants." actionHref="/employers/post-job" actionLabel="Post a Job" />
            ) : (
              <EmployerStatePanel kind="error" title="We couldn't load your jobs" message={jobsResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
