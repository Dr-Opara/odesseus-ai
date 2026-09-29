import { describe, expect, it, vi, beforeEach } from "vitest";
import { billingCatalog } from "@/lib/billing/catalog";

const constructEventMock = vi.fn();
const billingInsertMock = vi.fn();
const notificationInsertMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === "billing_events") return { insert: billingInsertMock };
  if (table === "notifications") return { insert: notificationInsertMock };
  return { insert: vi.fn() };
});
const createClientMock = vi.fn(() => ({ from: fromMock }));

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

  // Fulfillment requires the charged amount to match the catalog price, so
  // tests default the session amount to the SKU's exact price. Pass an
  // explicit amountTotal override to exercise mismatch paths.
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

describe("Stripe webhook fulfillment", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    billingInsertMock.mockReset();
    notificationInsertMock.mockReset();
    fromMock.mockClear();
    createClientMock.mockClear();
    billingInsertMock.mockResolvedValue({ error: null });
    notificationInsertMock.mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: "notif-1" }, error: null }),
      }),
    });
  });

  it.each(Object.keys(billingCatalog) as Array<keyof typeof billingCatalog>)(
    "fulfills sku %s with its exact catalog price and credit delta",
    async (sku) => {
      const item = billingCatalog[sku];
      constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku }));

      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest("{}"));

      expect(response.status).toBe(200);
      expect(billingInsertMock).toHaveBeenCalledTimes(1);
      const inserted = billingInsertMock.mock.calls[0][0];
      expect(inserted.sku).toBe(sku);
      expect(inserted.amount_cents).toBe(item.amountCents);
      expect(inserted.credit_delta).toBe(item.creditDelta);
      expect(inserted.credit_type).toBe(item.creditType);

      // 2N premium wire: only Live checkouts earn the purchase notice.
      if (item.creditType === "interview") {
        expect(notificationInsertMock).toHaveBeenCalledTimes(1);
        expect(notificationInsertMock).toHaveBeenCalledWith(
          expect.objectContaining({
            notification_type: "PREMIUM_INTERVIEW_PURCHASED",
            recipient_type: "candidate",
          })
        );
      } else {
        expect(notificationInsertMock).not.toHaveBeenCalled();
      }
    }
  );

  it("does not fulfill (no billing_events insert) when payment_status is not paid", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ paymentStatus: "unpaid" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("does not fulfill an unrecognized sku", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku: "not_a_real_sku" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("fails closed when the charged amount does not match the catalog price", async () => {
    // The metadata names wallet_10 ($10 top-up) but the session charged $15.
    // A tampered or mismatched amount must never credit the catalog delta.
    constructEventMock.mockReturnValue(
      checkoutCompletedEvent({ sku: "wallet_10", amountTotal: 1500 })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("fails closed when the currency is not USD", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompletedEvent({ sku: "wallet_10", currency: "eur" })
    );

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("fails closed when the session carries no amount at all", async () => {
    const event = checkoutCompletedEvent({ sku: "wallet_10" }) as {
      data: { object: { amount_total: number | null } };
    };
    event.data.object.amount_total = null;
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("does not fulfill when checkout metadata is missing a user id", async () => {
    const event = checkoutCompletedEvent({});
    delete (event.data.object.metadata as { odesseus_user_id?: string }).odesseus_user_id;
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid Stripe signature and does not fulfill", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(billingInsertMock).not.toHaveBeenCalled();
  });

  it("is idempotent: a duplicate stripe_event_id reports success without a second fulfillment side effect", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ eventId: "evt_dup_1" }));
    billingInsertMock.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

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
    billingInsertMock.mockResolvedValue({ error: { code: "23503", message: "fk violation" } });

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(500);
  });

  it("routes the personal annual plan's first billing_events row through the interview credit_type, distinguished by its dedicated sku", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent({ sku: "live_personal_annual" }));

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    await POST(webhookRequest("{}"));

    const inserted = billingInsertMock.mock.calls[0][0];
    expect(inserted.sku).toBe("live_personal_annual");
    // billing_events_credit_type_check admits only application/interview/
    // wallet_topup; odesseus_private.fulfill_billing_event branches on `sku`
    // (not credit_type) to grant a live_memberships row for this plan
    // instead of a discrete interview_passes credit.
    expect(inserted.credit_type).toBe("interview");
    expect(inserted.amount_cents).toBe(9900);
  });
});
