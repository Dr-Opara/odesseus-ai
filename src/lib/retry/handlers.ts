/**
 * Retry job reprocessing handlers.
 *
 * One handler per `RetryJobType`, called by the worker
 * (`/api/cron/process-retry-jobs`) with the exact payload recorded at
 * enqueue time. Every handler re-invokes the same idempotent RPC or
 * transport the original call site used — none of them re-derive money,
 * re-verify a Stripe amount, or touch a browser session, so replaying one
 * (including replaying it more than once) cannot double-charge, double-debit,
 * double-submit, double-grant, or double-activate. See `withRetry` in
 * `./service.ts` for why that's a requirement, not just a convenience.
 *
 * Payloads come back out of `retry_jobs.payload` (jsonb) with no static
 * type, so each shape is zod-validated before use: a malformed row should
 * fail loudly and immediately, not throw a confusing error three calls deep
 * inside an RPC.
 */
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import type { RetryJobType } from "@/lib/retry/job-types";

const applicationFinalizationSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  mode: z.enum(["standard", "smart"]),
  confirmationText: z.string(),
  pageUrl: z.string().nullable(),
});

const employerSubscriptionSyncSchema = z.object({
  orgId: z.string(),
  tier: z.enum(["starter", "growth", "business"]),
  status: z.string(),
  // Required, not nullable: odesseus_sync_employer_subscription itself
  // raises if this is null, and every enqueue call site already guards on
  // a truthy subscription id before enqueueing.
  stripeSubscriptionId: z.string(),
  stripeCustomerId: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  grantCredits: z.boolean(),
});

const recruiterSeatSyncSchema = z.object({
  orgId: z.string(),
  seatCount: z.number().int(),
  status: z.string(),
  stripeSubscriptionId: z.string(),
  stripeCustomerId: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
});

const featuredJobActivationSchema = z.object({
  orgId: z.string(),
  jobId: z.string(),
  tier: z.string(),
  stripePaymentIntent: z.string(),
});

const emailDeliverySchema = z.object({
  to: z.string(),
  subject: z.string(),
  heading: z.string(),
  body: z.string(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  logPrefix: z.string(),
});

export type ApplicationFinalizationPayload = z.infer<typeof applicationFinalizationSchema>;
export type EmployerSubscriptionSyncPayload = z.infer<typeof employerSubscriptionSyncSchema>;
export type RecruiterSeatSyncPayload = z.infer<typeof recruiterSeatSyncSchema>;
export type FeaturedJobActivationPayload = z.infer<typeof featuredJobActivationSchema>;
export type EmailDeliveryPayload = z.infer<typeof emailDeliverySchema>;

/** Re-runs the exact RPC `finalizeConfirmedExistingSubmission` calls (idempotent by run_id). */
async function retryApplicationFinalization(rawPayload: unknown) {
  const payload = applicationFinalizationSchema.parse(rawPayload);
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("odesseus_finalize_application", {
    p_run_id: payload.runId,
    p_user_id: payload.userId,
    p_mode: payload.mode,
    p_confirmation_text: payload.confirmationText,
    p_page_url: payload.pageUrl ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Re-runs the sync RPC (upsert keyed on stripe_subscription_id; credit grant keyed on period). */
async function retryEmployerSubscriptionSync(rawPayload: unknown) {
  const payload = employerSubscriptionSyncSchema.parse(rawPayload);
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("odesseus_sync_employer_subscription", {
    p_org_id: payload.orgId,
    p_tier: payload.tier,
    p_status: payload.status,
    p_stripe_subscription_id: payload.stripeSubscriptionId,
    // p_stripe_customer_id / p_period_start have no SQL DEFAULT, so the
    // generated Args type requires a bare `string` even though both
    // columns are genuinely nullable and the RPC accepts an explicit NULL
    // over the wire fine — only p_period_end (DEFAULT NULL) gets
    // `| undefined`. These assertions bridge that codegen gap; they don't
    // change what's actually sent (a lifecycle event carries no period).
    p_stripe_customer_id: payload.stripeCustomerId as string,
    p_period_start: payload.periodStart as string,
    p_period_end: payload.periodEnd ?? undefined,
    p_grant_credits: payload.grantCredits,
  });
  if (error) throw new Error(error.message);
}

/** Re-runs the sync RPC (upsert keyed on stripe_subscription_id). */
async function retryRecruiterSeatSync(rawPayload: unknown) {
  const payload = recruiterSeatSyncSchema.parse(rawPayload);
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("odesseus_sync_recruiter_seat", {
    p_org_id: payload.orgId,
    p_count: payload.seatCount,
    p_status: payload.status,
    p_stripe_subscription_id: payload.stripeSubscriptionId,
    p_stripe_customer_id: payload.stripeCustomerId ?? undefined,
    p_period_start: payload.periodStart ?? undefined,
    p_period_end: payload.periodEnd ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Re-runs the creation RPC (insert keyed on stripe_payment_intent). */
async function retryFeaturedJobActivation(rawPayload: unknown) {
  const payload = featuredJobActivationSchema.parse(rawPayload);
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("odesseus_create_featured_listing", {
    p_org_id: payload.orgId,
    p_job_id: payload.jobId,
    p_tier: payload.tier,
    p_stripe_payment_intent: payload.stripePaymentIntent,
  });
  if (error) throw new Error(error.message);
}

/** Re-sends through the shared transport. A duplicate email is an acceptable retry cost. */
async function retryEmailDelivery(rawPayload: unknown) {
  const { logPrefix, ...input } = emailDeliverySchema.parse(rawPayload);
  const result = await sendEmail(input, logPrefix);
  if (!result.sent) {
    // `not_configured` is a deployment state, not a transient failure —
    // retrying can never succeed, so it dead-letters like any other
    // terminal failure instead of exhausting attempts pointlessly.
    throw new Error(`email delivery failed: ${result.reason}`);
  }
}

const handlers: Record<RetryJobType, (payload: unknown) => Promise<void>> = {
  application_finalization: retryApplicationFinalization,
  employer_subscription_sync: retryEmployerSubscriptionSync,
  recruiter_seat_sync: retryRecruiterSeatSync,
  featured_job_activation: retryFeaturedJobActivation,
  email_delivery: retryEmailDelivery,
};

/** Dispatches a claimed retry job to its handler. Throws on unknown job types. */
export async function runRetryHandler(jobType: string, payload: unknown): Promise<void> {
  const handler = handlers[jobType as RetryJobType];
  if (!handler) {
    throw new Error(`No retry handler registered for job type: ${jobType}`);
  }
  await handler(payload);
}
