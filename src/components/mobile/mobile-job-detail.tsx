import Link from "next/link";
import type { CSSProperties } from "react";
import type { z } from "zod";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobileSaveJob from "@/components/mobile/mobile-save-job";
import MobileTailorButton from "@/components/mobile/mobile-tailor-button";
import { matchAssessmentSchema } from "@/lib/ai/schemas";
import type { CandidateJob } from "@/lib/candidate/types";

type MatchAssessment = z.infer<typeof matchAssessmentSchema>;

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

/**
 * Mobile Match Results / job detail screen (screen 07) — real job record plus
 * its stored match assessment: score, summary, critical requirements, matched
 * strengths, gaps, dimension breakdown and required qualifications. Saved
 * state and the tailoring CTA reuse the same records and routes as desktop.
 */
export default function MobileJobDetail({
  job,
  assessment,
  saved,
}: {
  job: CandidateJob;
  assessment: MatchAssessment;
  saved: boolean;
}) {
  const score = job.match_score ?? 0;
  const criticalMissing = assessment.hardRequirements.filter(
    (item) => item.isCritical && item.status === "missing"
  );
  const evaluatedPoints = assessment.strongestMatches.length + assessment.biggestGaps.length;

  return (
    <MobileScreen
      index="07"
      eyebrow={job.company_name}
      title={job.role_title}
      lead={job.salary_text || "Salary not listed"}
      minHeight={844}
    >
      <div className="m-chip-strip">
        {job.work_arrangement ? <span className="m-chip-pill">{job.work_arrangement}</span> : null}
        {job.employment_type ? <span className="m-chip-pill">{job.employment_type}</span> : null}
      </div>

      <div className="m-detail-tabs">
        <span className="m-detail-tab is-active">Match Score</span>
        <a className="m-detail-tab" href="#skill-gaps">Skill Gaps</a>
        <a className="m-detail-tab" href="#resume-edits">Resume Edits</a>
      </div>

      <div className="m-score-ring-wrap">
        <div className="m-score-ring" style={{ "--pct": score } as CSSProperties}>
          <div className="m-score-ring-inner">
            <strong>{score}%</strong>
          </div>
        </div>
        <span className="m-score-ring-label">{scoreLabel(score)}</span>
      </div>

      <div className="m-summary-rows">
        <div className="m-summary-row">
          <span className="m-icon m-icon-green" aria-hidden="true">✓</span>
          <span className="m-summary-row-copy">Core skills match</span>
          <span className="m-summary-row-value" style={{ color: "var(--m-green)" }}>
            {evaluatedPoints ? `${assessment.strongestMatches.length}/${evaluatedPoints}` : "—"}
          </span>
        </div>
        <a className="m-summary-row" href="#skill-gaps">
          <span className="m-icon m-icon-orange" aria-hidden="true">↗</span>
          <span className="m-summary-row-copy">Skill gaps</span>
          <span className="m-summary-row-value" style={{ color: "var(--m-orange)" }}>
            {assessment.biggestGaps.length}
          </span>
        </a>
        <a className="m-summary-row" href="#resume-edits">
          <span className="m-icon m-icon-purple" aria-hidden="true">✦</span>
          <span className="m-summary-row-copy">Resume improvements</span>
          <span className="m-summary-row-value" style={{ color: "var(--m-purple)" }}>AI Suggested</span>
        </a>
      </div>

      <section className="m-card m-note-card">
        <strong>Odesseus’s read</strong>
        <p className="muted">{assessment.conciseSummary}</p>
      </section>

      {criticalMissing.length ? (
        <section className="m-warning">
          <strong>
            {criticalMissing.length === 1
              ? "1 critical requirement needs attention"
              : `${criticalMissing.length} critical requirements need attention`}
          </strong>
          {criticalMissing.map((item) => (
            <div key={item.requirement}>
              <div>{item.requirement}</div>
              <small>{item.evidence}</small>
            </div>
          ))}
        </section>
      ) : null}

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Strongest alignment</h2>
        </div>
        <div className="m-list">
          {assessment.strongestMatches.map((item) => (
            <div className="m-card" key={item}>
              <span className="m-icon">✓</span>
              <span className="m-copy">
                <small>{item}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="m-section" id="skill-gaps">
        <div className="m-section-heading">
          <h2>Gaps to know about</h2>
        </div>
        {assessment.biggestGaps.length ? (
          <div className="m-list">
            {assessment.biggestGaps.map((item) => (
              <div className="m-card" key={item}>
                <span className="m-icon">·</span>
                <span className="m-copy">
                  <small>{item}</small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="m-empty">
            No material gaps were identified from the job description.
          </div>
        )}
      </section>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Match breakdown</h2>
        </div>
        <div className="m-dimensions">
          {Object.entries(assessment.dimensions).map(([key, dimension]) => (
            <div className="m-dimension" key={key}>
              <div>
                <strong>{dimensionLabels[key] || key}</strong>
                <small>
                  {dimension.evidence[0] || dimension.gaps[0] || "No clear evidence"}
                </small>
              </div>
              <b>{Math.round(dimension.score)}%</b>
            </div>
          ))}
        </div>
      </section>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Required qualifications</h2>
        </div>
        {assessment.hardRequirements.length ? (
          <div className="m-list">
            {assessment.hardRequirements.map((item) => (
              <div className="m-card" key={item.requirement}>
                <span className="m-icon">
                  {item.status === "met" ? "✓" : item.status === "missing" ? "✕" : "·"}
                </span>
                <span className="m-copy">
                  <strong>{item.requirement}</strong>
                  <small>{item.evidence}</small>
                </span>
                <b className={`m-tag m-status-${item.status}`}>{item.status}</b>
              </div>
            ))}
          </div>
        ) : (
          <div className="m-empty">No explicit hard requirements were detected.</div>
        )}
      </section>

      <section className="m-next" id="resume-edits">
        <div>
          <strong>
            {score >= 85
              ? "This role cleared your match target."
              : "You decide whether this role is worth pursuing."}
          </strong>
          <p className="muted">
            Odesseus can tailor your resume to this role using only what is
            already verified in your profile.
          </p>
        </div>
        <MobileSaveJob jobId={job.id} isSaved={saved} />
        <MobileTailorButton jobId={job.id} />
        {job.source_url ? (
          <a
            className="m-secondary-link"
            href={job.source_url}
            target="_blank"
            rel="noreferrer"
          >
            View original posting ↗
          </a>
        ) : null}
      </section>
    </MobileScreen>
  );
}