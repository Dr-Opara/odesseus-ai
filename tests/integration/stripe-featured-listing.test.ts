import { describe, expect, it, vi, beforeEach } from "vitest";
import { employerFeaturedTiers } from "@/lib/billing/catalog";

const constructEventMock = vi.fn();
const rpcMock = vi.fn();
const createClientMock = vi.fn(() => ({ rpc: rpcMock }));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: constructEventMock } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createClientMock(),
}));
vi.mock("@/lib/observability/events", () => ({
  logWebhookEvent: vi.fn(async () => undefined),
}));

function webhookRequest(body: string) {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": "sig_test" },
  });
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

describe("Stripe webhook featured listing creation", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    rpcMock.mockReset();
    createClientMock.mockClear();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it.each(Object.keys(employerFeaturedTiers) as Array<keyof typeof employerFeaturedTiers>)(
    "creates a %s listing at its exact catalog price",
    async (tier) => {
      const item = employerFeaturedTiers[tier];
      constructEventMock.mockReturnValue(featuredCheckoutEvent({ tier }));

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(rpcMock).toHaveBeenCalledTimes(1);
      const [fnName, args] = rpcMock.mock.calls[0];
      expect(fnName).toBe("odesseus_create_featured_listing");
      expect(args.p_org_id).toBe("org-f1");
      expect(args.p_job_id).toBe("job-f1");
      expect(args.p_tier).toBe(tier);
      expect(args.p_stripe_payment_intent).toBe("pi_featured_1");
    }
  );

  it("fails closed when the charged amount does not match the featured tier price", async () => {
    constructEventMock.mockReturnValue(
      featuredCheckoutEvent({ tier: "featured_7d", amountTotal: 3000 })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed on a non-USD featured checkout", async () => {
    constructEventMock.mockReturnValue(
      featuredCheckoutEvent({ currency: "eur" })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects featured checkout metadata without an org or job id", async () => {
    const event = featuredCheckoutEvent({});
    delete (event.data.object.metadata as { odesseus_org_id?: string }).odesseus_org_id;
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown featured tier", async () => {
    const event = featuredCheckoutEvent({});
    (event.data.object.metadata as { odesseus_featured_tier: string }).odesseus_featured_tier = "platinum";
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a paid featured session without a payment intent", async () => {
    constructEventMock.mockReturnValue(
      featuredCheckoutEvent({ paymentIntent: null })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not create a listing when payment_status is not paid", async () => {
    const event = featuredCheckoutEvent({}) as { data: { object: { payment_status: string } } };
    event.data.object.payment_status = "unpaid";
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the listing RPC fails", async () => {
    constructEventMock.mockReturnValue(featuredCheckoutEvent({}));
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(500);
  });
});