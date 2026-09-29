import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import EditJobForm from "@/components/employers/edit-job-form";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";

/** Edit Job (Figma screen 76, F13-F). Loads the existing job and preserves its values. */
export default async function EmployerEditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireEmployerPage(`/employers/jobs/${id}/edit`);

  const jobResult = await getEmployerJob(orgId, id);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Edit Job</h1>
          {jobResult.status === "ok" ? <p className="muted">{jobResult.data.title}</p> : null}

          {jobResult.status === "ok" ? (
            <EditJobForm job={jobResult.data} orgId={orgId} />
          ) : (
            <div style={{ marginTop: 28 }}>
              <EmployerStatePanel kind="error" title="We couldn't load this job" message={jobResult.reason} actionHref="/employers/jobs" actionLabel="Back to Jobs" />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
