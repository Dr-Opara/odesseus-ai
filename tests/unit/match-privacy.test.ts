import { describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: (options: Record<string, unknown>) => generateTextMock(options),
  Output: { object: (config: unknown) => config },
}));

import { assessJobMatch, publicAccountProfile } from "@/lib/ai/match";

const dimension = (score = 50) => ({
  score,
  evidence: ["candidate evidence"],
  gaps: ["gap"],
});

const fakeAssessment = {
  companyName: "Acme",
  roleTitle: "Engineer",
  location: null,
  workArrangement: null,
  employmentType: null,
  salaryText: null,
  hardRequirements: [],
  dimensions: {
    requiredQualifications: dimension(60),
    professionalExperience: dimension(50),
    skillsAndTools: dimension(55),
    roleAndSeniority: dimension(50),
    industryDomain: dimension(40),
    educationAndCertifications: dimension(30),
    locationAndWorkArrangement: dimension(70),
    candidatePreferences: dimension(65),
  },
};

describe("match prompt privacy", () => {
  it("never sends the application contact email to the model", async () => {
    generateTextMock.mockResolvedValue({ output: fakeAssessment });

    const profile = {
      full_name: "Ada Lovelace",
      headline: "Engineer",
      country_code: "GB",
      application_contact_email: "ada@example.com",
    };

    await assessJobMatch({
      resume: {} as Parameters<typeof assessJobMatch>[0]["resume"],
      profile,
      preferences: null,
      jobDescription: "Build reliable software.",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const options = generateTextMock.mock.calls[0][0] as { prompt: string };

    expect(options.prompt).toContain("Ada Lovelace");
    expect(options.prompt).toContain("GB");
    expect(options.prompt).not.toContain("ada@example.com");
    expect(options.prompt).not.toContain("application_contact_email");
  });

  it("strips only the private contact field from the account profile", () => {
    expect(
      publicAccountProfile({
        headline: "Engineer",
        application_contact_email: "private@example.com",
      })
    ).toEqual({ headline: "Engineer" });
  });
});
