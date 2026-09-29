import { describe, expect, it } from "vitest";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

// EmployerCapacityBadge itself is a React component (no DOM renderer wired
// into this vitest project); these tests cover the locked plan-limit data it
// reads from, so a regression in the source numbers is caught even without
// a render harness. F13-G: frontend is display-only, never enforcement.

describe("employer plan active-job limits feeding the capacity badge", () => {
  it("locks Starter/Growth/Business to 3/10/25 active jobs", () => {
    expect(EMPLOYER_PLANS.map((p) => [p.name, p.activeJobLimit])).toEqual([
      ["Starter", 3],
      ["Growth", 10],
      ["Business", 25],
    ]);
  });
});
