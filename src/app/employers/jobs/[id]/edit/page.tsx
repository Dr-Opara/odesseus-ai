import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import EditJobForm from "@/components/employers/edit-job-form";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";

/** Edit Job (Figma screen 76, F13-F). Loads the existing job and preserves its values. */
export default async function EmployerEditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const jobResult = await getEmployerJob(id);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Edit Job</h1>
          {jobResult.status === "ok" ? <p className="muted">{jobResult.data.title}</p> : null}

          {jobResult.status === "ok" ? (
            <EditJobForm job={jobResult.data} />
          ) : (
            <div style={{ marginTop: 28 }}>
              <EmployerStatePanel kind="error" title="This job isn't available yet" message={jobResult.reason} actionHref="/employers/jobs" actionLabel="Back to Jobs" />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
