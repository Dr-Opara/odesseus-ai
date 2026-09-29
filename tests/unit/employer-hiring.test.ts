import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES,
  STRONG_FIT_THRESHOLD,
  currentStages,
  isHiringManager,
  isPipelineStage,
} from "@/lib/employer/hiring";

describe("pipeline vocabulary (2R)", () => {
  it("locks exactly the seven approved stages", () => {
    expect([...PIPELINE_STAGES]).toEqual([
      "applied",
      "reviewing",
      "shortlisted",
      "interview",
      "offer",
      "hired",
      "rejected",
    ]);
  });

  it("narrows stage strings and rejects everything else", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(isPipelineStage(stage)).toBe(true);
    }
    expect(isPipelineStage("APPLIED")).toBe(false);
    expect(isPipelineStage("hired ")).toBe(false);
    expect(isPipelineStage("")).toBe(false);
    expect(isPipelineStage(null)).toBe(false);
    expect(isPipelineStage(undefined)).toBe(false);
    expect(isPipelineStage(42)).toBe(false);
  });
});

describe("hiring-manager authorization (2R)", () => {
  it("admits owner, admin, and recruiter only", () => {
    expect(isHiringManager("owner")).toBe(true);
    expect(isHiringManager("admin")).toBe(true);
    expect(isHiringManager("recruiter")).toBe(true);
    expect(isHiringManager("viewer")).toBe(false);
    expect(isHiringManager(null)).toBe(false);
  });
});

describe("pipeline current-stage derivation (2R)", () => {
  it("takes the latest history row per application", () => {
    expect(
      currentStages([
        { id: "1", jobId: "j1", applicationId: "a1", stage: "applied", changedBy: null, notes: null, createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", jobId: "j1", applicationId: "a1", stage: "reviewing", changedBy: "u1", notes: null, createdAt: "2026-01-02T00:00:00Z" },
        { id: "3", jobId: "j1", applicationId: "a2", stage: "applied", changedBy: null, notes: null, createdAt: "2026-01-01T00:00:00Z" },
      ])
    ).toEqual({ a1: "reviewing", a2: "applied" });
  });

  it("derives nothing from empty history", () => {
    expect(currentStages([])).toEqual({});
  });
});

describe("strong-fit threshold (2R)", () => {
  it("matches the candidate strong-match default of 85", () => {
    expect(STRONG_FIT_THRESHOLD).toBe(85);
  });
});
