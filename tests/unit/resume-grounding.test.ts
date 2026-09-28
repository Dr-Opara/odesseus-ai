import { describe, expect, it } from "vitest";
import { verifyResumeGrounding } from "@/lib/ai/resume-grounding";
import type { ResumeProfile, ResumeTailoringOutput } from "@/lib/ai/schemas";

const sourceResume: ResumeProfile = {
  summary: "Backend engineer focused on distributed systems.",
  yearsExperience: 6,
  currentOrRecentTitle: "Senior Backend Engineer",
  industries: ["Fintech"],
  skills: ["TypeScript", "PostgreSQL", "AWS"],
  certifications: ["AWS Certified Solutions Architect"],
  education: [{ degree: "B.S. Computer Science", field: null, institution: "State University" }],
  roles: [
    {
      title: "Senior Backend Engineer",
      company: "Acme Corp",
      start: "2022-01",
      end: null,
      responsibilities: ["Owned the payments ledger service"],
      achievements: ["Cut p99 latency by 40% by rewriting the settlement job in Rust"],
      skills: ["Rust", "Kafka"],
    },
  ],
  verifiedFacts: ["Led a team of 3 engineers", "Migrated the ledger off a monolith"],
};

function groundedTailoring(): ResumeTailoringOutput {
  return {
    tailoredResume: {
      headline: "Senior Backend Engineer",
      professionalSummary: "Backend engineer focused on distributed systems.",
      skills: ["TypeScript", "AWS"],
      roles: [
        {
          title: "Senior Backend Engineer",
          company: "Acme Corp",
          start: "2022-01",
          end: null,
          bullets: ["Owned the payments ledger service"],
        },
      ],
      education: [{ degree: "B.S. Computer Science", field: null, institution: "State University" }],
      certifications: ["AWS Certified Solutions Architect"],
    },
    changes: [
      {
        type: "reorder",
        section: "skills",
        original: null,
        revised: null,
        reason: "Prioritized cloud skills the job description asks for.",
        verifiedEvidence: ["AWS"],
      },
    ],
    notes: [],
  };
}

describe("verifyResumeGrounding", () => {
  it("approves a tailoring whose every claim traces back to the source resume", () => {
    expect(verifyResumeGrounding(sourceResume, groundedTailoring())).toEqual({ ok: true });
  });

  it("rejects a fabricated skill the source resume never mentions", () => {
    const tailored = groundedTailoring();
    tailored.tailoredResume.skills = ["Kubernetes"];

    const result = verifyResumeGrounding(sourceResume, tailored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toEqual([
        { section: "skills", detail: 'unsupported skill: "Kubernetes"' },
      ]);
    }
  });

  it("rejects a fabricated certification", () => {
    const tailored = groundedTailoring();
    tailored.tailoredResume.certifications = ["PMP"];

    const result = verifyResumeGrounding(sourceResume, tailored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].section).toBe("certifications");
    }
  });

  it("rejects a role at an employer that never appears in the source resume", () => {
    const tailored = groundedTailoring();
    tailored.tailoredResume.roles = [
      { title: "Staff Engineer", company: "Fabricated Inc", start: "2023-01", end: null, bullets: [] },
    ];

    const result = verifyResumeGrounding(sourceResume, tailored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].section).toBe("roles");
      expect(result.violations[0].detail).toContain("Fabricated Inc");
    }
  });

  it("rejects a role whose dates were altered from the source resume", () => {
    const tailored = groundedTailoring();
    tailored.tailoredResume.roles[0].start = "2019-01";

    const result = verifyResumeGrounding(sourceResume, tailored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].section).toBe("roles");
    }
  });

  it("rejects a change whose cited evidence does not appear anywhere in the source resume", () => {
    const tailored = groundedTailoring();
    tailored.changes = [
      {
        type: "emphasize",
        section: "summary",
        original: null,
        revised: null,
        reason: "Made the candidate sound more senior.",
        verifiedEvidence: ["Promoted to VP of Engineering"],
      },
    ];

    const result = verifyResumeGrounding(sourceResume, tailored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].section).toBe("changes");
      expect(result.violations[0].detail).toContain("Promoted to VP of Engineering");
    }
  });

  it("accepts evidence drawn from verifiedFacts and role achievements, not just top-level skills", () => {
    const tailored = groundedTailoring();
    tailored.changes = [
      {
        type: "rewrite",
        section: "roles.0.bullets.0",
        original: "Owned the payments ledger service",
        revised: "Owned the payments ledger service, cutting p99 latency by 40%",
        reason: "Surfaced a quantified achievement already on the resume.",
        verifiedEvidence: ["Cut p99 latency by 40% by rewriting the settlement job in Rust"],
      },
    ];

    expect(verifyResumeGrounding(sourceResume, tailored)).toEqual({ ok: true });
  });
});
