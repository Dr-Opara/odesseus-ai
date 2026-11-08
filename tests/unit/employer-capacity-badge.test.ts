import { describe, expect, it } from "vitest";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

// EmployerCapacityBadge itself is a React component (no DOM renderer wired
// into this vitest project); these tests cover the locked plan-limit data it
// reads from, so a regression in the source numbers is caught even without
// a render harness. F13-G: frontend is display-only, never enforcement.

describe("employer plan credit allowance feeding the capacity badge", () => {
  it("locks the AI Starter Bundle to 5 base credits per 30-day cycle", () => {
    expect(EMPLOYER_PLANS.map((p) => [p.name, p.activeJobLimit])).toEqual([["AI Starter Bundle", 5]]);
  });
});
