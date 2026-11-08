import { describe, expect, it } from "vitest";
import { arbeitnowArrangement, isLikelyJobTitle } from "@/lib/jobs/aggregators/arbeitnow";

describe("arbeitnow normalization", () => {
  it("rejects a job title published as the company name", () => {
    expect(
      isLikelyJobTitle("Signal Processing Engineer (RF Processing & Analytics)", "FP&A Lead")
    ).toBe(true);
    expect(isLikelyJobTitle("Backend Developer", "Backend Developer")).toBe(true);
  });

  it("keeps real company names", () => {
    for (const name of ["Captify", "Keyrock", "Baseten", "Wemolo", "charlesriverassociates", "Bosch Engineering"]) {
      expect(isLikelyJobTitle(name, "Site Reliability Engineer")).toBe(false);
    }
  });

  it("derives remote from location text when the flag is false", () => {
    expect(arbeitnowArrangement(false, "Remote - Germany")).toBe("remote");
    expect(arbeitnowArrangement(false, "Berlin (Home-Office)")).toBe("remote");
    expect(arbeitnowArrangement(false, "Munich, Hybrid")).toBe("hybrid");
    expect(arbeitnowArrangement(false, "Paris")).toBe("on-site");
    expect(arbeitnowArrangement(true, undefined)).toBe("remote");
  });
});
