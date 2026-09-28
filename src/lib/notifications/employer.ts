/**
 * Employer member notification helper (Phase 2K).
 *
 * Emits a notification to every member plus the billing owner of an
 * organization. Used from server call sites that are not trigger-covered — for
 * example the Stripe webhook, whose subscription sync is the authoritative
 * point for EMPLOYER_SUBSCRIPTION_EVENT / EMPLOYER_PAYMENT_FAILED.
 *
 * Safety properties that matter on a money path:
 *
 *   - Dedupe keys are deterministic on (org, business event), so Stripe
 *     redeliveries and retry-job replays create each row once per recipient.
 *   - Never throws: a notification that fails must not fail a subscription
 *     sync. Errors are logged with the same prefix the webhook uses.
 *   - The org's billing channel preference is honored (default on).
 */

import { createServiceClient } from "@/lib/supabase/service";
import { createNotificationOnce } from "./records";
import type { NotificationType, NotificationPriority } from "./catalog";
import type { CreateNotificationInput } from "./records";

type CreateNotificationInputUnsafe = Omit<
  CreateNotificationInput,
  "recipient_user_id" | "recipient_type" | "organization_id"
>;

/**
 * Sends a notification to every authorized member + owner of the org. Returns
 * the number of recipients actually notified (channel gate + dedupe applied).
 * Never throws.
 */
export async function notifyEmployerMembers(
  orgId: string,
  input: CreateNotificationInputUnsafe,
  options: { dedupeTemplate?: string } = {}
): Promise<number> {
  const client = createServiceClient();
  const logPrefix = "[ODESSEUS_EMPLOYER_NOTIFICATION]";

  try {
    // Org channel gate, mirroring odesseus_private.notification_employer_gate:
    // a channel that is off suppresses recording for the whole org.
    const channel = channelFor(input.notification_type as NotificationType);
    if (channel) {
      const { data: prefs } = await client
        .from("employer_notification_preferences")
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();
      const row = prefs as Record<string, boolean | null> | null;
      if (prefs && row && row[channel] === false) {
        return 0;
      }
    }

    const { data: members } = await client
      .from("employer_members")
      .select("user_id")
      .eq("org_id", orgId);
    const { data: org } = await client
      .from("employer_organizations")
      .select("owner_user_id")
      .eq("id", orgId)
      .maybeSingle();

    const recipients = new Set<string>(
      (members ?? []).map((member) => member.user_id)
    );
    if (org?.owner_user_id) recipients.add(org.owner_user_id);

    let notified = 0;
    for (const userId of recipients) {
      const dedupeKey = options.dedupeTemplate
        ? options.dedupeTemplate.replace("{user}", userId)
        : input.dedupe_key ?? `employer:${orgId}:${input.entity_id}:${input.notification_type}`;
      const created = await createNotificationOnce(client, {
        ...input,
        recipient_user_id: userId,
        recipient_type: "employer_member",
        organization_id: orgId,
        dedupe_key: dedupeKey,
      });
      if (created) notified += 1;
    }
    return notified;
  } catch (error) {
    console.error(`${logPrefix} failed to notify org ${orgId}`, error);
    return 0;
  }
}

/**
 * The employer notification channel for a type — used only for the fine-grained
 * org prefs gate. Returns null for non-employer types (caller error guard).
 */
function channelFor(type: NotificationType): string | null {
  const employerChannels: Record<string, string> = {
    EMPLOYER_NEW_APPLICANT: "new_applicants",
    EMPLOYER_STRONG_FIT: "strong_fit",
    EMPLOYER_PIPELINE_UPDATED: "pipeline",
    EMPLOYER_INTERVIEW_EVENT: "interview_events",
    EMPLOYER_JOB_CAPACITY_WARNING: "capacity",
    EMPLOYER_JOB_CAPACITY_REACHED: "capacity",
    EMPLOYER_RECRUITER_SEAT_WARNING: "capacity",
    EMPLOYER_SUBSCRIPTION_EVENT: "billing",
    EMPLOYER_PAYMENT_FAILED: "billing",
    EMPLOYER_FEATURED_JOB_EXPIRING: "featured",
    EMPLOYER_FEATURED_JOB_EXPIRED: "featured",
  };
  return employerChannels[type] ?? null;
}

/**
 * Maps a Stripe subscription status to the employer notification it warrants.
 * `incomplete` is skipped (not a billable state) and anything unexpected
 * yields null (no notification).
 */
export function subscriptionStatusNotification(
  status: string
): { type: NotificationType; priority: NotificationPriority } | null {
  switch (status) {
    case "active":
    case "trialing":
      return { type: "EMPLOYER_SUBSCRIPTION_EVENT", priority: "normal" };
    case "past_due":
      return { type: "EMPLOYER_PAYMENT_FAILED", priority: "urgent" };
    case "canceled":
      return { type: "EMPLOYER_SUBSCRIPTION_EVENT", priority: "normal" };
    default:
      return null;
  }
}

/**
 * Emits the subscription-status notification after a successful employer
 * subscription sync. Dedupe is per (subscription, status) so Stripe webhook
 * redeliveries of past_due don't stack rows. Never throws.
 */
export async function notifyEmployerSubscriptionStatus(args: {
  orgId: string;
  status: string;
  stripeSubscriptionId: string | null;
  tier?: string | null;
}): Promise<void> {
  const mapped = subscriptionStatusNotification(args.status);
  if (!mapped) return;

  const isFailed = mapped.type === "EMPLOYER_PAYMENT_FAILED";
  const tierLabel = args.tier ? ` (${args.tier} plan)` : "";
  const stripeId = args.stripeSubscriptionId ?? "unknown";
  const dedupeTemplate = `employer:${args.orgId}:subscription:${stripeId}:${args.status}:{user}`;

  await notifyEmployerMembers(
    args.orgId,
    {
      notification_type: mapped.type,
      title: isFailed
        ? "A payment for your Odesseus plan failed"
        : `Your Odesseus plan is ${args.status}${tierLabel}`,
      message: isFailed
        ? "Update your payment method to keep your job postings active."
        : `Your subscription is now ${args.status}.`,
      entity_type: "employer_organization",
      entity_id: args.orgId,
      action_url: "/employers",
      priority: mapped.priority,
      metadata: {
        stripe_subscription_id: args.stripeSubscriptionId,
        status: args.status,
        tier: args.tier ?? null,
      },
    },
    { dedupeTemplate }
  );
}