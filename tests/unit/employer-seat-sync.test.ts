import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  seatAdjustmentKey,
  syncSeatsAfterMemberChange,
  type SeatSyncClient,
} from "@/lib/employer/seat-sync";

const retrieve = vi.fn();
const update = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve, update } }),
}));

const ORG = "52222222-2222-4222-8222-222222222222";
const MEMBER = "51111111-1111-4111-8111-222222222222";

/**
 * A stand-in for the three RPCs the sync uses. `claimed` models the unique
 * index: the first claim wins, a repeat of the same key collides.
 */
function syncDb(opts: {
  required?: number | null;
  requiredError?: { message: string } | null;
  entitlement?: unknown;
  entitlementError?: { message: string } | null;
  claimResult?: boolean;
  claimError?: { message: string } | null;
  finishError?: { message: string } | null;
} = {}) {
  const state = {
    requiredCalls: 0,
    entitlementCalls: 0,
    claims: [] as Array<Record<string, unknown>>,
    finishes: [] as Array<Record<string, unknown>>,
  };

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "odesseus_org_required_seat_count") {
        state.requiredCalls += 1;
        return { data: opts.required ?? 0, error: opts.requiredError ?? null };
      }
      if (fn === "odesseus_org_live_seat_subscription") {
        state.entitlementCalls += 1;
        return {
          data: opts.entitlement === undefined ? [] : opts.entitlement,
          error: opts.entitlementError ?? null,
        };
      }
      if (fn === "odesseus_claim_seat_adjustment") {
        state.claims.push(args);
        return { data: opts.claimResult ?? true, error: opts.claimError ?? null };
      }
      if (fn === "odesseus_finish_seat_adjustment") {
        state.finishes.push(args);
        return { data: null, error: opts.finishError ?? null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
  };

  return { client: client as unknown as SeatSyncClient, state };
}

function entitlement(overrides: Record<string, unknown> = {}) {
  return [
    {
      seat_count: 3,
      active_until: "2026-12-01T00:00:00Z",
      stripe_subscription_id: "sub_seats_1",
      stripe_customer_id: "cus_1",
      ...overrides,
    },
  ];
}

beforeEach(() => {
  retrieve.mockReset();
  update.mockReset();
  retrieve.mockResolvedValue({
    id: "sub_seats_1",
    metadata: {
      odesseus_recruiter_seats: "true",
      odesseus_seat_count: "3",
      odesseus_org_id: ORG,
    },
    items: { data: [{ id: "si_1", quantity: 3 }] },
  });
  update.mockResolvedValue({});
});

describe("seatAdjustmentKey", () => {
  it("is deterministic for the same adjustment", () => {
    expect(seatAdjustmentKey(ORG, MEMBER, 2)).toBe(seatAdjustmentKey(ORG, MEMBER, 2));
  });

  it("differs when the target quantity differs", () => {
    // Two different downgrades must not share a claim, or the second would be
    // silently skipped as a duplicate.
    expect(seatAdjustmentKey(ORG, MEMBER, 2)).not.toBe(seatAdjustmentKey(ORG, MEMBER, 1));
  });

  it("differs per removed member", () => {
    expect(seatAdjustmentKey(ORG, MEMBER, 2)).not.toBe(
      seatAdjustmentKey(ORG, "5ccccccc-cccc-4ccc-8ccc-cccccccccccc", 2)
    );
  });
});

describe("syncSeatsAfterMemberChange", () => {
  it("derives the target from the roster instead of decrementing", async () => {
    const { client, state } = syncDb({ required: 2, entitlement: entitlement() });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("updated");
    expect(result.required).toBe(2);
    expect(result.previous).toBe(3);
    // The target came from the roster RPC, and a second run asks again rather
    // than trusting a stored counter.
    expect(state.requiredCalls).toBe(1);
    expect(update).toHaveBeenCalledWith(
      "sub_seats_1",
      expect.objectContaining({
        items: [{ id: "si_1", quantity: 2 }],
      })
    );
  });

  it("aligns the seat-count metadata so the next renewal is not rejected", async () => {
    const { client } = syncDb({ required: 2, entitlement: entitlement() });
    await syncSeatsAfterMemberChange(client, { orgId: ORG, removedUserId: MEMBER });

    // The webhook prices an invoice as seatCount x $20 from this metadata. A
    // stale count would make the next legitimate renewal look tampered.
    expect(update).toHaveBeenCalledWith(
      "sub_seats_1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          odesseus_recruiter_seats: "true",
          odesseus_seat_count: "2",
        }),
      })
    );
  });

  it("credits the unused remainder of the paid period", async () => {
    const { client } = syncDb({ required: 2, entitlement: entitlement() });
    await syncSeatsAfterMemberChange(client, { orgId: ORG, removedUserId: MEMBER });
    // A downgrade should give the customer money back for the rest of the month.
    expect(update).toHaveBeenCalledWith(
      "sub_seats_1",
      expect.objectContaining({ proration_behavior: "create_prorations" })
    );
  });

  it("preserves unrelated subscription metadata", async () => {
    const { client } = syncDb({ required: 2, entitlement: entitlement() });
    await syncSeatsAfterMemberChange(client, { orgId: ORG, removedUserId: MEMBER });
    const arg = update.mock.calls[0][1] as { metadata: Record<string, string> };
    expect(arg.metadata.odesseus_org_id).toBe(ORG);
  });

  it("skips Stripe when the quantity is already correct", async () => {
    const { client, state } = syncDb({ required: 3, entitlement: entitlement() });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("no_change");
    expect(update).not.toHaveBeenCalled();
    // No claim is taken, so a later real adjustment is not blocked by this one.
    expect(state.claims).toHaveLength(0);
  });

  it("does not raise the quantity when the roster needs more seats than are paid", async () => {
    const { client } = syncDb({ required: 5, entitlement: entitlement() });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    // Under-payment is surfaced by the team screen, not silently charged here.
    expect(result.outcome).toBe("no_change");
    expect(update).not.toHaveBeenCalled();
  });

  it("skips when the org has no live paid seat subscription", async () => {
    const { client, state } = syncDb({ required: 1, entitlement: [] });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("skipped_no_subscription");
    expect(update).not.toHaveBeenCalled();
    expect(state.claims).toHaveLength(0);
  });

  it("skips when the entitlement has no Stripe subscription id", async () => {
    const { client } = syncDb({
      required: 1,
      entitlement: entitlement({ stripe_subscription_id: null }),
    });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });
    expect(result.outcome).toBe("skipped_no_subscription");
    expect(update).not.toHaveBeenCalled();
  });

  it("cancels at period end when the last seat is removed", async () => {
    const { client } = syncDb({ required: 0, entitlement: entitlement({ seat_count: 1 }) });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    // Stripe's minimum quantity is 1, so zero cannot be expressed directly.
    expect(result.outcome).toBe("cancelled_at_period_end");
    expect(update).toHaveBeenCalledWith("sub_seats_1", {
      cancel_at_period_end: true,
    });
    // Metadata is left alone on purpose: zeroing odesseus_seat_count would make
    // the eventual subscription.deleted event unrecognisable, and the
    // entitlement would never be voided.
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("does not call Stripe again when the identical adjustment is already claimed", async () => {
    const { client, state } = syncDb({
      required: 2,
      entitlement: entitlement(),
      claimResult: false,
    });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("already_applied");
    expect(update).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(state.claims).toHaveLength(1);
  });

  it("records the terminal outcome so the audit row does not stay pending", async () => {
    const { client, state } = syncDb({ required: 2, entitlement: entitlement() });
    await syncSeatsAfterMemberChange(client, { orgId: ORG, removedUserId: MEMBER });

    expect(state.finishes).toEqual([
      {
        p_idempotency_key: seatAdjustmentKey(ORG, MEMBER, 2),
        p_outcome: "updated",
        p_error: null,
      },
    ]);
  });

  it("releases the claim when Stripe fails, so a retry can pick it up", async () => {
    update.mockRejectedValue(new Error("stripe is down"));
    const { client, state } = syncDb({ required: 2, entitlement: entitlement() });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("failed");
    expect(result.detail).toContain("stripe is down");
    // 'failed' is what makes odesseus_finish_seat_adjustment clear the key.
    expect(state.finishes[0]).toMatchObject({ p_outcome: "failed" });
    expect((state.finishes[0] as { p_error: string }).p_error).toContain("stripe is down");
  });

  it("releases the claim when the subscription has no seat line item", async () => {
    retrieve.mockResolvedValue({
      id: "sub_seats_1",
      metadata: {},
      items: { data: [] },
    });
    const { client, state } = syncDb({ required: 2, entitlement: entitlement() });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("failed");
    expect(update).not.toHaveBeenCalled();
    expect(state.finishes[0]).toMatchObject({ p_outcome: "failed" });
  });

  it("refuses to guess when the required count is unavailable", async () => {
    const { client } = syncDb({
      requiredError: { message: "db down" },
      entitlement: entitlement(),
    });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    // Without a trustworthy target, resizing Stripe would be guessing.
    expect(result.outcome).toBe("failed");
    expect(update).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("refuses to guess when the seat entitlement is unavailable", async () => {
    const { client } = syncDb({
      required: 2,
      entitlementError: { message: "db down" },
    });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    expect(result.outcome).toBe("failed");
    expect(update).not.toHaveBeenCalled();
  });

  it("fails when the claim itself is rejected", async () => {
    const { client } = syncDb({
      required: 2,
      entitlement: entitlement(),
      claimError: { message: "invalid seat adjustment idempotency key" },
    });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    // No claim means no duplicate protection, so Stripe must not be called.
    expect(result.outcome).toBe("failed");
    expect(update).not.toHaveBeenCalled();
  });

  it("still reports the real outcome when the audit write fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = syncDb({
      required: 2,
      entitlement: entitlement(),
      finishError: { message: "audit write failed" },
    });
    const result = await syncSeatsAfterMemberChange(client, {
      orgId: ORG,
      removedUserId: MEMBER,
    });

    // Stripe was resized; pretending this failed would be the more dangerous lie.
    expect(result.outcome).toBe("updated");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
