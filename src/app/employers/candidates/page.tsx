import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import PipelineStageBadge from "@/components/employers/pipeline-stage-badge";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import type { CandidateListItem, PipelineStage } from "@/lib/employers/types";

const VALID_STAGES = new Set(["APPLIED", "REVIEWING", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);

/**
 * The row value: a scored fit percentage, or the pipeline stage.
 *
 * The applicant's contact address is included when the backend supplied one,
 * because an employer triaging a pipeline needs to know who to reply to. It is
 * absent, not blank, when there is none, so the row never shows an empty
 * string that reads as "we tried and found nothing".
 */
function rowValue(candidate: CandidateListItem): ReactNode {
  const primary =
    typeof candidate.fitScoreOverall === "number" ? (
      `${Math.round(candidate.fitScoreOverall)}% Fit`
    ) : (
      <PipelineStageBadge stage={candidate.stage} />
    );
  return candidate.email ? (
    <>
      {primary} <span className="muted">· {candidate.email}</span>
    </>
  ) : (
    primary
  );
}

/** Applicants / Candidates list (Figma screen 78, F13-H). No protected demographic attributes are rendered — none exist on the type at all. */
export default async function EmployerCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; stage?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const { job: jobId, stage } = await searchParams;
  const stageFilter = stage && VALID_STAGES.has(stage) ? (stage as PipelineStage) : undefined;

  const [candidatesResult, jobResult] = await Promise.all([
    getCandidates({ jobId, stage: stageFilter }),
    jobId ? getEmployerJob(jobId) : Promise.resolve(null),
  ]);

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">APPLICANTS</span>
          <h1>Applicants</h1>
          <p className="muted">{jobResult?.status === "ok" ? jobResult.data.title : "All jobs"}</p>

          <div style={{ marginTop: 24 }}>
            {candidatesResult.status === "ok" && candidatesResult.data.length > 0 ? (
              <EmployerRowList>
                {candidatesResult.data.map((candidate) => (
                  <EmployerRow
                    key={candidate.id}
                    label={candidate.name}
                    value={rowValue(candidate)}
                    href={`/employers/candidates/${candidate.id}`}
                  />
                ))}
              </EmployerRowList>
            ) : candidatesResult.status === "ok" ? (
              <EmployerStatePanel kind="empty" title={stageFilter ? "No Candidates in This Stage" : "No Applicants Yet"} message="Candidates will appear here once they apply." />
            ) : (
              <EmployerStatePanel kind="error" title="Applicants aren't available yet" message={candidatesResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
