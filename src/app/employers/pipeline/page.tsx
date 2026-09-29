import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getPipelineBoard } from "@/lib/employers/pipeline-adapter";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import { PIPELINE_STAGES } from "@/lib/employers/types";

const STAGE_LABELS: Record<string, string> = {
  APPLIED: "Applied",
  REVIEWING: "Reviewing",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

/**
 * Hiring Pipeline (Figma screen 80, F13-K). Figma's example row list shows 6
 * of the 7 locked stages (no Rejected row in that particular mock) — the
 * locked stage set is a product rule, not a Figma styling choice, so all 7
 * render here. Each row drills into the Applicants list filtered to that
 * stage, which is where an individual candidate's stage actually gets moved
 * (via Candidate Detail's Move to Interview / Reject).
 */
export default async function EmployerPipelinePage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const { job: jobId } = await searchParams;
  const [boardResult, jobResult] = await Promise.all([
    getPipelineBoard(jobId ? { jobId } : undefined),
    jobId ? getEmployerJob(jobId) : Promise.resolve(null),
  ]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Hiring Pipeline</h1>
          <p className="muted">{jobResult?.status === "ok" ? jobResult.data.title : "All jobs"}</p>

          <div style={{ marginTop: 24 }}>
            {boardResult.status === "ok" ? (
              <EmployerRowList>
                {PIPELINE_STAGES.map((stage) => (
                  <EmployerRow
                    key={stage}
                    label={STAGE_LABELS[stage]}
                    value={boardResult.data[stage].length}
                    href={`/employers/candidates?stage=${stage}${jobId ? `&job=${jobId}` : ""}`}
                  />
                ))}
              </EmployerRowList>
            ) : (
              <EmployerStatePanel kind="error" title="Pipeline isn't available yet" message={boardResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
