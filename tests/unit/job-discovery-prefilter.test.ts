import { describe, expect, it } from "vitest";
import { passesPreferencePrefilter } from "@/lib/jobs/prefilter";
import type { NormalizedJobPosting } from "@/lib/jobs/types";

const baseJob: NormalizedJobPosting = {
  provider: "greenhouse",
  sourceKey: "greenhouse:example",
  companyName: "Example",
  externalId: "1",
  title: "Senior Security Engineer",
  location: "Remote - US",
  workArrangement: "remote",
  employmentType: "Full-time",
  salaryText: null,
  description: "A long enough description for a security engineering position.",
  sourceUrl: "https://example.com/job",
  applyUrl: "https://example.com/job/apply",
  publishedAt: null,
  updatedAt: null,
};

const preferences = {
  target_titles: ["Security Engineer", "Cybersecurity Engineer"],
  target_locations: ["Remote"],
  employment_types: ["fulltime"],
  remote_only: true,
};

describe("job discovery preference prefilter", () => {
  it("keeps a relevant remote title", () => {
    expect(passesPreferencePrefilter(baseJob, preferences)).toBe(true);
  });

  it("rejects a non-remote job when remote-only is enabled", () => {
    expect(
      passesPreferencePrefilter(
        { ...baseJob, location: "Austin, TX", workArrangement: "on-site" },
        preferences
      )
    ).toBe(false);
  });

  it("rejects unrelated titles before spending a model call", () => {
    expect(
      passesPreferencePrefilter(
        { ...baseJob, title: "Senior Accountant" },
        preferences
      )
    ).toBe(false);
  });

  it("does not over-filter users without preferences", () => {
    expect(passesPreferencePrefilter(baseJob, null)).toBe(true);
  });
});
