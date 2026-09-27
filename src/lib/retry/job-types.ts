/**
 * Retry job type registry.
 *
 * A `retry_jobs.job_type` string is meaningless without a worker that knows
 * how to redo the operation it names. This is the single list shared by
 * every `enqueueRetryJob`/`withRetry` call site and by the worker
 * (`/api/cron/process-retry-jobs`) that claims and reprocesses them — so a
 * typo in either place is a compile error instead of a silently-stuck queue.
 */
export const RETRY_JOB_TYPES = [
  "application_finalization",
  "employer_subscription_sync",
  "recruiter_seat_sync",
  "featured_job_activation",
  "email_delivery",
  "live_membership_sync",
] as const;

export type RetryJobType = (typeof RETRY_JOB_TYPES)[number];
