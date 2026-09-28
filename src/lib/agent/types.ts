export type AgentMode = "review" | "hybrid" | "auto";
export type ApplyMethod = "apply" | "smart_apply";

/**
 * The full spec vocabulary. The decision engine (decideApplicationAgentAction)
 * only ever produces the first six — the remaining four are execution-time
 * outcomes discovered once a run is already in progress (CAPTCHA/MFA/
 * unsupported-form detection already exists in src/lib/apply/runner.ts and
 * src/lib/apply/field-rules.ts) and are recorded separately once known.
 */
export type AgentDecisionStatus =
  | "AUTO_APPLY"
  | "REQUIRES_REVIEW"
  | "RULE_MISMATCH"
  | "MISSING_DATA"
  | "DAILY_LIMIT_REACHED"
  | "AGENT_PAUSED"
  | "SENSITIVE_QUESTION"
  | "CAPTCHA_REQUIRED"
  | "MFA_REQUIRED"
  | "UNSUPPORTED_FLOW";

export type AgentSettings = {
  mode: AgentMode;
  paused: boolean;
  minimum_match_score: number;
  daily_application_limit: number;
  default_apply_method: ApplyMethod;
};

/**
 * The targeting rules the decision engine evaluates a job against. Sourced
 * from job_preferences (Phase 2A) — never duplicated here.
 */
export type AgentTargetingRules = {
  excluded_companies: string[];
  excluded_titles: string[];
  target_titles: string[];
  industries: string[];
  remote_allowed: boolean;
  hybrid_allowed: boolean;
  onsite_allowed: boolean;
  minimum_salary: number | null;
};

/**
 * Applicant-declared work-authorization facts (Phase 2A,
 * candidate_work_authorization). Null/false-default fields mean "not
 * declared" — the engine never treats silence as a pass.
 */
export type AgentWorkAuthorization = {
  authorized_without_sponsorship: boolean;
  sponsorship_required: boolean;
} | null;

export type AgentJobContext = {
  jobId: string;
  matchScore: number | null;
  companyName: string;
  roleTitle: string;
  workArrangement: "remote" | "hybrid" | "on-site" | null;
  salaryMinCents: number | null;
  industry: string | null;
  /** Explicit sponsorship stance stated by the job posting, when known. */
  sponsorshipOffered: boolean | null;
};

export type AgentDecisionInput = {
  settings: AgentSettings;
  rules: AgentTargetingRules;
  workAuthorization: AgentWorkAuthorization;
  job: AgentJobContext;
  resumeId: string | null;
  /** Number of AUTO_APPLY decisions already made today for this user. */
  autoApplyCountToday: number;
};

export type RuleEvaluation = {
  rule: string;
  passed: boolean;
  detail: string;
};

export type AgentDecisionResult = {
  decision: AgentDecisionStatus;
  reasons: string[];
  rulesEvaluated: RuleEvaluation[];
  matchScore: number | null;
  mode: AgentMode;
  applyMethod: ApplyMethod | null;
};
