import { createServiceClient } from "@/lib/supabase/service";

/** Terminal outcomes of a Stripe webhook delivery, mirroring the server-side
 * CHECK constraint on webhook_events.outcome. */
export type WebhookLogOutcome =
  | "received"
  | "rejected"
  | "fulfilled"
  | "errored"
  | "duplicate"
  | "ignored";

export type WebhookLogInput = {
  stripeEventId: string | null;
  eventType: string | null;
  outcome: WebhookLogOutcome;
  httpStatus: number;
  userId?: string | null;
  orgId?: string | null;
  sku?: string | null;
  checkoutSessionId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown>;
};

/** Minimal client shape the logger needs. The generated Database type only
 * knows a subset of RPCs, so the delivery-log RPC is invoked through a
 * structurally-loose handle; the guard below keeps missing-rpc mocks safe. */
type LoggableServiceClient = {
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
};

/** Best-effort record of a Stripe webhook delivery's terminal outcome.
 *
 * Observability is strictly a side channel: this never throws and never
 * alters the webhook response. The service-role client is created here (not
 * passed in) so every call site stays uniform, and any failure — missing
 * credentials, a failed RPC, an unexpected exception — is swallowed. The RPC
 * itself validates the outcome enum and http_status range server-side. */
export async function logWebhookEvent(input: WebhookLogInput): Promise<void> {
  try {
    const service = createServiceClient() as unknown as LoggableServiceClient;
    if (typeof service.rpc !== "function") return;
    await service.rpc("odesseus_log_webhook_event", {
      p_stripe_event_id: input.stripeEventId,
      p_event_type: input.eventType,
      p_outcome: input.outcome,
      p_http_status: input.httpStatus,
      p_user_id: input.userId ?? null,
      p_org_id: input.orgId ?? null,
      p_sku: input.sku ?? null,
      p_checkout_session_id: input.checkoutSessionId ?? null,
      p_reason: input.reason ?? null,
      p_details: input.details ?? {},
    });
  } catch (error) {
    console.error("[ODESSEUS_WEBHOOK_LOG] delivery logging failed", error);
  }
}

/** Odesseus Live lifecycle points worth an operational record.
 *
 * These are the moments where money and access change hands, so they are the
 * ones an operator needs to be able to reconstruct after the fact: what was
 * granted, what was consumed, and why a guest was refused.
 */
export const LIVE_EVENT_NAMES = [
  "live.entitlement_granted",
  "live.entitlement_consumed",
  "live.subscription_renewed",
  "live.subscription_canceled",
  "live.guest_invite_created",
  "live.guest_invite_revoked",
  "live.guest_activated",
  "live.guest_cap_reached",
] as const;

export type LiveEventName = (typeof LIVE_EVENT_NAMES)[number];

export type LiveEventInput = {
  eventName: LiveEventName;
  userId: string | null;
  /** Identifiers, counts, plan names and statuses only.
   *
   * Never put a resume, a transcript, a candidate answer, an invite token or
   * any Stripe secret or auth token in here — this table is not private data
   * storage and is not a place to mirror user content. */
  properties?: Record<string, unknown>;
};

type AnalyticsServiceClient = {
  from?: (table: string) => {
    insert: (values: Record<string, unknown>) => Promise<unknown>;
  };
};

/** Best-effort record of a Live lifecycle moment.
 *
 * Strictly a side channel: it never throws, so a logging failure can never
 * block a purchase, a grant, a revocation or a refusal. */
export async function logLiveEvent(input: LiveEventInput): Promise<void> {
  try {
    const service = createServiceClient() as unknown as AnalyticsServiceClient;
    if (typeof service.from !== "function") return;
    const { error } = (await service.from("analytics_events").insert({
      event_name: input.eventName,
      // analytics_events_category_check admits only public/candidate/
      // employer/growth/partner — Live is a candidate-facing feature, not a
      // sixth category, so it is distinguished by event_name instead.
      event_category: "candidate",
      user_id: input.userId,
      properties: input.properties ?? {},
      occurred_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
    })) as { error?: { message: string } | null };

    if (error) {
      console.error("[ODESSEUS_LIVE_LOG] event logging failed", error.message);
    }
  } catch (error) {
    console.error("[ODESSEUS_LIVE_LOG] event logging failed", error);
  }
}
