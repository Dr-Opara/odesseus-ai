import { describe, expect, it, vi, beforeEach } from "vitest";

const createNotificationOnceMock = vi.fn();

vi.mock("@/lib/notifications/records", () => ({
  createNotificationOnce: (...args: unknown[]) => createNotificationOnceMock(...args),
}));

const client = { from: vi.fn() } as unknown as Parameters<
  typeof import("@/lib/notifications/live-premium").notifyPremiumInterviewPurchased
>[0];

describe("Premium Live purchase/renewal notifications (2N)", () => {
  beforeEach(() => {
    createNotificationOnceMock.mockReset();
    createNotificationOnceMock.mockResolvedValue({ id: "notif-1" });
  });

  it("records a purchase notice with an idempotent dedupe key", async () => {
    const { notifyPremiumInterviewPurchased } = await import(
      "@/lib/notifications/live-premium"
    );

    await notifyPremiumInterviewPurchased(client, {
      userId: "user-1",
      sku: "live_single",
      stripeEventId: "evt_123",
    });

    expect(createNotificationOnceMock).toHaveBeenCalledTimes(1);
    expect(createNotificationOnceMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        recipient_user_id: "user-1",
        recipient_type: "candidate",
        notification_type: "PREMIUM_INTERVIEW_PURCHASED",
        entity_type: "account",
        entity_id: "user-1",
        dedupe_key: "live:live_single:evt_123:purchased",
      })
    );
  });

  it("records a renewal notice keyed by subscription and period", async () => {
    const { notifyPremiumInterviewRenewal } = await import(
      "@/lib/notifications/live-premium"
    );

    await notifyPremiumInterviewRenewal(client, {
      userId: "user-1",
      stripeSubscriptionId: "sub_123",
      periodEnd: "2026-02-01T00:00:00.000Z",
    });

    expect(createNotificationOnceMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        notification_type: "PREMIUM_INTERVIEW_RENEWAL",
        dedupe_key: "live:sub_123:2026-02-01T00:00:00.000Z:renewal",
      })
    );
  });

  it("never throws, so fulfillment and sync stay green", async () => {
    createNotificationOnceMock.mockRejectedValueOnce(new Error("db down"));
    const { notifyPremiumInterviewPurchased, notifyPremiumInterviewRenewal } = await import(
      "@/lib/notifications/live-premium"
    );

    await expect(
      notifyPremiumInterviewPurchased(client, { userId: "user-1", sku: "live_monthly", stripeEventId: "evt_9" })
    ).resolves.toBeUndefined();
    await expect(
      notifyPremiumInterviewRenewal(client, { userId: "user-1", stripeSubscriptionId: "sub_9", periodEnd: null })
    ).resolves.toBeUndefined();
  });
});
