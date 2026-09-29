import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
 * tests/unit/employers-candidate-live-isolation.test.ts (Checkpoint 2).
 */
export default async function EmployerCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const result = await getCandidateDetail(id);

  if (result.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <EmployerStatePanel kind="error" title="This candidate isn't available yet" message={result.reason} actionHref="/employers/candidates" actionLabel="Back to Applicants" />
          </section>
        </div>
      </main>
    );
  }

  const candidate = result.data;
  const fitScore = candidate.fitScore;
  const requiredTotal = fitScore ? fitScore.requiredMatches.length + fitScore.missingQualifications.length : 0;

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

          {fitScore ? (
            <div style={{ marginTop: 20 }}>
              <EmployerRowList>
                <EmployerRow label="Required qualifications" value={`${fitScore.requiredMatches.length}/${requiredTotal || fitScore.requiredMatches.length}`} />
                <EmployerRow label="Preferred qualifications" value={`${fitScore.preferredMatches.length} matched`} />
              </EmployerRowList>
            </div>
          ) : null}

          <div style={{ marginTop: 20 }}>
            <FitScorePanel fitScore={fitScore} />
          </div>

          {candidate.applicationAnswers && candidate.applicationAnswers.length > 0 ? (
            <div className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>Application answers</strong>
              {candidate.applicationAnswers.map((a) => (
                <p key={a.question} style={{ marginBottom: 10 }}>
                  <strong>{a.question}</strong>
                  <br />
                  {a.answer}
                </p>
              ))}
            </div>
          ) : null}

          {candidate.employerNotes && candidate.employerNotes.length > 0 ? (
            <div className="figma-info-card white" style={{ padding: 24, marginTop: 20 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>Employer notes</strong>
              {candidate.employerNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}

          <CandidateStageActions candidateId={candidate.id} currentStage={candidate.stage} />
        </section>
      </div>
    </main>
  );
}
