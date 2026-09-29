import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import FitScorePanel from "@/components/employers/fit-score-panel";
import CandidateStageActions from "@/components/employers/candidate-stage-actions";
import { getCandidateDetail } from "@/lib/employers/candidates-adapter";

/**
 * Candidate Detail (Figma screen 79, F13-J). MUST NOT show Odesseus Live
 * transcript/guidance, mock-interview feedback, or post-interview analysis —
 * enforced at the type level (CandidateDetail has no such field) and by
 * tests/unit/employers-candidate-live-isolation.test.ts.
 */
export default async function EmployerCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireEmployerPage(`/employers/candidates/${id}`);

  const result = await getCandidateDetail(orgId, id);

  if (result.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <EmployerStatePanel kind="error" title="We couldn't load this applicant" message={result.reason} actionHref="/employers/candidates" actionLabel="Back to Applicants" />
          </section>
        </div>
      </main>
    );
  }

  const candidate = result.data;
  const fitScore = candidate.fitScore;
  const requiredTotal = fitScore
    ? fitScore.requiredMatches.length + fitScore.missingQualifications.length
    : 0;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Applicant</h1>
          <p className="muted">
            {candidate.appliedJobTitle}
            {candidate.location ? ` · ${candidate.location}` : ""}
          </p>

          <div style={{ marginTop: 20 }}>
            <EmployerRowList>
              <EmployerRow label="Applied for" value={candidate.appliedJobTitle} href={`/employers/candidates?job=${candidate.appliedJobId}`} />
              {fitScore ? (
                <EmployerRow
                  label="Required qualifications"
                  value={`${fitScore.requiredMatches.length}/${requiredTotal || fitScore.requiredMatches.length}`}
                />
              ) : null}
              {fitScore ? (
                <EmployerRow label="Preferred qualifications" value={`${fitScore.preferredMatches.length} matched`} />
              ) : null}
            </EmployerRowList>
          </div>

          <div style={{ marginTop: 20 }}>
            <FitScorePanel fitScore={fitScore} />
          </div>

          {candidate.requiredQualificationsText || candidate.preferredQualificationsText ? (
            <div className="figma-two-grid" style={{ marginTop: 20 }}>
              {candidate.requiredQualificationsText ? (
                <article className="figma-info-card white" style={{ padding: 24 }}>
                  <strong style={{ display: "block", marginBottom: 10 }}>Role requirements</strong>
                  <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {candidate.requiredQualificationsText}
                  </p>
                </article>
              ) : null}
              {candidate.preferredQualificationsText ? (
                <article className="figma-info-card white" style={{ padding: 24 }}>
                  <strong style={{ display: "block", marginBottom: 10 }}>Nice to have</strong>
                  <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {candidate.preferredQualificationsText}
                  </p>
                </article>
              ) : null}
            </div>
          ) : null}

          <CandidateStageActions
            orgId={orgId}
            candidateId={candidate.id}
            jobId={candidate.appliedJobId}
            currentStage={candidate.stage}
          />
        </section>
      </div>
    </main>
  );
}
