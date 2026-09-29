import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import FitScorePanel from "@/components/employers/fit-score-panel";
import { toPipelineStage, type PipelineStage } from "@/lib/employers/types";

/** Applicants / Candidates list (Figma screen 78, F13-H). No protected demographic attributes are rendered — none exist on the type at all. */
export default async function EmployerCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; stage?: string }>;
}) {
  const { job: jobId, stage } = await searchParams;
  const { orgId } = await requireEmployerPage("/employers/candidates");

  const stageFilter = stage ? toPipelineStage(stage) : undefined;
  const [candidatesResult, jobResult] = await Promise.all([
    getCandidates(orgId, { jobId, stage: stageFilter ?? undefined }),
    jobId ? getEmployerJob(orgId, jobId) : Promise.resolve(null),
  ]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Applicants</h1>
          <p className="muted">{jobResult?.status === "ok" ? jobResult.data.title : "All jobs"}</p>

          <div style={{ marginTop: 24 }}>
            {candidatesResult.status === "ok" && candidatesResult.data.length > 0 ? (
              <EmployerRowList>
                {candidatesResult.data.map((candidate) => (
                  <EmployerRow
                    key={candidate.id}
                    label={`${candidate.appliedJobTitle}${candidate.location ? ` · ${candidate.location}` : ""}`}
                    value={
                      <>
                        <FitScorePanel score={candidate.fitScoreOverall} compact />
                        {candidate.fitScoreOverall === undefined ? ` · ${stageLabel(candidate.stage)}` : ""}
                      </>
                    }
                    href={`/employers/candidates/${candidate.id}`}
                  />
                ))}
              </EmployerRowList>
            ) : candidatesResult.status === "ok" ? (
              <EmployerStatePanel kind="empty" title={stageFilter ? "No Applicants in This Stage" : "No Applicants Yet"} message="Applicants will appear here once they apply." />
            ) : (
              <EmployerStatePanel kind="error" title="We couldn't load applicants" message={candidatesResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function stageLabel(stage: PipelineStage): string {
  return stage.charAt(0) + stage.slice(1).toLowerCase();
}
