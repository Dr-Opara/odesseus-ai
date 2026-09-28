import type { MatchAssessment } from "./schemas";

const weights = {
  requiredQualifications: 0.25,
  professionalExperience: 0.20,
  skillsAndTools: 0.20,
  roleAndSeniority: 0.10,
  industryDomain: 0.10,
  educationAndCertifications: 0.05,
  locationAndWorkArrangement: 0.05,
  candidatePreferences: 0.05,
} as const;

export function calculateMatchScore(assessment: MatchAssessment) {
  const dimensions = assessment.dimensions;

  const weighted =
    dimensions.requiredQualifications.score * weights.requiredQualifications +
    dimensions.professionalExperience.score * weights.professionalExperience +
    dimensions.skillsAndTools.score * weights.skillsAndTools +
    dimensions.roleAndSeniority.score * weights.roleAndSeniority +
    dimensions.industryDomain.score * weights.industryDomain +
    dimensions.educationAndCertifications.score * weights.educationAndCertifications +
    dimensions.locationAndWorkArrangement.score * weights.locationAndWorkArrangement +
    dimensions.candidatePreferences.score * weights.candidatePreferences;

  const criticalMissing = assessment.hardRequirements.filter(
    (item) => item.isCritical && item.status === "missing"
  );

  // A critical missing requirement keeps the score honest even when semantic
  // similarity elsewhere is high.
  const capped = criticalMissing.length ? Math.min(weighted, 69) : weighted;

  // A flat, deduplicated view across every dimension's gaps — the "what's
  // missing" list a candidate or the Application Agent can scan without
  // walking all eight dimensions individually.
  const missingKeywords = Array.from(
    new Set(Object.values(dimensions).flatMap((dimension) => dimension.gaps))
  );

  return {
    score: Math.round(capped),
    criticalMissing,
    missingKeywords,
    weights,
  };
}
