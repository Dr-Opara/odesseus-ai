/**
 * Premium Live purchase/renewal notifications (Phase 2N).
 *
 * Best-effort by design: these helpers never throw. A notification failure
 * must never fail a money-verified webhook fulfillment or a membership sync.
 * Idempotency comes from createNotificationOnce on
 * (recipient_user_id, dedupe_key).
 */

import { createNotificationOnce } from "./records";
import type { NotificationClient } from "./service";

function swallow(scope: string, error: unknown): void {
  console.error(`[ODESSEUS_PREMIUM_NOTIFY] ${scope} failed`, error);
}

export async function notifyPremiumInterviewPurchased(
  client: NotificationClient,
  input: { userId: string; sku: string; stripeEventId: string }
): Promise<void> {
  try {
    await createNotificationOnce(client, {
      recipient_user_id: input.userId,
      recipient_type: "candidate",
      notification_type: "PREMIUM_INTERVIEW_PURCHASED",
      title: "Odesseus Live unlocked",
      message: "Your Live interview access is ready.",
      entity_type: "account",
      entity_id: input.userId,
      dedupe_key: `live:${input.sku}:${input.stripeEventId}:purchased`,
      priority: "normal",
    });
  } catch (error) {
    swallow("purchase", error);
  }
}

export async function notifyPremiumInterviewRenewal(
  client: NotificationClient,
  input: { userId: string; stripeSubscriptionId: string; periodEnd: string | null }
): Promise<void> {
  try {
    await createNotificationOnce(client, {
      recipient_user_id: input.userId,
      recipient_type: "candidate",
      notification_type: "PREMIUM_INTERVIEW_RENEWAL",
      title: "Odesseus Live renewed",
      message: "Your Live interview access continues.",
      entity_type: "account",
      entity_id: input.userId,
      dedupe_key: `live:${input.stripeSubscriptionId}:${input.periodEnd ?? "open"}:renewal`,
      priority: "normal",
    });
  } catch (error) {
    swallow("renewal", error);
  }
}
