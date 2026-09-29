import { describe, expect, it } from "vitest";
import { bucketApplicationsByDay, pipelineDistribution } from "@/lib/employer/analytics";

describe("pipelineDistribution (2S)", () => {
  it("counts history entries per stage", () => {
    expect(
      pipelineDistribution([
        { stage: "applied" },
        { stage: "applied" },
        { stage: "reviewing" },
        { stage: "hired" },
      ])
    ).toEqual({ applied: 2, reviewing: 1, hired: 1 });
  });

  it("returns an empty map for empty history", () => {
    expect(pipelineDistribution([])).toEqual({});
  });
});

describe("bucketApplicationsByDay (2S)", () => {
  const now = new Date("2026-02-10T12:00:00Z");

  it("buckets submissions into trailing UTC days", () => {
    const buckets = bucketApplicationsByDay(
      ["2026-02-10T08:00:00Z", "2026-02-10T09:00:00Z", "2026-02-08T23:59:59Z", null],
      3,
      now
    );
    expect(buckets).toEqual([
      { day: "2026-02-08", count: 1 },
      { day: "2026-02-09", count: 0 },
      { day: "2026-02-10", count: 2 },
    ]);
  });

  it("clamps out-of-window submissions", () => {
    const buckets = bucketApplicationsByDay(["2026-01-01T00:00:00Z"], 7, now);
    expect(buckets).toHaveLength(7);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });
});
