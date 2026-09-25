import { describe, expect, it, vi, beforeEach } from "vitest";
import { employerPlans } from "@/lib/billing/catalog";

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

function invoicePaidEvent(overrides: {
  tier?: "starter" | "growth" | "business";
  orgId?: string;
  eventId?: string;
  amountPaid?: number | null;
  currency?: string;
  subscription?: string | null;
  periodStart?: number;
  periodEnd?: number;
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
  } = overrides;

  const plan = employerPlans[`employer_${tier}` as keyof typeof employerPlans];

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
          subscription_details: {
            metadata: { odesseus_org_id: orgId, odesseus_tier: tier },
            subscription,
          },
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
    periodStart?: number;
    periodEnd?: number;
  } = {}
) {
  const {
    tier = "starter",
    orgId = "org-1",
    eventId = type === "customer.subscription.deleted" ? "evt_sub_del_1" : "evt_sub_upd_1",
    status = "past_due",
    periodStart = 1_730_000_000,
    periodEnd = 1_732_000_000,
  } = overrides;

  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        metadata: { odesseus_org_id: orgId, odesseus_tier: tier },
      },
    },
  };
}

describe("Stripe webhook employer subscription sync", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    rpcMock.mockReset();
    createClientMock.mockClear();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("syncs an active employer subscription and grants its credits on invoice.paid", async () => {
    constructEventMock.mockReturnValue(invoicePaidEvent({ tier: "starter" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("odesseus_sync_employer_subscription");
    expect(args.p_org_id).toBe("org-1");
    expect(args.p_tier).toBe("starter");
    expect(args.p_status).toBe("active");
    expect(args.p_stripe_subscription_id).toBe("sub_1");
    expect(args.p_grant_credits).toBe(true);
    expect(args.p_period_start).toBe(new Date(1_730_000_000 * 1000).toISOString());
    expect(args.p_period_end).toBe(new Date(1_732_000_000 * 1000).toISOString());
  });

  it.each(["growth", "business"] as const)("syncs the %s tier at its catalog price", async (tier) => {
    constructEventMock.mockReturnValue(invoicePaidEvent({ tier }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_tier).toBe(tier);
  });

  it("fails closed when the invoiced amount does not match the plan price", async () => {
    constructEventMock.mockReturnValue(invoicePaidEvent({ amountPaid: 7901 }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed when the invoiced currency is not USD", async () => {
    constructEventMock.mockReturnValue(invoicePaidEvent({ currency: "eur" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("acknowledges and does not sync when the invoice is not an Odesseus employer subscription", async () => {
    const event = invoicePaidEvent({});
    (event.data.object as { parent: { subscription_details: { metadata: Record<string, string> } } }).parent.subscription_details.metadata = {};
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("syncs a past_due subscription without granting credits (lifecycle update)", async () => {
    constructEventMock.mockReturnValue(
      subscriptionLifecycleEvent("customer.subscription.updated", { status: "past_due" })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("odesseus_sync_employer_subscription");
    expect(args.p_status).toBe("past_due");
    expect(args.p_grant_credits).toBe(false);
  });

  it("records a deleted subscription as canceled", async () => {
    constructEventMock.mockReturnValue(
      subscriptionLifecycleEvent("customer.subscription.deleted")
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_status).toBe("canceled");
    expect(args.p_grant_credits).toBe(false);
  });

  it("returns 500 when the sync RPC fails", async () => {
    constructEventMock.mockReturnValue(invoicePaidEvent({}));
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(500);
  });

  it("ignores unknown lifecycle statuses without calling the RPC", async () => {
    constructEventMock.mockReturnValue(
      subscriptionLifecycleEvent("customer.subscription.updated", { status: "unpaid" })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

function recruiterSeatInvoicePaidEvent(overrides: {
  seatCount?: number;
  orgId?: string;
  eventId?: string;
  amountPaid?: number | null;
  currency?: string;
  subscription?: string | null;
  periodStart?: number;
  periodEnd?: number;
}) {
  const {
    seatCount = 3,
    orgId = "org-2",
    eventId = "evt_seat_inv_1",
    amountPaid,
    currency = "usd",
    subscription = "sub_seats_1",
    periodStart = 1_730_000_000,
    periodEnd = 1_732_000_000,
  } = overrides;

  const charged = amountPaid ?? seatCount * 2000;

  return {
    id: eventId,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_seat_1",
        customer: "cus_2",
        amount_paid: charged,
        total: charged,
        currency,
        status: "paid",
        period_start: periodStart,
        period_end: periodEnd,
        parent: {
          type: "subscription_details",
          subscription_details: {
            metadata: {
              odesseus_org_id: orgId,
              odesseus_recruiter_seats: "true",
              odesseus_seat_count: String(seatCount),
            },
            subscription,
          },
        },
      },
    },
  };
}

function recruiterSeatLifecycleEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  overrides: {
    seatCount?: number;
    orgId?: string;
    status?: string;
  } = {}
) {
  const { seatCount = 3, orgId = "org-2", status = "past_due" } = overrides;
  return {
    id: type === "customer.subscription.deleted" ? "evt_seat_sub_del_1" : "evt_seat_sub_upd_1",
    type,
    data: {
      object: {
        id: "sub_seats_1",
        customer: "cus_2",
        status,
        metadata: {
          odesseus_org_id: orgId,
          odesseus_recruiter_seats: "true",
          odesseus_seat_count: String(seatCount),
        },
      },
    },
  };
}

describe("Stripe webhook recruiter seat sync", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    rpcMock.mockReset();
    createClientMock.mockClear();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("syncs seats at seatCount x $20 on a paid invoice", async () => {
    constructEventMock.mockReturnValue(recruiterSeatInvoicePaidEvent({ seatCount: 4 }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("odesseus_sync_recruiter_seat");
    expect(args.p_org_id).toBe("org-2");
    expect(args.p_count).toBe(4);
    expect(args.p_status).toBe("active");
    expect(args.p_stripe_subscription_id).toBe("sub_seats_1");
    expect(args.p_period_start).toBe(new Date(1_730_000_000 * 1000).toISOString());
    expect(args.p_period_end).toBe(new Date(1_732_000_000 * 1000).toISOString());
  });

  it("fails closed when the seat amount does not match seatCount x $20", async () => {
    constructEventMock.mockReturnValue(
      recruiterSeatInvoicePaidEvent({ seatCount: 4, amountPaid: 7999 })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed on a non-USD seat invoice", async () => {
    constructEventMock.mockReturnValue(
      recruiterSeatInvoicePaidEvent({ currency: "gbp" })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("acknowledges an invoice lacking the recruiter-seat marker without syncing seats", async () => {
    const event = recruiterSeatInvoicePaidEvent({});
    (event.data.object as { parent: { subscription_details: { metadata: Record<string, string> } } }).parent.subscription_details.metadata = {
      odesseus_org_id: "org-2",
    };
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("syncs a canceled seat subscription as voided", async () => {
    constructEventMock.mockReturnValue(
      recruiterSeatLifecycleEvent("customer.subscription.deleted")
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("odesseus_sync_recruiter_seat");
    expect(args.p_status).toBe("canceled");
    expect(args.p_count).toBe(3);
  });

  it("returns 500 when the seat sync RPC fails", async () => {
    constructEventMock.mockReturnValue(recruiterSeatInvoicePaidEvent({}));
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(500);
  });
});