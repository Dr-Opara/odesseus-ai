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
      p_error: errorMessage ?? null,
    }
  );

  if (error) {
    throw new Error(`Failed to complete retry job: ${error.message}`);
  }
}

/**
 * Execute a critical operation with automatic retry/recovery.
 *
 * This is a convenience wrapper that:
 * 1. Enqueues the job with idempotency
 * 2. Claims and executes the job
 * 3. On success, marks as succeeded
 * 4. On failure, marks as failed (triggers retry logic)
 *
 * This should be used for all critical background operations that
 * must be retried safely.
 *
 * @param jobType - Type of job
 * @param idempotencyKey - Unique key for this operation
 * @param payload - Job payload
 * @param executor - Async function that performs the actual work
 * @param options - Retry configuration
 * @returns The result of the executor function
 */
export async function withRetry<T>(
  jobType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  executor: () => Promise<unknown>,
  options: RetryJobOptions = {}
): Promise<unknown> {
  // Enqueue the job (idempotent)
  await enqueueRetryJob(jobType, idempotencyKey, payload);

  // Claim and execute
  const job = await claimRetryJob("critical_operation");
  if (!job) {
    throw new Error("No job claimed - this should not happen after enqueue");
  }

  try {
    const result = await executor();
    await completeRetryJob(job.id, "succeeded");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await completeRetryJob(job.id, "failed", message);
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