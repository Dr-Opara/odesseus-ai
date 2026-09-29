/**
 * Shared employer-domain frontend contracts (F13). There is no employer
 * backend yet — no Supabase tables, no `/api/employers/*` routes (confirmed
 * against `src/types/database.ts` and the route tree before writing this).
 * Every screen in checkpoints 3-6 reads through these types and the adapters
 * in this directory, never a raw shape of its own.
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

export type EmployerProfile = {
  id: string;
  companyName: string;
  companyWebsite?: string;
  industry?: string;
  companySize?: string;
  contactName?: string;
  contactEmail?: string;
  planId: EmployerPlanId;
  onboardingComplete: boolean;
};

/**
 * F13-G — backend is authoritative; this is presentation data only.
 *
 * `planLimit` and `planId` are nullable because an organization can be on a
 * tier this build does not recognise. Coercing that to `0`/`"Starter"` would
 * claim a limit the product has not established, and the badge would render
 * "0 of 0 active jobs used" as though it were a measurement.
 */
export type EmployerCapacity = {
  activeJobCount: number;
  planLimit: number | null;
  planId: EmployerPlanId | null;
};

export type EmployerJobStatus = "Draft" | "Published" | "Closed";

/**
 * Work arrangement in the product vocabulary.
 *
 * The backend stores it lowercase (`employer_jobs.work_arrangement`:
 * `remote | hybrid | onsite`). The adapter normalises it, but the value can
 * still arrive unrecognised, so this is a union of the known labels rather
 * than a closed enum — an unexpected value renders as the form's default
 * option instead of failing the page.
 */
export type WorkArrangement = "Remote" | "Hybrid" | "On-site" | "remote" | "hybrid" | "onsite";

export type EmployerJob = {
  id: string;
  title: string;
  department?: string;
  location?: string;
  workArrangement?: WorkArrangement;
  status: EmployerJobStatus;
  createdAt: string;
  publishedAt?: string;
  applicantCount?: number;
  featured: boolean;
  featuredUntil?: string;
};

export type EmployerJobDetail = EmployerJob & {
  employmentType?: string;
  description?: string;
  responsibilities?: string[];
  requiredQualifications?: string[];
  preferredQualifications?: string[];
  compensationText?: string;
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
};

/** F13-H — no protected demographic attributes belong on this type. */
export type CandidateListItem = {
  id: string;
  name: string;
  appliedJobId: string;
  appliedJobTitle: string;
  stage: PipelineStage;
  fitScoreOverall?: number;
  location?: string;
  experienceSummary?: string;
  appliedAt: string;
};

/** F13-J. See the file header: no Live/Prep fields, ever. */
export type CandidateDetail = CandidateListItem & {
  fitScore?: FitScore;
  resumeUrl?: string;
  applicationAnswers?: { question: string; answer: string }[];
  requiredQualifications?: string[];
  preferredQualifications?: string[];
  gaps?: string[];
  employerNotes?: string[];
};

export type TeamMemberRole = "Owner" | "Admin" | "Recruiter";
export type TeamMemberStatus = "Active" | "Pending";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  invitedAt: string;
  acceptedAt?: string;
};

export type EmployerAnalyticsSnapshot = {
  activeJobs: number;
  applicantVolume: number;
  stageDistribution: Partial<Record<PipelineStage, number>>;
  strongFitCandidates: number;
  hiringActivityOverTime?: { date: string; count: number }[];
};

export type FeaturedJobPackageId = "featured-7" | "featured-14" | "ai-featured-30";

export type FeaturedJobPurchase = {
  jobId: string;
  packageId: FeaturedJobPackageId;
  status: "pending" | "active" | "expired";
  activatedAt?: string;
  expiresAt?: string;
};

export type EmployerBillingSummary = {
  planId: EmployerPlanId;
  priceLabel: string;
  renewalDate?: string;
  paymentStatus?: "current" | "past_due" | "canceled";
  seatsUsed: number;
  seatLimit: number;
};

/** Phase 2K employer notification categories (F13-R). */
export type EmployerNotificationCategory =
  | "new_applicant"
  | "strong_fit"
  | "pipeline_update"
  | "interview_event"
  | "capacity_warning"
  | "seat_warning"
  | "billing"
  | "featured_expiring";

export type EmployerNotification = {
  id: string;
  category: EmployerNotificationCategory;
  title: string;
  detail?: string;
  createdAt: string;
  read: boolean;
};

/** Notification preference toggles (Figma screen 86). Keyed by category, not every EmployerNotificationCategory needs its own toggle. */
export type EmployerNotificationPreferences = {
  newApplicant: boolean;
  strongFitCandidate: boolean;
  interviewUpdate: boolean;
  capacityWarning: boolean;
  billingNotice: boolean;
};
