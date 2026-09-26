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