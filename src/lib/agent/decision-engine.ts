import type {
  AgentDecisionInput,
  AgentDecisionResult,
  RuleEvaluation,
} from "./types";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function evaluateRules(input: AgentDecisionInput): RuleEvaluation[] {
  const { rules, job, workAuthorization } = input;
  const evaluations: RuleEvaluation[] = [];

  const excludedCompany = rules.excluded_companies.some(
    (company) => normalize(company) === normalize(job.companyName)
  );
  evaluations.push({
    rule: "excluded_companies",
    passed: !excludedCompany,
    detail: excludedCompany
      ? `${job.companyName} is on the excluded-companies list.`
      : "Employer is not excluded.",
  });

  const excludedTitle = rules.excluded_titles.some((title) =>
    normalize(job.roleTitle).includes(normalize(title))
  );
  evaluations.push({
    rule: "excluded_titles",
    passed: !excludedTitle,
    detail: excludedTitle
      ? `"${job.roleTitle}" matches an excluded title.`
      : "Title is not excluded.",
  });

  if (rules.target_titles.length > 0) {
    const matchesTarget = rules.target_titles.some((title) =>
      normalize(job.roleTitle).includes(normalize(title)) ||
      normalize(title).includes(normalize(job.roleTitle))
    );
    evaluations.push({
      rule: "target_titles",
      passed: matchesTarget,
      detail: matchesTarget
        ? "Title matches a target title."
        : `"${job.roleTitle}" does not match any target title.`,
    });
  }

  if (rules.industries.length > 0 && job.industry) {
    const industryAllowed = rules.industries.some(
      (industry) => normalize(industry) === normalize(job.industry as string)
    );
    evaluations.push({
      rule: "industries",
      passed: industryAllowed,
      detail: industryAllowed
        ? `${job.industry} is an allowed industry.`
        : `${job.industry} is not in the allowed industries list.`,
    });
  }

  if (job.workArrangement) {
    const allowedByArrangement =
      (job.workArrangement === "remote" && rules.remote_allowed) ||
      (job.workArrangement === "hybrid" && rules.hybrid_allowed) ||
      (job.workArrangement === "on-site" && rules.onsite_allowed);
    evaluations.push({
      rule: "work_arrangement",
      passed: allowedByArrangement,
      detail: allowedByArrangement
        ? `${job.workArrangement} matches allowed work arrangements.`
        : `${job.workArrangement} is not an allowed work arrangement.`,
    });
  }

  // Salary and sponsorship are only ever evaluated when BOTH sides have
  // stated an explicit position — silence on either side is never treated
  // as a conflict, matching the Match Score's compatibility fields.
  if (rules.minimum_salary != null && job.salaryMinCents != null) {
    const meetsMinimum = job.salaryMinCents >= rules.minimum_salary * 100;
    evaluations.push({
      rule: "minimum_salary",
      passed: meetsMinimum,
      detail: meetsMinimum
        ? "Job salary meets the candidate's stated minimum."
        : "Job salary is below the candidate's stated minimum.",
    });
  }

  if (workAuthorization && job.sponsorshipOffered != null) {
    const conflict =
      workAuthorization.sponsorship_required && job.sponsorshipOffered === false;
    evaluations.push({
      rule: "sponsorship",
      passed: !conflict,
      detail: conflict
        ? "Candidate requires sponsorship; employer does not offer it."
        : "No sponsorship conflict.",
    });
  }

  return evaluations;
}

/**
 * Decides what the Application Agent should do with one job, for one
 * candidate, right now. Pure and deterministic — every branch is driven by
 * already-known data, never a model call, so the same input always produces
 * the same decision and the same explanation.
 *
 * Gate order (checked before any mode-specific logic, in every mode):
 *   1. AGENT_PAUSED — the candidate turned the agent off.
 *   2. DAILY_LIMIT_REACHED — today's auto-apply cap is already spent.
 *   3. MISSING_DATA — no resume selected, or no match score yet computed.
 * Only once all three pass does mode (review/hybrid/auto) decide the
 * outcome of the targeting-rule evaluation.
 */
export function decideApplicationAgentAction(
  input: AgentDecisionInput
): AgentDecisionResult {
  const { settings, job, resumeId, autoApplyCountToday } = input;

  const base = {
    matchScore: job.matchScore,
    mode: settings.mode,
  };

  if (settings.paused) {
    return {
      ...base,
      decision: "AGENT_PAUSED",
      reasons: ["The Application Agent is paused."],
      rulesEvaluated: [],
      applyMethod: null,
    };
  }

  if (autoApplyCountToday >= settings.daily_application_limit) {
    return {
      ...base,
      decision: "DAILY_LIMIT_REACHED",
      reasons: [
        `Daily application limit reached (${autoApplyCountToday}/${settings.daily_application_limit}).`,
      ],
      rulesEvaluated: [],
      applyMethod: null,
    };
  }

  const missing: string[] = [];
  if (!resumeId) missing.push("no resume selected");
  if (job.matchScore == null) missing.push("no Match Score computed for this job");

  if (missing.length > 0) {
    return {
      ...base,
      decision: "MISSING_DATA",
      reasons: missing.map((item) => `Missing: ${item}.`),
      rulesEvaluated: [],
      applyMethod: null,
    };
  }

  const rulesEvaluated = evaluateRules(input);

  if (job.matchScore! < settings.minimum_match_score) {
    rulesEvaluated.push({
      rule: "minimum_match_score",
      passed: false,
      detail: `Match Score ${job.matchScore} is below the agent's floor of ${settings.minimum_match_score}.`,
    });
  } else {
    rulesEvaluated.push({
      rule: "minimum_match_score",
      passed: true,
      detail: `Match Score ${job.matchScore} meets the agent's floor of ${settings.minimum_match_score}.`,
    });
  }

  const allPassed = rulesEvaluated.every((rule) => rule.passed);
  const failureReasons = rulesEvaluated
    .filter((rule) => !rule.passed)
    .map((rule) => rule.detail);

  if (settings.mode === "review") {
    return {
      ...base,
      decision: "REQUIRES_REVIEW",
      reasons: allPassed
        ? ["Review mode: every application requires your approval."]
        : failureReasons,
      rulesEvaluated,
      applyMethod: settings.default_apply_method,
    };
  }

  if (settings.mode === "hybrid") {
    return {
      ...base,
      decision: allPassed ? "AUTO_APPLY" : "REQUIRES_REVIEW",
      reasons: allPassed
        ? ["All configured rules passed."]
        : [...failureReasons, "Hybrid mode: queued for your review instead of auto-submitting."],
      rulesEvaluated,
      applyMethod: settings.default_apply_method,
    };
  }

  // mode === "auto"
  return {
    ...base,
    decision: allPassed ? "AUTO_APPLY" : "RULE_MISMATCH",
    reasons: allPassed ? ["All configured rules passed."] : failureReasons,
    rulesEvaluated,
    applyMethod: settings.default_apply_method,
  };
}
