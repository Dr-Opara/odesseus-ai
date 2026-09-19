import { describe, expect, it, vi, beforeEach } from "vitest";
import { billingCatalog } from "@/lib/billing/catalog";

const constructEventMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
const createClientMock = vi.fn(() => ({ from: fromMock }));

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
}) {
  const {
    sku = "app_1",
    userId = "user-1",
    paymentStatus = "paid",
    eventId = "evt_test_1",
    amountTotal = null,
  } = overrides;

  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        payment_status: paymentStatus,
        amount_total: amountTotal,
        currency: "usd",
        customer: "cus_test_1",
        payment_intent: "pi_test_1",
        metadata: { odysseus_user_id: userId, sku },
      },
    },
  };
}

describe("Stripe webhook fulfillment", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    insertMock.mockReset();
    fromMock.mockClear();
    createClientMock.mockClear();
    insertMock.mockResolvedValue({ error: null });
  });

  it.each(Object.keys(billingCatalog) as Array<keyof typeof billingCatalog>)(
    "fulfills sku %s with its exact catalog price and credit delta",
    async (sku) => {
      const item = billingCatalog[sku];
      constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku }));

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(insertMock).toHaveBeenCalledTimes(1);
      const inserted = insertMock.mock.calls[0][0];
      expect(inserted.sku).toBe(sku);
      expect(inserted.amount_cents).toBe(item.amountCents);
      expect(inserted.credit_delta).toBe(item.creditDelta);
      expect(inserted.credit_type).toBe(item.creditType);
    }
  );

  it("does not fulfill (no billing_events insert) when payment_status is not paid", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ paymentStatus: "unpaid" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does not fulfill an unrecognized sku", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku: "not_a_real_sku" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does not fulfill when checkout metadata is missing a user id", async () => {
    const event = checkoutCompletedEvent({});
    delete (event.data.object.metadata as { odysseus_user_id?: string }).odysseus_user_id;
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid Stripe signature and does not fulfill", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("is idempotent: a duplicate stripe_event_id reports success without a second fulfillment side effect", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ eventId: "evt_dup_1" }));
    insertMock.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
    // The unique-constraint violation on billing_events.stripe_event_id is
    // what stops double fulfillment — the fulfill_billing_event() DB trigger
    // never fires for the rejected insert, so no second credit/entitlement
    // grant occurs. See supabase/migrations/20260919073750_add_live_annual_entitlement.sql.
  });

  it("surfaces a 500 when fulfillment fails for a reason other than a duplicate event", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({}));
    insertMock.mockResolvedValue({ error: { code: "23503", message: "fk violation" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(500);
  });

  it("routes the annual plan through the interview credit_type with its dedicated sku, per the entitlement migration's design", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku: "interview_annual" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    await POST(webhookRequest("{}"));

    const inserted = insertMock.mock.calls[0][0];
    expect(inserted.sku).toBe("interview_annual");
    expect(inserted.credit_type).toBe("interview");
    expect(inserted.amount_cents).toBe(49900);
  });
});
