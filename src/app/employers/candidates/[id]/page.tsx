import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import FitScorePanel from "@/components/employers/fit-score-panel";
import CandidateStageActions from "@/components/employers/candidate-stage-actions";
import ScoreApplicantButton from "@/components/employers/score-applicant-button";
import { getCandidateDetail } from "@/lib/employers/candidates-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import { STAGE_LABELS } from "@/lib/employers/stages";

/**
 * Candidate Detail (Figma screen 79, F13-J).
 *
 * MUST NOT show Odesseus Live transcripts/guidance, mock-interview feedback,
 * or post-interview analysis — those are candidate-only. Enforced at the type
 * level (CandidateDetail has no such field), at the adapter (it projects only
 * the hiring backend's applicant payload), and by
 * `tests/unit/employers-candidate-live-isolation.test.ts`.
 *
 * The Fit Score shown is the backend's persisted, evidence-backed row. It is
 * never computed here: an unscored applicant says so rather than displaying a
 * number this page invented.
 */
export default async function EmployerCandidateDetailPage({
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

  const [result, orgId] = await Promise.all([
    getCandidateDetail(id),
    getEmployerOrgId(),
  ]);

  if (result.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <h1>Applicant</h1>
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="This applicant isn't available"
                message={result.reason}
                actionHref="/employers/candidates"
                actionLabel="Back to Applicants"
              />
            </div>
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
          <h1>{candidate.name}</h1>
          <p className="muted">
            {candidate.appliedJobTitle}
            {candidate.location ? ` · ${candidate.location}` : ""}
          </p>

          <div style={{ marginTop: 20 }}>
            <EmployerRowList>
              <EmployerRow label="Stage" value={STAGE_LABELS[candidate.stage]} />
              <EmployerRow label="Applied" value={formatDate(candidate.appliedAt)} />
            </EmployerRowList>
          </div>

          {fitScore ? (
            <div style={{ marginTop: 20 }}>
              <EmployerRowList>
                <EmployerRow
                  label="Required qualifications"
                  value={`${fitScore.requiredMatches.length}/${requiredTotal || fitScore.requiredMatches.length}`}
                />
                <EmployerRow
                  label="Preferred qualifications"
                  value={`${fitScore.preferredMatches.length} matched`}
                />
              </EmployerRowList>
            </div>
          ) : null}

          <div style={{ marginTop: 20 }}>
            <FitScorePanel fitScore={fitScore} />
          </div>

          {candidate.requiredQualifications?.length ? (
            <article className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>
                Required qualifications at application
              </strong>
              <ul className="emp-fit-score-section">
                {candidate.requiredQualifications.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}

          {candidate.preferredQualifications?.length ? (
            <article className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>
                Preferred qualifications at application
              </strong>
              <ul className="emp-fit-score-section">
                {candidate.preferredQualifications.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}

          {fitScore ? null : (
            <div style={{ marginTop: 20 }}>
              <ScoreApplicantButton
                orgId={orgId ?? ""}
                applicationId={candidate.id}
                jobId={candidate.appliedJobId}
              />
            </div>
          )}

          <CandidateStageActions
            orgId={orgId ?? ""}
            applicationId={candidate.id}
            jobId={candidate.appliedJobId}
            currentStage={candidate.stage}
          />
        </section>
      </div>
    </main>
  );
}

/** Human date, or an explicit unknown rather than a fabricated one. */
function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "Not recorded";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
