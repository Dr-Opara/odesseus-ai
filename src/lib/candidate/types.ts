/**
 * Shared candidate data contracts (Phase 5).
 *
 * These are the record shapes both the desktop and the mobile presentation
 * layers consume. The desktop pages and the mobile screens read through the
 * same `src/lib/candidate/service.ts` functions and receive exactly these
 * values, so there is exactly one source of truth per screen — never a
 * mobile-only query and never a desktop-only copy.
 */

export type CandidateProfile = {
  full_name: string | null;
  headline: string | null;
  location: string | null;
  work_preference: string | null;
  country_code: string | null;
  locale: string | null;
  preferred_currency: string | null;
  preferred_language: string | null;
  timezone: string | null;
  application_contact_email: string | null;
  onboarding_completed: boolean;
};

export type CreditBalance = {
  application_credits: number;
  interview_passes: number;
  /** Set only when an Odesseus Live annual entitlement is active (candidate-owned, server-driven). */
  live_unlimited_until: string | null;
  /** Prepaid wallet in minor units (USD cents); server-controlled, debited only on verified success. */
  wallet_balance_cents: number;
};

export type CandidateJob = {
  id: string;
  company_name: string;
  role_title: string;
  location: string | null;
  work_arrangement: string | null;
  employment_type: string | null;
  salary_text: string | null;
  description: string | null;
  match_score: number | null;
  status: string;
  source: string | null;
  source_url: string | null;
  discovered_at: string;
};

export type CandidateApplication = {
  id: string;
  company_name: string;
  role_title: string;
  status: string;
  submitted_at: string | null;
  last_event_at: string | null;
  match_score_snapshot: number | null;
};

export type CandidateInterview = {
  id: string;
  stage: string | null;
  scheduled_at: string | null;
  status: string;
  meeting_provider: string | null;
  readiness_generated_at: string | null;
  role_title: string | null;
  company_name: string | null;
};

export type CandidateActivity = {
  key: string;
  title: string;
  detail: string | null;
  at: string | null;
};

export type CandidateJobPreferences = {
  min_match_score: number;
  target_titles: string[];
  target_locations: string[];
  employment_types: string[];
  industries: string[];
  remote_only: boolean;
  minimum_salary: number | null;
  work_authorization: string | null;
  sponsorship_needed: boolean | null;
};

export type CandidateDocument = {
  id: string;
  file_name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  is_master: boolean;
  is_approved: boolean;
  created_at: string;
};

/**
 * One tailor run for a candidate's job: the stored version, its status, the
 * diff changes and both payloads (tailored result + the source resume it was
 * derived from). Callers validate the JSON payloads with the shared AI
 * schemas; the record itself is what the desktop review and the mobile
 * Resume Review screen both render.
 */
export type CandidateResumeTailoring = {
  id: string;
  jobId: string;
  versionNumber: number;
  status: string;
  improvementCount: number;
  job: {
    company_name: string | null;
    role_title: string | null;
    match_score: number | null;
  } | null;
  tailored: unknown;
  changes: unknown[];
  sourceParsed: unknown | null;
};