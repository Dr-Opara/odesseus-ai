import { describe, expect, it } from "vitest";
import { calculateMatchScore } from "@/lib/ai/scoring";
import type { MatchAssessment } from "@/lib/ai/schemas";

function dimension(score: number) {
  return { score, evidence: [], gaps: [] };
}

function baseAssessment(overrides: Partial<MatchAssessment> = {}): MatchAssessment {
  return {
    companyName: "Acme",
    roleTitle: "Software Engineer",
    location: null,
    workArrangement: null,
    employmentType: null,
    salaryText: null,
    hardRequirements: [],
    dimensions: {
      requiredQualifications: dimension(100),
      professionalExperience: dimension(100),
      skillsAndTools: dimension(100),
      roleAndSeniority: dimension(100),
      industryDomain: dimension(100),
      educationAndCertifications: dimension(100),
      locationAndWorkArrangement: dimension(100),
      candidatePreferences: dimension(100),
    },
    strongestMatches: [],
    biggestGaps: [],
    conciseSummary: "",
    salaryCompatibility: { status: "unknown", explanation: "" },
    sponsorshipCompatibility: { status: "unknown", explanation: "" },
    ...overrides,
  };
}

describe("calculateMatchScore", () => {
  it("returns 100 when every weighted dimension is a perfect score", () => {
    const result = calculateMatchScore(baseAssessment());
    expect(result.score).toBe(100);
    expect(result.criticalMissing).toHaveLength(0);
  });

  it("computes the documented weighted average across all eight dimensions", () => {
    const assessment = baseAssessment({
      dimensions: {
        requiredQualifications: dimension(80), // 0.25
        professionalExperience: dimension(60), // 0.20
        skillsAndTools: dimension(90), // 0.20
        roleAndSeniority: dimension(70), // 0.10
        industryDomain: dimension(50), // 0.10
        educationAndCertifications: dimension(100), // 0.05
        locationAndWorkArrangement: dimension(100), // 0.05
        candidatePreferences: dimension(40), // 0.05
      },
    });

    // 80*.25 + 60*.2 + 90*.2 + 70*.1 + 50*.1 + 100*.05 + 100*.05 + 40*.05
    // = 20 + 12 + 18 + 7 + 5 + 5 + 5 + 2 = 74
    const result = calculateMatchScore(assessment);
    expect(result.score).toBe(74);
  });

  it("rounds the final weighted score to the nearest integer", () => {
    const assessment = baseAssessment({
      dimensions: {
        requiredQualifications: dimension(77),
        professionalExperience: dimension(77),
        skillsAndTools: dimension(77),
        roleAndSeniority: dimension(77),
        industryDomain: dimension(77),
        educationAndCertifications: dimension(77),
        locationAndWorkArrangement: dimension(77),
        candidatePreferences: dimension(77),
      },
    });
    expect(calculateMatchScore(assessment).score).toBe(77);
  });

  it("caps the score at 69 when a critical requirement is missing, even with a perfect semantic score", () => {
    const assessment = baseAssessment({
      hardRequirements: [
        {
          requirement: "Active security clearance",
          status: "missing",
          evidence: "No clearance mentioned anywhere in verified profile.",
          isCritical: true,
        },
      ],
    });

    const result = calculateMatchScore(assessment);
    expect(result.score).toBe(69);
    expect(result.criticalMissing).toHaveLength(1);
  });

  it("does not cap the score when the missing requirement is not critical", () => {
    const assessment = baseAssessment({
      hardRequirements: [
        {
          requirement: "Nice-to-have certification",
          status: "missing",
          evidence: "Not present, but not required.",
          isCritical: false,
        },
      ],
    });

    expect(calculateMatchScore(assessment).score).toBe(100);
  });

  it("does not cap the score when a critical requirement is only partially met, not missing", () => {
    const assessment = baseAssessment({
      hardRequirements: [
        {
          requirement: "5+ years of experience",
          status: "partial",
          evidence: "3 years of directly relevant experience.",
          isCritical: true,
        },
      ],
    });

    expect(calculateMatchScore(assessment).score).toBe(100);
  });

  it("caps at 69 rather than raising a low uncapped score, when multiple critical requirements are missing", () => {
    const assessment = baseAssessment({
      dimensions: {
        requiredQualifications: dimension(20),
        professionalExperience: dimension(20),
        skillsAndTools: dimension(20),
        roleAndSeniority: dimension(20),
        industryDomain: dimension(20),
        educationAndCertifications: dimension(20),
        locationAndWorkArrangement: dimension(20),
        candidatePreferences: dimension(20),
      },
      hardRequirements: [
        { requirement: "A", status: "missing", evidence: "", isCritical: true },
        { requirement: "B", status: "missing", evidence: "", isCritical: true },
      ],
    });

    // Uncapped weighted score (20) is already below the 69 cap, so the cap
    // must not raise it back up to 69.
    const result = calculateMatchScore(assessment);
    expect(result.score).toBe(20);
    expect(result.criticalMissing).toHaveLength(2);
  });

  it("flattens and deduplicates gaps across every dimension into missingKeywords", () => {
    const assessment = baseAssessment({
      dimensions: {
        requiredQualifications: { score: 60, evidence: [], gaps: ["Kubernetes", "Terraform"] },
        professionalExperience: { score: 60, evidence: [], gaps: [] },
        skillsAndTools: { score: 60, evidence: [], gaps: ["Terraform", "Go"] },
        roleAndSeniority: dimension(100),
        industryDomain: dimension(100),
        educationAndCertifications: dimension(100),
        locationAndWorkArrangement: dimension(100),
        candidatePreferences: dimension(100),
      },
    });

    const result = calculateMatchScore(assessment);
    expect(result.missingKeywords.sort()).toEqual(["Go", "Kubernetes", "Terraform"]);
  });

  it("returns an empty missingKeywords list when no dimension reports a gap", () => {
    expect(calculateMatchScore(baseAssessment()).missingKeywords).toEqual([]);
  });
});
