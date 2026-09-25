import { describe, expect, it, vi, beforeEach } from "vitest";
import { billingCatalog } from "@/lib/billing/catalog";
import { employerPlans } from "@/lib/billing/catalog";
import { employerFeaturedTiers } from "@/lib/billing/catalog";

const constructEventMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
const rpcMock = vi.fn();
const createClientMock = vi.fn(() => ({ from: fromMock, rpc: rpcMock }));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: constructEventMock } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createClientMock(),
}));

function webhookRequest(body: string) {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": "sig_test" },
  });
}

function checkoutCompletedEvent(overrides: {
  sku?: string;
  userId?: string;
  paymentStatus?: string;
  eventId?: string;
  amountTotal?: number | null;
  currency?: string;
}) {
  const {
    sku = "wallet_10",
    userId = "user-1",
    paymentStatus = "paid",
    eventId = "evt_test_1",
    amountTotal,
    currency = "usd",
  } = overrides;

  const item = billingCatalog[sku as keyof typeof billingCatalog];
  const charged = amountTotal ?? item?.amountCents ?? null;

  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        payment_status: paymentStatus,
        amount_total: charged,
        currency,
        customer: "cus_test_1",
        payment_intent: "pi_test_1",
        metadata: { odesseus_user_id: userId, sku },
      },
    },
  };
}

function chargeRefundedEvent(overrides: { eventId?: string; paymentIntent?: string | null } = {}) {
  const { eventId = "evt_refund_1", paymentIntent = "pi_test_1" } = overrides;
  return {
    id: eventId,
    type: "charge.refunded",
    data: { object: { id: "ch_1", payment_intent: paymentIntent } },
  };
}

function invoicePaidEvent(overrides: {
  tier?: "starter" | "growth" | "business";
  orgId?: string;
  eventId?: string;
  amountPaid?: number | null;
  currency?: string;
  subscription?: string | null;
  periodStart?: number;
  periodEnd?: number;
  seatCount?: number;
}) {
  const {
    tier = "starter",
    orgId = "org-1",
    eventId = "evt_inv_1",
    amountPaid,
    currency = "usd",
    subscription = "sub_1",
    periodStart = 1_730_000_000,
    periodEnd = 1_732_000_000,
    seatCount,
  } = overrides;

  const plan = employerPlans[`employer_${tier}` as keyof typeof employerPlans];
  const metadata: Record<string, string> = seatCount
    ? {
        odesseus_org_id: orgId,
        odesseus_recruiter_seats: "true",
        odesseus_seat_count: String(seatCount),
        odesseus_tier: tier,
      }
    : { odesseus_org_id: orgId, odesseus_tier: tier };

  return {
    id: eventId,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
        amount_paid: amountPaid ?? plan.amountCents,
        total: amountPaid ?? plan.amountCents,
        currency,
        status: "paid",
        period_start: periodStart,
        period_end: periodEnd,
        parent: {
          type: "subscription_details",
          subscription_details: { metadata, subscription },
        },
      },
    },
  };
}

function subscriptionLifecycleEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  overrides: {
    tier?: "starter" | "growth" | "business";
    orgId?: string;
    eventId?: string;
    status?: string;
    seatCount?: number;
  } = {}
) {
  const {
    tier = "starter",
    orgId = "org-1",
    eventId = type === "customer.subscription.deleted" ? "evt_sub_del_1" : "evt_sub_upd_1",
    status = "past_due",
    seatCount,
  } = overrides;

  const metadata: Record<string, string> = seatCount
    ? {
        odesseus_org_id: orgId,
        odesseus_recruiter_seats: "true",
        odesseus_seat_count: String(seatCount),
        odesseus_tier: tier,
      }
    : { odesseus_org_id: orgId, odesseus_tier: tier };

  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status,
        current_period_start: 1_730_000_000,
        current_period_end: 1_732_000_000,
        metadata,
      },
    },
  };
}

function featuredCheckoutEvent(overrides: {
  tier?: keyof typeof employerFeaturedTiers;
  orgId?: string;
  jobId?: string;
  eventId?: string;
  amountTotal?: number | null;
  currency?: string;
  paymentIntent?: string | null;
}) {
  const {
    tier = "featured_7d",
    orgId = "org-f1",
    jobId = "job-f1",
    eventId = "evt_featured_1",
    amountTotal,
    currency = "usd",
    paymentIntent = "pi_featured_1",
  } = overrides;

  const item = employerFeaturedTiers[tier];
  const charged = amountTotal ?? item?.amountCents ?? null;

  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_featured_1",
        payment_status: "paid",
        amount_total: charged,
        currency,
        customer: "cus_f1",
        payment_intent: paymentIntent,
        metadata: { odesseus_org_id: orgId, odesseus_job_id: jobId, odesseus_featured_tier: tier },
      },
    },
  };
}

/** The odesseus_log_webhook_event RPC calls observed by rpcMock. */
function logCalls() {
  return rpcMock.mock.calls.filter(([fnName]) => fnName === "odesseus_log_webhook_event");
}

function logCallArgs(index = 0) {
  return logCalls()[index]?.[1] ?? null;
}

describe("Stripe webhook delivery observability", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    insertMock.mockReset();
    fromMock.mockClear();
    rpcMock.mockReset();
    createClientMock.mockClear();
    insertMock.mockResolvedValue({ error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("records a fulfilled checkout delivery with the event and candidate context", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku: "wallet_10", userId: "user-1" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(logCalls()).toHaveLength(1);
    expect(logCallArgs()).toMatchObject({
      p_stripe_event_id: "evt_test_1",
      p_event_type: "checkout.session.completed",
      p_outcome: "fulfilled",
      p_http_status: 200,
      p_user_id: "user-1",
      p_sku: "wallet_10",
      p_checkout_session_id: "cs_test_1",
    });
  });

  it("records a rejected delivery for invalid checkout metadata", async () => {
    const event = checkoutCompletedEvent({});
    (event.data.object.metadata as { sku?: string }).sku = "not_a_sku";
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(logCallArgs()).toMatchObject({
      p_outcome: "rejected",
      p_http_status: 400,
      p_stripe_event_id: "evt_test_1",
      p_reason: "Invalid checkout metadata.",
    });
  });

  it("records a rejected delivery when the charged amount does not match the catalog", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ amountTotal: 999 }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(logCallArgs()).toMatchObject({
      p_outcome: "rejected",
      p_http_status: 400,
      p_reason: "Checkout amount or currency does not match the catalog.",
    });
  });

  it("records a duplicate delivery on a replayed checkout event", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({}));
    insertMock.mockResolvedValue({ error: { code: "23505" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(logCallArgs()).toMatchObject({
      p_outcome: "duplicate",
      p_http_status: 200,
      p_reason: "Duplicate delivery: purchase already fulfilled.",
    });
  });

  it("records an errored delivery when the billing insert fails", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({}));
    insertMock.mockResolvedValue({ error: { code: "PGRST301", message: "boom" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(500);
    expect(logCallArgs()).toMatchObject({
      p_outcome: "errored",
      p_http_status: 500,
      p_reason: "Could not insert billing event.",
    });
  });

  it("records an ignored delivery for an unpaid checkout", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ paymentStatus: "unpaid" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(logCallArgs()).toMatchObject({
      p_outcome: "ignored",
      p_http_status: 200,
      p_reason: "Checkout session was not paid.",
    });
  });

  it("records an ignored delivery for an event type with no fulfillment path", async () => {
    constructEventMock.mockReturnValue({ id: "evt_ping_1", type: "ping", data: { object: {} } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(logCallArgs()).toMatchObject({
      p_stripe_event_id: "evt_ping_1",
      p_event_type: "ping",
      p_outcome: "ignored",
      p_http_status: 200,
    });
  });

  it("records a fulfilled refund-reversal delivery", async () => {
    constructEventMock.mockReturnValue(chargeRefundedEvent());

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(logCallArgs()).toMatchObject({
      p_stripe_event_id: "evt_refund_1",
      p_event_type: "charge.refunded",
      p_outcome: "fulfilled",
      p_http_status: 200,
    });
  });

  it("records a rejected delivery for a missing signature", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const request = new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(logCallArgs()).toMatchObject({
      p_stripe_event_id: null,
      p_event_type: null,
      p_outcome: "rejected",
      p_http_status: 400,
      p_reason: "Missing signature.",
    });
  });

  it("records a rejected delivery for an invalid signature", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(logCallArgs()).toMatchObject({
      p_stripe_event_id: null,
      p_event_type: null,
      p_outcome: "rejected",
      p_http_status: 400,
      p_reason: "Invalid signature.",
    });
  });

  it("records an errored delivery when the webhook is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    try {
      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(500);
      expect(logCallArgs()).toMatchObject({
        p_stripe_event_id: null,
        p_event_type: null,
        p_outcome: "errored",
        p_http_status: 500,
        p_reason: "Webhook is not configured.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("employer invoice.paid", () => {
    it("records a fulfilled delivery with the org id", async () => {
      constructEventMock.mockReturnValue(invoicePaidEvent({ tier: "starter" }));

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(logCallArgs()).toMatchObject({
        p_stripe_event_id: "evt_inv_1",
        p_event_type: "invoice.paid",
        p_outcome: "fulfilled",
        p_http_status: 200,
        p_org_id: "org-1",
      });
    });

    it("records a rejected delivery for a seat-price mismatch and never syncs", async () => {
      constructEventMock.mockReturnValue(
        invoicePaidEvent({ tier: "business", seatCount: 5, amountPaid: 1 })
      );

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalledWith(
        "odesseus_sync_recruiter_seat",
        expect.anything()
      );
      expect(logCallArgs()).toMatchObject({
        p_outcome: "rejected",
        p_http_status: 400,
        p_org_id: "org-1",
        p_reason: "Invoice amount or currency does not match the recruiter seat price.",
      });
    });

    it("records an ignored delivery when the invoice is not an Odesseus subscription", async () => {
      const event = invoicePaidEvent({});
      event.data.object.parent.subscription_details.metadata = {};
      constructEventMock.mockReturnValue(event);

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(logCallArgs()).toMatchObject({
        p_stripe_event_id: "evt_inv_1",
        p_event_type: "invoice.paid",
        p_outcome: "ignored",
        p_http_status: 200,
      });
    });

    it("records a rejected delivery when the invoiced amount does not match the plan", async () => {
      constructEventMock.mockReturnValue(invoicePaidEvent({ tier: "starter", amountPaid: 7901 }));

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(400);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "rejected",
        p_http_status: 400,
        p_org_id: "org-1",
        p_reason: "Invoice amount or currency does not match the employer plan.",
      });
    });

    it("records an errored delivery when the employer sync fails", async () => {
      constructEventMock.mockReturnValue(invoicePaidEvent({ tier: "starter" }));
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "sync failed" } });

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(500);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "errored",
        p_http_status: 500,
        p_org_id: "org-1",
        p_reason: "Employer subscription sync failed.",
      });
    });
  });

  describe("subscription lifecycle", () => {
    it("records a fulfilled delivery when the status syncs", async () => {
      constructEventMock.mockReturnValue(
        subscriptionLifecycleEvent("customer.subscription.updated", { status: "active" })
      );

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(logCallArgs()).toMatchObject({
        p_stripe_event_id: "evt_sub_upd_1",
        p_event_type: "customer.subscription.updated",
        p_outcome: "fulfilled",
        p_http_status: 200,
        p_org_id: "org-1",
      });
    });

    it("records an ignored delivery when the subscription has no Odesseus metadata", async () => {
      const event = subscriptionLifecycleEvent("customer.subscription.updated", {});
      event.data.object.metadata = {};
      constructEventMock.mockReturnValue(event);

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "ignored",
        p_http_status: 200,
      });
    });

    it("records an ignored delivery when the status needs no sync", async () => {
      constructEventMock.mockReturnValue(
        subscriptionLifecycleEvent("customer.subscription.updated", { status: "paused" })
      );

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "ignored",
        p_http_status: 200,
        p_org_id: "org-1",
      });
    });

    it("records an errored delivery when the lifecycle sync fails", async () => {
      constructEventMock.mockReturnValue(
        subscriptionLifecycleEvent("customer.subscription.updated", { status: "active" })
      );
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "sync failed" } });

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(500);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "errored",
        p_http_status: 500,
        p_org_id: "org-1",
        p_reason: "Subscription lifecycle sync failed.",
      });
    });
  });

  describe("featured listing checkout", () => {
    it("records a fulfilled delivery when the listing is created", async () => {
      constructEventMock.mockReturnValue(featuredCheckoutEvent({ tier: "featured_7d" }));

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(logCallArgs()).toMatchObject({
        p_stripe_event_id: "evt_featured_1",
        p_event_type: "checkout.session.completed",
        p_outcome: "fulfilled",
        p_http_status: 200,
        p_org_id: "org-f1",
      });
    });

    it("records a rejected delivery for invalid featured metadata", async () => {
      const event = featuredCheckoutEvent({});
      delete (event.data.object.metadata as { odesseus_org_id?: string }).odesseus_org_id;
      constructEventMock.mockReturnValue(event);

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(400);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "rejected",
        p_http_status: 400,
        p_reason: "Invalid featured checkout metadata.",
      });
    });

    it("records a rejected delivery for a featured amount mismatch", async () => {
      constructEventMock.mockReturnValue(
        featuredCheckoutEvent({ tier: "featured_7d", amountTotal: 3000 })
      );

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(400);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "rejected",
        p_http_status: 400,
        p_reason: "Checkout amount or currency does not match the featured listing.",
      });
    });

    it("records a rejected delivery when the featured checkout lacks a payment intent", async () => {
      constructEventMock.mockReturnValue(
        featuredCheckoutEvent({ tier: "featured_7d", paymentIntent: null })
      );

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(400);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "rejected",
        p_http_status: 400,
        p_reason: "Featured checkout has no payment intent.",
      });
    });

    it("records an errored delivery when featured listing creation fails", async () => {
      constructEventMock.mockReturnValue(featuredCheckoutEvent({ tier: "featured_7d" }));
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "listing failed" } });

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(500);
      expect(logCallArgs()).toMatchObject({
        p_outcome: "errored",
        p_http_status: 500,
        p_org_id: "org-f1",
        p_reason: "Featured listing creation failed.",
      });
    });
  });
});