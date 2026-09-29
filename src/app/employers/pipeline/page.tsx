import { requireEmployerPage } from "@/app/employers/guard";
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
 * Hiring Pipeline (Figma screen 80, F13-K). The locked stage set is a product
 * rule, so all seven stages render. Each row drills into the Applicants list
 * filtered to that stage, which is where an individual applicant is moved
 * (and where the optimistic transition can roll back).
 */
export default async function EmployerPipelinePage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job: jobId } = await searchParams;
  const { orgId } = await requireEmployerPage("/employers/pipeline");

  const [boardResult, jobResult] = await Promise.all([
    getPipelineBoard(orgId, jobId ? { jobId } : undefined),
    jobId ? getEmployerJob(orgId, jobId) : Promise.resolve(null),
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
              <>
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

                <div className="emp-row-list" style={{ marginTop: 20 }}>
                  {PIPELINE_STAGES.flatMap((stage) =>
                    boardResult.data[stage].map((candidate) => (
                      <EmployerRow
                        key={`${stage}-${candidate.id}`}
                        label={candidate.appliedJobTitle}
                        value={STAGE_LABELS[stage]}
                        href={`/employers/candidates/${candidate.id}`}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <EmployerStatePanel kind="error" title="We couldn't load your pipeline" message={boardResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
