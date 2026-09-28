import { describe, expect, it } from "vitest";
import { decideApplicationAgentAction } from "@/lib/agent/decision-engine";
import type { AgentDecisionInput, AgentSettings, AgentTargetingRules } from "@/lib/agent/types";

function settings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    mode: "review",
    paused: false,
    minimum_match_score: 85,
    daily_application_limit: 10,
    default_apply_method: "apply",
    ...overrides,
  };
}

function rules(overrides: Partial<AgentTargetingRules> = {}): AgentTargetingRules {
  return {
    excluded_companies: [],
    excluded_titles: [],
    target_titles: [],
    industries: [],
    remote_allowed: true,
    hybrid_allowed: true,
    onsite_allowed: true,
    minimum_salary: null,
    ...overrides,
  };
}

function input(overrides: Partial<AgentDecisionInput> = {}): AgentDecisionInput {
  return {
    settings: settings(),
    rules: rules(),
    workAuthorization: null,
    job: {
      jobId: "job-1",
      matchScore: 90,
      companyName: "Acme Corp",
      roleTitle: "Backend Engineer",
      workArrangement: "remote",
      salaryMinCents: null,
      industry: null,
      sponsorshipOffered: null,
    },
    resumeId: "resume-1",
    autoApplyCountToday: 0,
    ...overrides,
  };
}

describe("decideApplicationAgentAction — structural gates (apply in every mode)", () => {
  it("returns AGENT_PAUSED when the agent is paused, regardless of mode", () => {
    for (const mode of ["review", "hybrid", "auto"] as const) {
      const result = decideApplicationAgentAction(
        input({ settings: settings({ mode, paused: true }) })
      );
      expect(result.decision).toBe("AGENT_PAUSED");
    }
  });

  it("returns DAILY_LIMIT_REACHED once today's count meets the configured limit", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto", daily_application_limit: 5 }),
        autoApplyCountToday: 5,
      })
    );
    expect(result.decision).toBe("DAILY_LIMIT_REACHED");
  });

  it("does not reach the daily limit gate while under the configured cap", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto", daily_application_limit: 5 }),
        autoApplyCountToday: 4,
      })
    );
    expect(result.decision).not.toBe("DAILY_LIMIT_REACHED");
  });

  it("returns MISSING_DATA when no resume is selected", () => {
    const result = decideApplicationAgentAction(
      input({ settings: settings({ mode: "auto" }), resumeId: null })
    );
    expect(result.decision).toBe("MISSING_DATA");
    expect(result.reasons.join(" ")).toContain("resume");
  });

  it("returns MISSING_DATA when the job has no computed Match Score", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto" }),
        job: { ...input().job, matchScore: null },
      })
    );
    expect(result.decision).toBe("MISSING_DATA");
    expect(result.reasons.join(" ")).toContain("Match Score");
  });
});

describe("decideApplicationAgentAction — REVIEW mode", () => {
  it("never auto-submits, even when every rule passes and the score is high", () => {
    const result = decideApplicationAgentAction(input({ settings: settings({ mode: "review" }) }));
    expect(result.decision).toBe("REQUIRES_REVIEW");
  });

  it("still requires review when rules fail, rather than reporting RULE_MISMATCH", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "review" }),
        rules: rules({ excluded_companies: ["Acme Corp"] }),
      })
    );
    expect(result.decision).toBe("REQUIRES_REVIEW");
  });
});

describe("decideApplicationAgentAction — HYBRID mode", () => {
  it("auto-applies only when every configured rule passes", () => {
    const result = decideApplicationAgentAction(input({ settings: settings({ mode: "hybrid" }) }));
    expect(result.decision).toBe("AUTO_APPLY");
  });

  it("queues for review instead of auto-submitting when a rule fails", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "hybrid" }),
        rules: rules({ excluded_titles: ["Backend"] }),
      })
    );
    expect(result.decision).toBe("REQUIRES_REVIEW");
  });

  it("queues for review rather than auto-submitting when the match score is below the agent floor", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "hybrid", minimum_match_score: 95 }),
        job: { ...input().job, matchScore: 90 },
      })
    );
    expect(result.decision).toBe("REQUIRES_REVIEW");
  });
});

describe("decideApplicationAgentAction — AUTO mode", () => {
  it("auto-applies when every required rule and data requirement is satisfied", () => {
    const result = decideApplicationAgentAction(input({ settings: settings({ mode: "auto" }) }));
    expect(result.decision).toBe("AUTO_APPLY");
    expect(result.applyMethod).toBe("apply");
  });

  it("reports RULE_MISMATCH (not a silent apply) when an excluded company is hit", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto" }),
        rules: rules({ excluded_companies: ["acme corp"] }),
      })
    );
    expect(result.decision).toBe("RULE_MISMATCH");
    expect(result.rulesEvaluated.find((r) => r.rule === "excluded_companies")?.passed).toBe(false);
  });

  it("reports RULE_MISMATCH when the work arrangement is not allowed", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto" }),
        rules: rules({ remote_allowed: false }),
        job: { ...input().job, workArrangement: "remote" },
      })
    );
    expect(result.decision).toBe("RULE_MISMATCH");
  });

  it("reports RULE_MISMATCH on a sponsorship conflict only when both sides are explicit", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto" }),
        workAuthorization: { authorized_without_sponsorship: false, sponsorship_required: true },
        job: { ...input().job, sponsorshipOffered: false },
      })
    );
    expect(result.decision).toBe("RULE_MISMATCH");
    expect(result.rulesEvaluated.find((r) => r.rule === "sponsorship")?.passed).toBe(false);
  });

  it("does not treat sponsorship as a conflict when the employer's stance is unstated", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto" }),
        workAuthorization: { authorized_without_sponsorship: false, sponsorship_required: true },
        job: { ...input().job, sponsorshipOffered: null },
      })
    );
    expect(result.decision).toBe("AUTO_APPLY");
  });

  it("never auto-submits below the agent's own minimum match score, even if job_preferences would show the job", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto", minimum_match_score: 90 }),
        job: { ...input().job, matchScore: 89 },
      })
    );
    expect(result.decision).toBe("RULE_MISMATCH");
  });

  it("is unaffected by a target_titles preference the role does not match, when target_titles is empty", () => {
    // Empty target_titles means "no restriction" — this only fails once a
    // title is actually configured.
    const result = decideApplicationAgentAction(input({ settings: settings({ mode: "auto" }) }));
    expect(result.decision).toBe("AUTO_APPLY");
  });

  it("reports RULE_MISMATCH when the role does not match any configured target title", () => {
    const result = decideApplicationAgentAction(
      input({
        settings: settings({ mode: "auto" }),
        rules: rules({ target_titles: ["Product Manager"] }),
      })
    );
    expect(result.decision).toBe("RULE_MISMATCH");
  });
});

describe("decideApplicationAgentAction — explainability", () => {
  it("persists which rules were evaluated and the score at decision time", () => {
    const result = decideApplicationAgentAction(input({ settings: settings({ mode: "auto" }) }));
    expect(result.matchScore).toBe(90);
    expect(result.mode).toBe("auto");
    expect(result.rulesEvaluated.length).toBeGreaterThan(0);
    expect(result.rulesEvaluated.every((rule) => typeof rule.detail === "string")).toBe(true);
  });
});
