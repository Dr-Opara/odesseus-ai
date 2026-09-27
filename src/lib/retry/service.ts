import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";

/**
 * Minimal Supabase RPC client type for retry service.
 * Only includes the RPC methods we actually call.
 */
type SupabaseRpcClient = Pick<
  ReturnType<typeof createServiceClient>,
  "rpc"
>;

export type RetryJobOptions = {
  maxAttempts?: number;
  initialDelaySeconds?: number;
};

/**
 * Enqueue a retryable job with idempotency guarantee.
 *
 * The idempotency key ensures that if the same operation is attempted
 * multiple times (e.g., due to a network timeout that causes a retry),
 * only one job is actually created. The key should be derived from
 * the business identity of the operation (e.g., stripe event ID,
 * application run ID, etc.).
 *
 * @param jobType - The type of job (used for worker routing)
 * @param idempotencyKey - Unique key for this operation (deduplication)
 * @param payload - Job payload (serializable JSON)
 * @param options - Retry configuration
 * @returns The retry job ID
 */
export async function enqueueRetryJob(
  jobType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  options: RetryJobOptions = {}
): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await (supabase as unknown as SupabaseRpcClient).rpc(
    "odesseus_enqueue_retry_job",
    {
      p_job_type: jobType,
      p_idempotency_key: idempotencyKey,
      p_payload: payload as unknown as Json,
      p_max_attempts: options.maxAttempts ?? 3,
      p_delay_seconds: options.initialDelaySeconds ?? 60,
    }
  );

  if (error) {
    throw new Error(`Failed to enqueue retry job: ${error.message}`);
  }

  return data as string;
}

/**
 * Claim a retry job for processing.
 *
 * This function atomically claims the next available job of the given type,
 * marking it as running and incrementing the attempt counter. It uses
 * `FOR UPDATE SKIP LOCKED` to ensure that concurrent workers don't
 * claim the same job.
 *
 * @param jobType - The type of job to claim
 * @returns The claimed retry job, or null if no jobs are available
 */
export async function claimRetryJob(
  jobType: string
): Promise<{
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
} | null> {
  const supabase = createServiceClient();

  const { data, error } = await (supabase as unknown as SupabaseRpcClient).rpc(
    "odesseus_claim_retry_job",
    {
      p_job_type: jobType,
    }
  );

  if (error) {
    throw new Error(`Failed to claim retry job: ${error.message}`);
  }

  if (!data || (data as unknown[]).length === 0) {
    return null;
  }

  return (data as unknown[])[0] as {
    id: string;
    jobType: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    attempts: number;
    maxAttempts: number;
  };
}

/**
 * Mark a retry job as completed (success or failure).
 *
 * On success: marks the job as 'succeeded' and clears next_retry_at.
 * On failure: increments attempts, schedules next retry with exponential
 * backoff (capped at 1 hour), or moves to 'dead_letter' if max attempts
 * exceeded.
 *
 * @param jobId - The ID of the retry job
 * @param outcome - 'succeeded' or 'failed'
 * @param error - Error message if failed
 */
export async function completeRetryJob(
  jobId: string,
  outcome: "succeeded" | "failed",
  errorMessage?: string
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await (supabase as unknown as SupabaseRpcClient).rpc(
    "odesseus_complete_retry_job",
    {
      p_job_id: jobId,
      p_outcome: outcome,
      p_error: errorMessage,
    }
  );

  if (error) {
    throw new Error(`Failed to complete retry job: ${error.message}`);
  }
}

/**
 * Execute a critical operation inline, with durable failure recovery.
 *
 * This runs `executor` immediately (the caller's own request/webhook/step
 * already has its own timeout and, in most cases, its own outer retry —
 * Stripe redelivers failed webhooks, Vercel Workflow retries a failed step
 * 3x). What this adds is a *second*, independent recovery path: on failure,
 * the attempt is recorded in `retry_jobs` (deduplicated by `idempotencyKey`,
 * so calling this repeatedly for the same logical operation — e.g. once per
 * webhook redelivery — enqueues at most one row). A worker
 * (`/api/cron/process-retry-jobs`) later claims and re-executes it via
 * `processRetryJobs`, and a terminal failure becomes a queryable
 * `dead_letter` row instead of a silent, one-off error log.
 *
 * `executor` must be idempotent — the worker may call it again later,
 * exactly like this function calling it again on a caller's own retry must
 * be safe. Every current caller wraps an already-idempotent DB RPC
 * (unique-constrained, upsert-keyed, or payment-intent/period-keyed), so
 * that requirement already holds.
 *
 * The original error is always rethrown so existing caller behavior
 * (HTTP 500 -> Stripe redelivery, Workflow step retry, etc.) is unchanged.
 * A failure to enqueue the recovery record is logged, never thrown — a
 * broken safety net must not turn into a second outage.
 *
 * @param jobType - Job type the worker dispatches on (see `job-types.ts`)
 * @param idempotencyKey - Unique key for this logical operation
 * @param payload - Enough data for the worker to redo the operation later
 * @param executor - The critical operation itself
 * @param options - Retry configuration (max attempts, initial backoff)
 */
export async function withRetry<T>(
  jobType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  executor: () => Promise<T>,
  options: RetryJobOptions = {}
): Promise<T> {
  try {
    return await executor();
  } catch (err) {
    try {
      await enqueueRetryJob(jobType, idempotencyKey, payload, options);
    } catch (enqueueErr) {
      console.error(
        `[ODESSEUS_RETRY] failed to enqueue ${jobType} (${idempotencyKey}) after execution failure`,
        enqueueErr
      );
    }
    throw err;
  }
}

/**
 * Generate an idempotency key for Stripe webhook processing.
 */
export function stripeWebhookIdempotencyKey(
  eventId: string,
  eventType: string
): string {
  return `stripe_webhook:${eventType}:${eventId}`;
}

/**
 * Generate an idempotency key for wallet settlement.
 */
export function walletSettlementIdempotencyKey(
  runId: string,
  mode: "standard" | "smart"
): string {
  return `wallet_settlement:${runId}:${mode}`;
}

/**
 * Generate an idempotency key for application submission.
 */
export function applicationSubmissionIdempotencyKey(runId: string): string {
  return `application_submission:${runId}`;
}

/**
 * Generate an idempotency key for Smart Apply.
 */
export function smartApplyIdempotencyKey(runId: string): string {
  return `smart_apply:${runId}`;
}

/**
 * Generate an idempotency key for employer subscription sync.
 */
export function employerSubscriptionSyncIdempotencyKey(
  orgId: string,
  stripeSubscriptionId: string,
  eventType: string
): string {
  return `employer_subscription_sync:${orgId}:${stripeSubscriptionId}:${eventType}`;
}

/**
 * Generate an idempotency key for recruiter seat sync.
 */
export function recruiterSeatSyncIdempotencyKey(
  orgId: string,
  stripeSubscriptionId: string,
  eventType: string
): string {
  return `recruiter_seat_sync:${orgId}:${stripeSubscriptionId}:${eventType}`;
}

/**
 * Generate an idempotency key for featured job activation.
 */
export function featuredJobActivationIdempotencyKey(
  orgId: string,
  jobId: string,
  tier: string
): string {
  return `featured_job_activation:${orgId}:${jobId}:${tier}`;
}

/**
 * Generate an idempotency key for email delivery.
 */
export function emailDeliveryIdempotencyKey(
  template: string,
  recipient: string,
  triggerId: string
): string {
  return `email_delivery:${template}:${recipient}:${triggerId}`;
}

/**
 * Generate an idempotency key for analytics event ingestion.
 */
export function analyticsEventIdempotencyKey(
  eventName: string,
  userId: string | null,
  sessionId: string | null,
  timestamp: number
): string {
  return `analytics_event:${eventName}:${userId ?? "anon"}:${sessionId ?? "none"}:${timestamp}`;
}