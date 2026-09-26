/**
 * Stripe seat quantity synchronization.
 *
 * Removing someone from an employer team frees seat *capacity* immediately,
 * because capacity is derived live from `employer_members`. It does not, on its
 * own, stop Stripe charging $20/month for a seat nobody occupies. This module
 * closes that gap: it recomputes what the roster needs and resizes the paid
 * subscription to match.
 *
 * Three design decisions are load-bearing, so they are stated here rather than
 * left to the call site.
 *
 * 1. The target is DERIVED, never decremented.
 *    Every run recomputes the required count from the roster via
 *    `odesseus_org_required_seat_count`. Recomputing yields the same answer
 *    however many times it runs, so a retry, a duplicate webhook, or two
 *    concurrent removals can never double-adjust the subscription the way a
 *    counter could. It also means the sync self-heals: if a previous attempt
 *    failed halfway, simply running again converges on the right quantity.
 *
 * 2. Duplicate execution is stopped at the database, not in this process.
 *    The deterministic idempotency key is claimed through
 *    `odesseus_claim_seat_adjustment` before Stripe is called. A second
 *    execution of the same adjustment loses the unique index and skips the
 *    Stripe call. An in-process check could not survive two concurrent
 *    serverless invocations. (The route also 404s a repeated removal earlier,
 *    because the membership row is already gone -- this is the second,
 *    independent layer.)
 *
 * 3. A failed attempt releases its claim.
 *    `odesseus_finish_seat_adjustment` clears the idempotency key on 'failed'.
 *    Without that, one transient Stripe outage would block that exact
 *    adjustment from ever being retried.
 *
 * Entitlement is never granted here. `recruiter_seats` is still written only by
 * the money-verified webhook path; this module asks Stripe to resize, and the
 * `customer.subscription.updated` event that follows is what moves the
 * entitlement.
 *
 * The zero case: Stripe's minimum subscription quantity is 1, so "no members
 * need a seat" cannot be expressed as quantity 0. The last seat is therefore
 * cancelled at period end rather than cut short. The customer keeps the month
 * they paid for, and the existing deletion webhook then voids the entitlement.
 * Cutting the subscription immediately would refund nothing and revoke a seat
 * the customer had already bought.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStripe } from "@/lib/stripe";

/** Terminal outcomes, mirroring `employer_seat_adjustments_outcome_check`. */
export type SeatSyncOutcome =
  | "updated"
  | "cancelled_at_period_end"
  | "no_change"
  | "skipped_no_subscription"
  | "failed"
  | "already_applied";

export type SeatSyncResult = {
  outcome: SeatSyncOutcome;
  /** What the roster needs now. */
  required: number;
  /** The quantity Stripe was asked to bill, before the call. */
  previous: number | null;
  subscriptionId: string | null;
  /** Present only when outcome is 'failed'. Safe to log: never a secret. */
  detail?: string;
};

export type SeatSyncClient = SupabaseClient<Database>;

/**
 * Deterministic per (org, removed member, target quantity). Two runs that
 * would produce the same Stripe update therefore share one claim.
 */
export function seatAdjustmentKey(
  orgId: string,
  removedUserId: string | null,
  newQuantity: number
): string {
  return `seat-sync:${orgId}:${removedUserId ?? "none"}:${newQuantity}`;
}

/**
 * Resize an org's paid seat subscription to match the roster.
 *
 * Safe to call after any membership change. `removedUserId` is only part of the
 * idempotency key; it never influences the target quantity, which always comes
 * from the roster.
 */
export async function syncSeatsAfterMemberChange(
  client: SeatSyncClient,
  input: { orgId: string; removedUserId: string | null }
): Promise<SeatSyncResult> {
  const { orgId, removedUserId } = input;

  // What the roster needs. Derived, not tracked.
  const { data: required, error: requiredError } = await client.rpc(
    "odesseus_org_required_seat_count",
    { p_org_id: orgId }
  );
  if (requiredError) {
    // Without the target there is nothing safe to do; refuse rather than guess.
    return {
      outcome: "failed",
      required: 0,
      previous: null,
      subscriptionId: null,
      detail: `required seat count unavailable: ${requiredError.message}`,
    };
  }
  const requiredCount = typeof required === "number" ? required : 0;

  const { data: entitlement, error: entitlementError } = await client.rpc(
    "odesseus_org_live_seat_subscription",
    { p_org_id: orgId }
  );
  if (entitlementError) {
    return {
      outcome: "failed",
      required: requiredCount,
      previous: null,
      subscriptionId: null,
      detail: `seat entitlement unavailable: ${entitlementError.message}`,
    };
  }

  const live = Array.isArray(entitlement) ? entitlement[0] : undefined;
  const subscriptionId = live?.stripe_subscription_id ?? null;
  const currentQuantity = typeof live?.seat_count === "number" ? live.seat_count : null;

  // No paid seat subscription at all: the org never bought one, or it already
  // lapsed. There is nothing to resize. Capacity is still correct, because it
  // is derived from the roster.
  if (!subscriptionId || currentQuantity === null) {
    return {
      outcome: "skipped_no_subscription",
      required: requiredCount,
      previous: currentQuantity,
      subscriptionId,
    };
  }

  // A removal can only lower the requirement. If the org is already paying for
  // fewer seats than it needs, that is an under-payment the admin surfaces by
  // buying seats, not something a removal should silently raise.
  if (requiredCount >= currentQuantity) {
    return {
      outcome: "no_change",
      required: requiredCount,
      previous: currentQuantity,
      subscriptionId,
    };
  }

  const key = seatAdjustmentKey(orgId, removedUserId, requiredCount);
  const { data: claimed, error: claimError } = await client.rpc(
    "odesseus_claim_seat_adjustment",
    {
      p_idempotency_key: key,
      p_org_id: orgId,
      p_new_quantity: requiredCount,
      p_removed_user_id: removedUserId,
      p_stripe_subscription_id: subscriptionId,
      p_previous_quantity: currentQuantity,
    }
  );
  if (claimError) {
    return {
      outcome: "failed",
      required: requiredCount,
      previous: currentQuantity,
      subscriptionId,
      detail: `seat adjustment claim failed: ${claimError.message}`,
    };
  }
  if (!claimed) {
    // An identical adjustment is already recorded. Do not call Stripe again.
    return {
      outcome: "already_applied",
      required: requiredCount,
      previous: currentQuantity,
      subscriptionId,
    };
  }

  try {
    const outcome = requiredCount === 0
      ? await cancelAtPeriodEnd(subscriptionId)
      : await resizeTo(subscriptionId, requiredCount);
    await finish(client, key, outcome);
    return {
      outcome,
      required: requiredCount,
      previous: currentQuantity,
      subscriptionId,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Release the claim so the adjustment can be retried, and record why.
    await finish(client, key, "failed", detail);
    return {
      outcome: "failed",
      required: requiredCount,
      previous: currentQuantity,
      subscriptionId,
      detail,
    };
  }
}

/**
 * Resize the seat line item and align the subscription metadata.
 *
 * The metadata matters: `odesseus_recruiter_seats` / `odesseus_seat_count` is
 * what the webhook reads to know how many seats were paid for, and
 * `handleRecruiterSeatInvoicePaid` refuses any invoice whose amount is not
 * exactly seatCount x $20. Leaving the old count behind would make the *next
 * legitimate renewal* look like a tampered invoice and get it rejected.
 *
 * `create_prorations` gives the customer credit for the unused remainder of the
 * period, which is the correct treatment for a downgrade. The resulting proration
 * invoice grants nothing (the webhook records it as ignored) -- the quantity
 * change itself is applied by the `customer.subscription.updated` event.
 */
async function resizeTo(subscriptionId: string, quantity: number): Promise<"updated"> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];
  if (!item) {
    throw new Error(`subscription ${subscriptionId} has no seat line item`);
  }

  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: "create_prorations",
    metadata: {
      ...subscription.metadata,
      odesseus_recruiter_seats: "true",
      odesseus_seat_count: String(quantity),
    },
  });
  return "updated";
}

/**
 * Schedule the seat subscription to lapse at the end of the paid period.
 *
 * Stripe will not accept quantity 0, and cancelling immediately would revoke a
 * seat the customer already paid for. The metadata is deliberately left intact:
 * `recruiterSeatSyncFromMetadata` returns null for a count below 1, so zeroing
 * the metadata would make the eventual `customer.subscription.deleted` event
 * unrecognised and the entitlement would never be voided.
 */
async function cancelAtPeriodEnd(
  subscriptionId: string
): Promise<"cancelled_at_period_end"> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  return "cancelled_at_period_end";
}

async function finish(
  client: SeatSyncClient,
  key: string,
  outcome: Exclude<SeatSyncOutcome, "already_applied">,
  error?: string
): Promise<void> {
  const { error: finishError } = await client.rpc("odesseus_finish_seat_adjustment", {
    p_idempotency_key: key,
    p_outcome: outcome,
    p_error: error ?? null,
  });
  if (finishError) {
    // The Stripe call already happened, so the outcome is real even if we could
    // not record it. Surface it loudly rather than pretending the sync is clean:
    // a pending row that never resolves would block that adjustment's retry.
    console.error(
      "[ODESSEUS_EMPLOYER_SEATS] could not record seat adjustment outcome",
      key,
      finishError.message
    );
  }
}
