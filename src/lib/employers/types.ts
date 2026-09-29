/**
 * Shared employer-domain frontend contracts (F1).
 *
 * These are projections of the real employer backend payloads
 * (`/api/employer/orgs/{orgId}/*`), not invented shapes: every field below is
 * something the backend actually returns. Presentation components read these
 * and nothing else, so a missing value renders as an honest empty state
 * instead of a placeholder number.
 *
 * Hard constraint (F13-J): candidate-facing Odesseus Live/Interview Prep data
 * must never reach an employer view. Enforced structurally here — nothing in
 * this file imports from `@/lib/live` or `@/lib/interviews`, and
 * `CandidateDetail` below has no field for transcript, guidance, mock-interview
 * feedback, or post-interview analysis. Do not add one.
 */

export type EmployerPlanId = "Starter" | "Growth" | "Business";

/** Locked hiring pipeline stages (F13-K) — do not add, remove, or reorder. */
export const PIPELINE_STAGES = [
  "APPLIED",
  "REVIEWING",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * The backend stores lowercase stage values; the UI shows the locked
 * uppercase vocabulary. This is the only place the two vocabularies meet.
 */
const STAGE_TO_BACKEND: Record<PipelineStage, string> = {
  APPLIED: "applied",
  REVIEWING: "reviewing",
  SHORTLISTED: "shortlisted",
  INTERVIEW: "interview",
  OFFER: "offer",
  HIRED: "hired",
  REJECTED: "rejected",
};

const STAGE_FROM_BACKEND: Record<string, PipelineStage> = {
  applied: "APPLIED",
  reviewing: "REVIEWING",
  shortlisted: "SHORTLISTED",
  interview: "INTERVIEW",
  offer: "OFFER",
  hired: "HIRED",
  rejected: "REJECTED",
};

export function toBackendStage(stage: PipelineStage): string {
  return STAGE_TO_BACKEND[stage];
}

/** Unknown/absent stage values map to APPLIED only when the backend sent one. */
export function toPipelineStage(value: string | null | undefined): PipelineStage | null {
  if (!value) return null;
  return STAGE_FROM_BACKEND[value] ?? null;
}

export type EmployerRole = "owner" | "admin" | "recruiter" | "viewer";

/** The company profile, from `GET /api/employer/orgs/{orgId}`. */
export type EmployerProfile = {
  id: string;
  companyName: string;
  companyWebsite?: string;
  industry?: string;
  companySize?: string;
  description?: string;
  /** The caller's own role in the org, when the backend could resolve it. */
  yourRole?: EmployerRole | null;
};

/**
 * F13-G — the backend owns capacity. `planLimit` is the plan's included job
 * posts and is zero unless the subscription is actually live, so a lapsed or
 * checkout-incomplete plan can never imply included posts.
 */
export type EmployerCapacity = {
  activeJobCount: number;
  planLimit: number;
  planId: EmployerPlanId;
};

export type EmployerJobStatus = "Draft" | "Published" | "Closed";
export type WorkArrangement = "Remote" | "Hybrid" | "On-site";

/** One employer posting, from `GET /api/employer/orgs/{orgId}/jobs`. */
export type EmployerJob = {
  id: string;
  title: string;
  location?: string;
  workArrangement?: WorkArrangement;
  status: EmployerJobStatus;
  createdAt?: string;
  publishedAt?: string;
  /** True only when a paid, currently-active featured listing exists. */
  featured?: boolean;
  featuredUntil?: string;
};

export type EmployerJobDetail = EmployerJob & {
  description?: string;
  /** Free text exactly as the employer wrote it, never parsed or reworded. */
  requiredQualificationsText?: string;
  preferredQualificationsText?: string;
};

export type EmployerJobInput = {
  title: string;
  location?: string;
  workArrangement?: WorkArrangement;
  description?: string;
  requiredQualificationsText?: string;
  preferredQualificationsText?: string;
};

/** F13-I — display-only. Never computed client-side, never fabricated. */
export type FitScore = {
  overall: number;
  requiredMatches: string[];
  preferredMatches: string[];
  resumeEvidence: string[];
  missingQualifications: string[];
  missingSkills: string[];
  locationAlignment?: boolean;
  blockers: string[];
  explanation?: string;
};

/** F13-H — no protected demographic attributes belong on this type. */
export type CandidateListItem = {
  /** The application id: an employer never sees a candidate user id. */
  id: string;
  appliedJobId: string;
  appliedJobTitle: string;
  stage: PipelineStage;
  fitScoreOverall?: number;
  location?: string;
  experienceSummary?: string;
  appliedAt?: string;
};

export type CandidateDetail = CandidateListItem & {
  fitScore?: FitScore;
  requiredQualificationsText?: string;
  preferredQualificationsText?: string;
  /** Verbatim employer note recorded on the pipeline transition. */
  employerNote?: string;
};

/** F13-J. See the file header: no Live/Prep fields, ever. */
export type TeamMemberRole = "Owner" | "Admin" | "Recruiter" | "Viewer";
export type TeamMemberStatus = "Active" | "Pending";

export type TeamMember = {
  /** Membership row key: `member:<userId>` or `invitation:<id>`. */
  id: string;
  name: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  joinedAt?: string;
  expiresAt?: string;
  isYou?: boolean;
};

export type EmployerSeats = {
  required: number;
  active: number;
  activeUntil?: string;
  isOverEntitled?: boolean;
};

export type EmployerTeam = {
  members: TeamMember[];
  invitations: TeamMember[];
  seats: EmployerSeats;
  isCallerAdmin: boolean;
  callerRole: EmployerRole | null;
};

/** Real hiring analytics from `GET /api/employer/orgs/{orgId}/analytics`. */
export type EmployerAnalyticsSnapshot = {
  jobsActive: number;
  jobsClosed: number;
  applicantVolume: number;
  strongFitCandidates: number;
  /** Current stage per applicant, keyed by the locked stage vocabulary. */
  stageDistribution: Partial<Record<PipelineStage, number>>;
  hired: number;
  rejected: number;
  applicationsOverTime: { date: string; count: number }[];
  applicantsByJob: { jobId: string; jobTitle: string; applicantCount: number }[];
};

/** The dashboard read, from `GET /api/employer/orgs/{orgId}/dashboard`. */
export type EmployerDashboardSnapshot = {
  organizationName: string | null;
  planName: EmployerPlanId | null;
  subscriptionStatus: string | null;
  capacity: { included: number; published: number; remaining: number } | null;
  seats: { required: number; active: number } | null;
  jobCounts: { total: number; published: number; draft: number; closed: number };
  applicantTotal: number;
  strongFitCount: number;
  recentApplicants: {
    applicationId: string;
    jobId: string;
    jobTitle: string;
    applicationStatus: string;
    submittedAt: string | null;
  }[];
  recentPipelineActivity: {
    id: string;
    jobId: string;
    applicationId: string;
    stage: string;
    createdAt: string;
  }[];
  featuredActive: number;
  /** Backend-reported read gaps. Shown as quiet notices, never as zeroes. */
  notices: string[];
};

export type EmployerPlanIdFromTier = EmployerPlanId;

const TIER_TO_PLAN: Record<string, EmployerPlanId> = {
  starter: "Starter",
  growth: "Growth",
  business: "Business",
};

/** An unrecognised stored tier stays null — never coerced to a default plan. */
export function toEmployerPlanId(tier: string | null | undefined): EmployerPlanId | null {
  return tier ? (TIER_TO_PLAN[tier] ?? null) : null;
}

const STATUS_TO_UI: Record<string, EmployerJobStatus> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};

export function toEmployerJobStatus(status: string | null | undefined): EmployerJobStatus {
  return (status && STATUS_TO_UI[status]) || "Draft";
}

const ARRANGEMENT_TO_UI: Record<string, WorkArrangement> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

export function toWorkArrangement(value: string | null | undefined): WorkArrangement | undefined {
  return value ? ARRANGEMENT_TO_UI[value] : undefined;
}

export function toEmployerPlanArrangement(value: WorkArrangement | undefined): string | undefined {
  if (!value) return undefined;
  if (value === "Remote") return "remote";
  if (value === "Hybrid") return "hybrid";
  return "onsite";
}

/** Backed by the featured-listing view, which is the only place a boost is real. */
export type FeaturedJobPackageId = "featured_7d" | "featured_14d" | "ai_30d";

export type FeaturedJobPurchase = {
  /** Stripe checkout URL returned by the backend; the boost starts only after payment. */
  checkoutUrl: string;
  jobId: string;
  packageId: FeaturedJobPackageId;
};

export type EmployerBillingSummary = {
  planId: EmployerPlanId | null;
  priceLabel: string | null;
  subscriptionStatus: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  capacity: { included: number; published: number; remaining: number };
  seats: { required: number; active: number; activeUntil: string | null } | null;
  featuredActive: number;
};

/** Phase 2K employer notification categories (F13-R). */
export type EmployerNotificationCategory =
  | "new_applicant"
  | "strong_fit"
  | "pipeline_update"
  | "interview_event"
  | "capacity_warning"
  | "capacity_reached"
  | "seat_warning"
  | "billing"
  | "payment_failed"
  | "featured_expiring"
  | "featured_expired"
  | "other";

export type EmployerNotification = {
  id: string;
  category: EmployerNotificationCategory;
  title: string;
  detail?: string;
  createdAt: string;
  read: boolean;
  actionUrl?: string;
};

/**
 * Notification preference toggles (Figma screen 86), keyed by the backend's
 * org channel names. The backend's `pipeline` and `featured` channels have no
 * Figma toggle, so they are carried through untouched rather than dropped.
 */
export type EmployerNotificationPreferences = {
  new_applicants: boolean;
  strong_fit: boolean;
  interview_events: boolean;
  capacity: boolean;
  billing: boolean;
  pipeline: boolean;
  featured: boolean;
  email: boolean;
};
