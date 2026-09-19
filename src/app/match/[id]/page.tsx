import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchAssessmentSchema } from "@/lib/ai/schemas";
import TailorButton from "@/components/tailor-button";

const dimensionLabels: Record<string, string> = {
  requiredQualifications: "Required qualifications",
  professionalExperience: "Professional experience",
  skillsAndTools: "Skills & tools",
  roleAndSeniority: "Role & seniority",
  industryDomain: "Industry & domain",
  educationAndCertifications: "Education & certifications",
  locationAndWorkArrangement: "Location & work style",
  candidatePreferences: "Your preferences",
};

function scoreLabel(score: number) {
  if (score >= 85) return "Strong match";
  if (score >= 70) return "Worth a closer look";
  return "Below your target";
}

export default async function MatchResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: job } = await supabase
    .from("job_opportunities")
    .select("id,company_name,role_title,location,match_score,match_breakdown,status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!job) notFound();

  const parsed = matchAssessmentSchema.safeParse(job.match_breakdown);
  if (!parsed.success) notFound();

  const assessment = parsed.data;
  const score = job.match_score ?? 0;
  const criticalMissing = assessment.hardRequirements.filter(
    (item) => item.isCritical && item.status === "missing"
  );

  return (
    <main className="shell" style={{ padding: "54px 0 90px" }}>
      <Link href="/dashboard" className="wordmark">Odysseus</Link>

      <div style={{ width: "min(900px,100%)", margin: "64px auto 0" }}>
        <Link href="/match" className="muted" style={{ fontSize: 14 }}>← Check another role</Link>

        <div className="match-result-header">
          <div>
            <div className="badge">{scoreLabel(score)}</div>
            <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "16px 0 8px" }}>
              {job.role_title}
            </h1>
            <p className="muted" style={{ fontSize: 18, margin: 0 }}>
              {job.company_name}{job.location ? ` · ${job.location}` : ""}
            </p>
          </div>

          <div className="score-orb">
            <strong>{score}%</strong>
            <span>match</span>
          </div>
        </div>

        <div className="card" style={{ padding: 28, marginTop: 30 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>Odysseus’s read</h2>
          <p className="muted" style={{ lineHeight: 1.65, margin: 0 }}>{assessment.conciseSummary}</p>

          {criticalMissing.length ? (
            <div className="match-warning">
              <strong>{criticalMissing.length === 1 ? "1 critical requirement needs attention" : `${criticalMissing.length} critical requirements need attention`}</strong>
              {criticalMissing.map((item) => (
                <div key={item.requirement} style={{ marginTop: 10 }}>
                  <div>{item.requirement}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{item.evidence}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="match-two-column">
          <div className="card" style={{ padding: 26 }}>
            <div className="muted" style={{ fontSize: 13 }}>Strongest alignment</div>
            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              {assessment.strongestMatches.map((item) => (
                <div key={item} className="match-evidence-line">
                  <span className="match-check">✓</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 26 }}>
            <div className="muted" style={{ fontSize: 13 }}>Gaps to know about</div>
            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              {assessment.biggestGaps.length ? assessment.biggestGaps.map((item) => (
                <div key={item} className="match-evidence-line">
                  <span className="match-gap-dot">·</span>
                  <span>{item}</span>
                </div>
              )) : (
                <div className="muted">No material gaps were identified from the job description.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 26, marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginBottom: 8 }}>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Why this score</div>
              <h2 style={{ fontSize: 24, margin: "7px 0 0" }}>Match breakdown</h2>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>Your target: 85%+</span>
          </div>

          {Object.entries(assessment.dimensions).map(([key, dimension]) => (
            <div className="dimension-row" key={key}>
              <div>
                <strong>{dimensionLabels[key] || key}</strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {dimension.evidence[0] || dimension.gaps[0] || "No clear evidence"}
                </div>
              </div>
              <div className="dimension-score">{Math.round(dimension.score)}%</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 26, marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 13 }}>Required qualifications</div>
          <div style={{ marginTop: 10 }}>
            {assessment.hardRequirements.length ? assessment.hardRequirements.map((item) => (
              <div className="requirement-row" key={item.requirement}>
                <div>
                  <strong>{item.requirement}</strong>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{item.evidence}</div>
                </div>
                <span className={`requirement-status requirement-${item.status}`}>{item.status}</span>
              </div>
            )) : (
              <div className="muted" style={{ paddingTop: 10 }}>No explicit hard requirements were detected.</div>
            )}
          </div>
        </div>

        <div className="match-next-card">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Next step</div>
            <h2 style={{ fontSize: 25, margin: "7px 0 5px" }}>
              {score >= 85 ? "This role cleared your match target." : "You decide whether this role is worth pursuing."}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Odysseus can tailor your resume to this role using only the experience and qualifications already verified in your profile.
            </p>
          </div>
          <TailorButton jobId={job.id} />
        </div>
      </div>
    </main>
  );
}
