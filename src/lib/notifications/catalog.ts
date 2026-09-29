/**
 * Notification type catalog (Phase 2K).
 *
 * This is the typed contract behind the public.notifications.notification_type
 * CHECK constraint. The migration test (tests/integration/migration-notifications.test.ts)
 * binds these two vocabularies to each other in both directions, so a type
 * added here without a migration (or vice versa) fails `npm test`.
 *
 * Semantics, exactly as documented in the 2K migration header:
 *
 *   - `channel` maps a type to the preference channel that gates whether it is
 *     RECORDED at all (in-app).
 *   - `critical` types bypass that gate: CAPTCHA / MFA / sensitive / manual
 *     action blocks and wallet low balance are never suppressible because
 *     losing one costs the candidate an application or money.
 *   - `email` says the type is email-capable. The outbound-email switch on the
 *     recipient's preferences still applies on top, and marketing (PRODUCT_UPDATE)
 *     additionally requires the product channel to be on before it is recorded,
 *     so nothing promotional is emitted by default.
 *   - Types with no wiring yet (GUEST_*, PREMIUM_*, most employer types) are
 *     catalog-only until their phase. Compare the "phase wiring" comments.
 */

import type {
  EmployerNotificationChannel,
  NotificationChannel,
} from "./service";

export type NotificationRecipient = "candidate" | "employer_member";
export type NotificationPriority = "normal" | "high" | "urgent";

export type NotificationTypeMeta = {
  recipient: NotificationRecipient;
  /** Preference channel; candidate types map into the candidate preferences, employer into the org preferences. */
  channel: NotificationChannel | EmployerNotificationChannel;
  priority: NotificationPriority;
  /** Email-capable when recorded. The recipient's email switch still applies. */
  email: boolean;
  /** Non-suppressible: bypasses its channel gate at record time. */
  critical?: boolean;
  /** Human phrase for where this type gets wired (or "catalog-only"). */
  phase: string;
};

/** The 24 candidate notification types (spec 2K-A minimum). */
export const CANDIDATE_NOTIFICATION_TYPES = [
  "JOB_STRONG_MATCH",
  "APPLICATION_NEEDS_REVIEW",
  "APPLICATION_NEEDS_INPUT",
  "APPLICATION_SUBMITTED",
  "APPLICATION_VERIFIED",
  "APPLICATION_FAILED",
  "APPLICATION_CAPTCHA_REQUIRED",
  "APPLICATION_MFA_REQUIRED",
  "APPLICATION_SENSITIVE_QUESTION",
  "APPLICATION_MANUAL_ACTION_REQUIRED",
  "INTERVIEW_REMINDER",
  "INTERVIEW_PREP_READY",
  "MOCK_INTERVIEW_FEEDBACK_READY",
  "WALLET_LOW_BALANCE",
  "WALLET_TOPUP_SUCCEEDED",
  "APPLICATION_CHARGE_POSTED",
  "PREMIUM_INTERVIEW_PURCHASED",
  "PREMIUM_INTERVIEW_RENEWAL",
  "PREMIUM_INTERVIEW_EXPIRING",
  "GUEST_ACCESS_CREATED",
  "GUEST_ACCESS_ACTIVATED",
  "GUEST_ACCESS_COMPLETED",
  "GUEST_ACCESS_REVOKED",
  "PRODUCT_UPDATE",
] as const;

/** The 11 employer notification types (spec 2K-B minimum). */
export const EMPLOYER_NOTIFICATION_TYPES = [
  "EMPLOYER_NEW_APPLICANT",
  "EMPLOYER_STRONG_FIT",
  "EMPLOYER_PIPELINE_UPDATED",
  "EMPLOYER_INTERVIEW_EVENT",
  "EMPLOYER_JOB_CAPACITY_WARNING",
  "EMPLOYER_JOB_CAPACITY_REACHED",
  "EMPLOYER_RECRUITER_SEAT_WARNING",
  "EMPLOYER_SUBSCRIPTION_EVENT",
  "EMPLOYER_PAYMENT_FAILED",
  "EMPLOYER_FEATURED_JOB_EXPIRING",
  "EMPLOYER_FEATURED_JOB_EXPIRED",
] as const;

export const NOTIFICATION_TYPES = [
  ...CANDIDATE_NOTIFICATION_TYPES,
  ...EMPLOYER_NOTIFICATION_TYPES,
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CATALOG: Record<NotificationType, NotificationTypeMeta> = {
  // --- Candidate ------------------------------------------------------------
  JOB_STRONG_MATCH: {
    recipient: "candidate",
    channel: "matches",
    priority: "normal",
    email: true,
    phase: "wired: job_opportunities match_score trigger (2K)",
  },
  APPLICATION_NEEDS_REVIEW: {
    recipient: "candidate",
    channel: "applications",
    priority: "normal",
    email: true,
    phase: "wired: application_runs ready_to_submit trigger (2K)",
  },
  APPLICATION_NEEDS_INPUT: {
    recipient: "candidate",
    channel: "applications",
    priority: "normal",
    email: true,
    phase: "wired: application_runs needs_user trigger (2K)",
  },
  APPLICATION_SUBMITTED: {
    recipient: "candidate",
    channel: "applications",
    priority: "normal",
    email: true,
    phase: "wired: applications submitted_at trigger (2K)",
  },
  APPLICATION_VERIFIED: {
    recipient: "candidate",
    channel: "applications",
    priority: "normal",
    email: true,
    phase: "wired: applications verified-evidence trigger (2K)",
  },
  APPLICATION_FAILED: {
    recipient: "candidate",
    channel: "applications",
    priority: "normal",
    email: true,
    phase: "wired: application_runs failed trigger (2K)",
  },
  APPLICATION_CAPTCHA_REQUIRED: {
    recipient: "candidate",
    channel: "applications",
    priority: "urgent",
    email: true,
    critical: true,
    phase: "wired: application_runs hold trigger (2K)",
  },
  APPLICATION_MFA_REQUIRED: {
    recipient: "candidate",
    channel: "applications",
    priority: "urgent",
    email: true,
    critical: true,
    phase: "wired: application_runs hold trigger (2K)",
  },
  APPLICATION_SENSITIVE_QUESTION: {
    recipient: "candidate",
    channel: "applications",
    priority: "urgent",
    email: true,
    critical: true,
    phase: "wired: application_runs hold trigger (2K)",
  },
  APPLICATION_MANUAL_ACTION_REQUIRED: {
    recipient: "candidate",
    channel: "applications",
    priority: "high",
    email: true,
    critical: true,
    phase: "wired: application_runs hold trigger (2K)",
  },
  INTERVIEW_REMINDER: {
    recipient: "candidate",
    channel: "interview_reminders",
    priority: "normal",
    email: true,
    phase: "wired: notification_reminders cron (2K)",
  },
  INTERVIEW_PREP_READY: {
    recipient: "candidate",
    channel: "interview_reminders",
    priority: "normal",
    email: true,
    phase: "catalog-only until readiness wiring (2K deferral)",
  },
  MOCK_INTERVIEW_FEEDBACK_READY: {
    recipient: "candidate",
    channel: "interview_reminders",
    priority: "normal",
    email: true,
    phase: "catalog-only until mock feedback wiring (2K deferral)",
  },
  WALLET_LOW_BALANCE: {
    recipient: "candidate",
    channel: "wallet_billing",
    priority: "high",
    email: true,
    critical: true,
    phase: "wired: credit_transactions trigger (2K)",
  },
  WALLET_TOPUP_SUCCEEDED: {
    recipient: "candidate",
    channel: "wallet_billing",
    priority: "normal",
    email: true,
    phase: "wired: credit_transactions trigger (2K)",
  },
  APPLICATION_CHARGE_POSTED: {
    recipient: "candidate",
    channel: "wallet_billing",
    priority: "normal",
    email: true,
    phase: "wired: credit_transactions trigger (2K)",
  },
  PREMIUM_INTERVIEW_PURCHASED: {
    recipient: "candidate",
    channel: "wallet_billing",
    priority: "normal",
    email: true,
    phase: "wired: checkout fulfillment for Live SKUs (2N)",
  },
  PREMIUM_INTERVIEW_RENEWAL: {
    recipient: "candidate",
    channel: "wallet_billing",
    priority: "normal",
    email: true,
    phase: "wired: money-verified Live membership sync (2N)",
  },
  PREMIUM_INTERVIEW_EXPIRING: {
    recipient: "candidate",
    channel: "wallet_billing",
    priority: "high",
    email: true,
    phase: "catalog-only until premium interview wiring (2K deferral)",
  },
  GUEST_ACCESS_CREATED: {
    recipient: "candidate",
    channel: "activity",
    priority: "normal",
    email: true,
    phase: "catalog-only until Phase 2O",
  },
  GUEST_ACCESS_ACTIVATED: {
    recipient: "candidate",
    channel: "activity",
    priority: "normal",
    email: true,
    phase: "catalog-only until Phase 2O",
  },
  GUEST_ACCESS_COMPLETED: {
    recipient: "candidate",
    channel: "activity",
    priority: "normal",
    email: true,
    phase: "catalog-only until Phase 2O",
  },
  GUEST_ACCESS_REVOKED: {
    recipient: "candidate",
    channel: "activity",
    priority: "high",
    email: true,
    phase: "catalog-only until Phase 2O",
  },
  PRODUCT_UPDATE: {
    recipient: "candidate",
    channel: "product",
    priority: "normal",
    email: true,
    phase: "catalog-only; requires product channel (marketing opt-in)",
  },
  // --- Employer -------------------------------------------------------------
  EMPLOYER_NEW_APPLICANT: {
    recipient: "employer_member",
    channel: "new_applicants",
    priority: "normal",
    email: true,
    phase: "wired: applications trigger per org member (2K)",
  },
  EMPLOYER_STRONG_FIT: {
    recipient: "employer_member",
    channel: "strong_fit",
    priority: "normal",
    email: true,
    phase: "wired: fit computation notifies hiring team (2R)",
  },
  EMPLOYER_PIPELINE_UPDATED: {
    recipient: "employer_member",
    channel: "pipeline",
    priority: "normal",
    email: true,
    phase: "wired: pipeline transitions notify hiring team (2R)",
  },
  EMPLOYER_INTERVIEW_EVENT: {
    recipient: "employer_member",
    channel: "interview_events",
    priority: "normal",
    email: true,
    phase: "hook deferred to employer phases (2P-2S)",
  },
  EMPLOYER_JOB_CAPACITY_WARNING: {
    recipient: "employer_member",
    channel: "capacity",
    priority: "normal",
    email: true,
    phase: "wired: employer_jobs status trigger (2K)",
  },
  EMPLOYER_JOB_CAPACITY_REACHED: {
    recipient: "employer_member",
    channel: "capacity",
    priority: "high",
    email: true,
    phase: "wired: employer_jobs status trigger (2K)",
  },
  EMPLOYER_RECRUITER_SEAT_WARNING: {
    recipient: "employer_member",
    channel: "capacity",
    priority: "high",
    email: true,
    phase: "hook deferred to employer phases (2P-2S)",
  },
  EMPLOYER_SUBSCRIPTION_EVENT: {
    recipient: "employer_member",
    channel: "billing",
    priority: "normal",
    email: true,
    phase: "wired: stripe webhook subscription sync (2K)",
  },
  EMPLOYER_PAYMENT_FAILED: {
    recipient: "employer_member",
    channel: "billing",
    priority: "urgent",
    email: true,
    phase: "wired: stripe webhook subscription sync (2K)",
  },
  EMPLOYER_FEATURED_JOB_EXPIRING: {
    recipient: "employer_member",
    channel: "featured",
    priority: "normal",
    email: true,
    phase: "hook deferred to employer phases (2P-2S)",
  },
  EMPLOYER_FEATURED_JOB_EXPIRED: {
    recipient: "employer_member",
    channel: "featured",
    priority: "normal",
    email: true,
    phase: "hook deferred to employer phases (2P-2S)",
  },
};

/** The critical candidate set shared with the SQL gate. */
export const CRITICAL_CANDIDATE_NOTIFICATION_TYPES = new Set<NotificationType>(
  NOTIFICATION_TYPES.filter(
    (type) => NOTIFICATION_CATALOG[type].recipient === "candidate" && NOTIFICATION_CATALOG[type].critical
  )
);

/** Every type that emails when recorded (before the recipient email switch). */
export const EMAIL_CAPABLE_NOTIFICATION_TYPES = new Set<NotificationType>(
  NOTIFICATION_TYPES.filter((type) => NOTIFICATION_CATALOG[type].email)
);

export function isCandidateType(type: NotificationType): boolean {
  return NOTIFICATION_CATALOG[type].recipient === "candidate";
}

export function isEmployerType(type: NotificationType): boolean {
  return NOTIFICATION_CATALOG[type].recipient === "employer_member";
}

export function isCriticalCandidateType(type: NotificationType): boolean {
  return CRITICAL_CANDIDATE_NOTIFICATION_TYPES.has(type);
}

export function isEmailCapable(type: NotificationType): boolean {
  return EMAIL_CAPABLE_NOTIFICATION_TYPES.has(type);
}