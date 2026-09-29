import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import EditJobForm from "@/components/employers/edit-job-form";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";

/**
 * Edit Job (Figma screen 76, F13-F). Loads the existing job and preserves its
 * values.
 *
 * The backend only permits editing a draft. Rather than duplicating that rule
 * here, the page states it: a job that is published or closed is shown as
 * read-only with a link to the detail screen, where the real action is to
 * close it first. The server still refuses a non-draft edit regardless.
 */
export default async function EmployerEditJobPage({
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

  const [jobResult, orgId] = await Promise.all([getEmployerJob(id), getEmployerOrgId()]);

  if (jobResult.status !== "ok") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
            <h1>Edit Job</h1>
            <div style={{ marginTop: 28 }}>
              <EmployerStatePanel
                kind="error"
                title="This job isn't available"
                message={jobResult.reason}
                actionHref="/employers/jobs"
                actionLabel="Back to Jobs"
              />
            </div>
          </section>
        </div>
      </main>
    );
  }

  const job = jobResult.data;
  const isDraft = job.status === "Draft";

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Edit Job</h1>
          <p className="muted">{job.title}</p>

          {isDraft ? (
            <EditJobForm orgId={orgId ?? ""} job={job} />
          ) : (
            <div style={{ marginTop: 28 }}>
              <EmployerStatePanel
                kind="permission-denied"
                title="This job can no longer be edited."
                message={`It is ${job.status.toLowerCase()}. Close a published job before editing it, or post a new one.`}
                actionHref={`/employers/jobs/${job.id}`}
                actionLabel="Open the job"
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
