import { describe, expect, it, vi, beforeEach } from "vitest";
import { employerAddonPost } from "@/lib/billing/catalog";

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

function webhookRequest() {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig_test" },
  });
}

function addonCheckoutEvent(overrides: { quantity?: string; amountTotal?: number; currency?: string; orgId?: string | null }) {
  const { quantity = "3", amountTotal, currency = "usd", orgId = "org-a1" } = overrides;
  return {
    id: "evt_addon_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_addon_1",
        mode: "payment",
        created: 1_800_000_000,
        payment_status: "paid",
        amount_total: amountTotal ?? Number(quantity) * employerAddonPost.amountCents,
        currency,
        metadata: {
          ...(orgId ? { odesseus_org_id: orgId } : {}),
          odesseus_employer_addon: "true",
          odesseus_addon_quantity: quantity,
        },
      },
    },
  };
}

describe("Stripe webhook: additional job posts ($10 each)", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    constructEventMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: [{ credits_granted: 3 }], error: null });
  });

  it("grants quantity credits with their own 30-day clock from the payment time", async () => {
    constructEventMock.mockReturnValue(addonCheckoutEvent({}));
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    const [fnName, args] = rpcMock.mock.calls.find(([name]) => name === "odesseus_grant_employer_addon_credits") ?? [];
    expect(fnName).toBe("odesseus_grant_employer_addon_credits");
    expect(args).toEqual({
      p_org_id: "org-a1",
      p_quantity: 3,
      p_reference: "cs_addon_1",
      p_purchased_at: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("fails closed when the charge is not quantity x $10", async () => {
    constructEventMock.mockReturnValue(addonCheckoutEvent({ amountTotal: 2000 }));
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    expect(rpcMock.mock.calls.some(([name]) => name === "odesseus_grant_employer_addon_credits")).toBe(false);
  });

  it("fails closed on a non-USD charge or bad metadata", async () => {
    for (const event of [
      addonCheckoutEvent({ currency: "eur" }),
      addonCheckoutEvent({ quantity: "0", amountTotal: 0 }),
      addonCheckoutEvent({ orgId: null }),
    ]) {
      rpcMock.mockClear();
      constructEventMock.mockReturnValue(event);
      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(webhookRequest());
      expect(response.status).toBe(400);
      expect(rpcMock.mock.calls.some(([name]) => name === "odesseus_grant_employer_addon_credits")).toBe(false);
    }
  });

  it("acknowledges an employer subscription checkout instead of rejecting it", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_sub_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sub_1",
          mode: "subscription",
          payment_status: "paid",
          amount_total: 10000,
          currency: "usd",
          metadata: { odesseus_org_id: "org-a1", odesseus_tier: "ai_starter" },
        },
      },
    });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
  });
});
