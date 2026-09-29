import type { FitScore } from "@/lib/employers/types";

/**
 * Fit Score display (F13-I). OpenCode owns the calculation — this component
 * only ever renders a backend-provided `FitScore`; it never computes one and
 * never fabricates evidence. `compact` renders the overall score only (for
 * candidate list rows); the full panel renders qualification matches,
 * evidence, gaps, and blockers (for candidate detail).
 */
export default function FitScorePanel({
  fitScore,
  score,
  compact = false,
}: {
  fitScore?: FitScore;
  /** Overall score only, for list rows where the backend returned just the number. */
  score?: number;
  compact?: boolean;
}) {
  if (compact) {
    return typeof score === "number" ? (
      <span className="emp-fit-score">{Math.round(score)}% Fit</span>
    ) : (
      <span className="emp-fit-score is-unavailable">Fit Score not available</span>
    );
  }

  if (!fitScore) {
    return <span className="emp-fit-score is-unavailable">Fit Score not yet available</span>;
  }

  return (
    <div className="emp-fit-score-panel">
      <div className="emp-fit-score-overall">{Math.round(fitScore.overall)}% Fit</div>

      {fitScore.blockers.length > 0 ? (
        <div className="emp-fit-score-section is-blocker">
          <strong>Blockers</strong>
          <ul>
            {fitScore.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {fitScore.requiredMatches.length > 0 ? (
        <div className="emp-fit-score-section">
          <strong>Required qualifications met</strong>
          <ul>
            {fitScore.requiredMatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {fitScore.preferredMatches.length > 0 ? (
        <div className="emp-fit-score-section">
          <strong>Preferred qualifications met</strong>
          <ul>
            {fitScore.preferredMatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {fitScore.resumeEvidence.length > 0 ? (
        <div className="emp-fit-score-section">
          <strong>Resume evidence</strong>
          <ul>
            {fitScore.resumeEvidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {fitScore.missingQualifications.length > 0 || fitScore.missingSkills.length > 0 ? (
        <div className="emp-fit-score-section is-missing">
          <strong>Missing</strong>
          <ul>
            {[...fitScore.missingQualifications, ...fitScore.missingSkills].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {typeof fitScore.locationAlignment === "boolean" ? (
        <div className="emp-fit-score-section">
          <strong>Location / work-mode alignment</strong>
          <span>{fitScore.locationAlignment ? "Aligned" : "Not aligned"}</span>
        </div>
      ) : null}

      {fitScore.explanation ? (
        <div className="emp-fit-score-section">
          <strong>Why this score</strong>
          <span>{fitScore.explanation}</span>
        </div>
      ) : null}
    </div>
  );
}
