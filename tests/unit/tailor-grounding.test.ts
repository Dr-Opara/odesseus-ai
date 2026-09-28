import { describe, expect, it, vi } from "vitest";
import type { ResumeProfile } from "@/lib/ai/schemas";

// Proves the grounding gate is wired into tailorResume() itself, not just
// available as an unused utility: a model output with a fabricated skill
// must throw ResumeGroundingError and never reach the caller as a usable
// tailoring, regardless of how well-formed the rest of the output is.

const sourceResume: ResumeProfile = {
  summary: "Product-minded backend engineer.",
  yearsExperience: 4,
  currentOrRecentTitle: "Backend Engineer",
  industries: ["SaaS"],
  skills: ["Node.js", "PostgreSQL"],
  certifications: [],
  education: [],
  roles: [
    {
      title: "Backend Engineer",
      company: "Widget Co",
      start: "2021-06",
      end: null,
      responsibilities: ["Built the billing service"],
      achievements: [],
      skills: [],
    },
  ],
  verifiedFacts: [],
};

function mockGeneratedOutput(overrides: { skills: string[] }) {
  return {
    output: {
      tailoredResume: {
        headline: "Backend Engineer",
        professionalSummary: "Product-minded backend engineer.",
        skills: overrides.skills,
        roles: [
          {
            title: "Backend Engineer",
            company: "Widget Co",
            start: "2021-06",
            end: null,
            bullets: ["Built the billing service"],
          },
        ],
        education: [],
        certifications: [],
      },
      changes: [],
      notes: [],
    },
  };
}

describe("tailorResume grounding gate", () => {
  it("throws ResumeGroundingError instead of returning a fabricated skill", async () => {
    vi.resetModules();
    vi.doMock("ai", () => ({
      generateText: vi.fn(async () => mockGeneratedOutput({ skills: ["Rust", "Go"] })),
      Output: { object: (config: unknown) => ({ __schemaConfig: config }) },
    }));
    vi.doMock("@ai-sdk/openai", () => ({ openai: (model: string) => ({ __model: model }) }));

    const { tailorResume, ResumeGroundingError } = await import("@/lib/ai/tailor");

    await expect(
      tailorResume({
        resume: sourceResume,
        jobDescription: "Looking for a backend engineer with Rust experience.",
        matchBreakdown: {},
        companyName: "Target Co",
        roleTitle: "Backend Engineer",
      })
    ).rejects.toThrow(ResumeGroundingError);

    vi.doUnmock("ai");
    vi.doUnmock("@ai-sdk/openai");
  });

  it("returns the tailoring when every claim is grounded in the source resume", async () => {
    vi.resetModules();
    vi.doMock("ai", () => ({
      generateText: vi.fn(async () => mockGeneratedOutput({ skills: ["Node.js"] })),
      Output: { object: (config: unknown) => ({ __schemaConfig: config }) },
    }));
    vi.doMock("@ai-sdk/openai", () => ({ openai: (model: string) => ({ __model: model }) }));

    const { tailorResume } = await import("@/lib/ai/tailor");

    const result = await tailorResume({
      resume: sourceResume,
      jobDescription: "Looking for a Node.js backend engineer.",
      matchBreakdown: {},
      companyName: "Target Co",
      roleTitle: "Backend Engineer",
    });

    expect(result.tailoredResume.skills).toEqual(["Node.js"]);

    vi.doUnmock("ai");
    vi.doUnmock("@ai-sdk/openai");
  });
});
