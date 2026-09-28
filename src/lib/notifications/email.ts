/**
 * Notification email dispatch (Phase 2K).
 *
 * Pipeline: triggers write the notification row with email_delivery_status =
 * 'none'. /api/cron/process-notification-emails drains the backlog: for each
 * pending row it decides whether an email is wanted (type is email-capable AND
 * the recipient's email switch is on), resolves the recipient's address from
 * the auth record, enqueues an `email_delivery` retry job with a deterministic
 * idempotency key, and advances the row to 'queued'/'skipped'.
 *
 * Properties this design leans on, all pre-existing:
 *
 *   - The originating business transaction never touches the email provider;
 *     the notification row and the email queue both live in Postgres, so a
 *     down provider can never fail an application, wallet charge or sync.
 *   - Duplicate sends are impossible: `odesseus_enqueue_retry_job` dedupes on
 *     (job_type, idempotency_key), so even two overlapping cron ticks that read
 *     the same 'none' rows enqueue one job, and the `email_delivery` retry
 *     handler is the only sender.
 *   - Delivery follows the retry queue: handler failure retries with backoff,
 *     and on success the handler flips the row to 'sent' via `notificationId`.
 *
 * The planner (`planNotificationEmailActions`) is pure and unit-tested; the
 * worker wires it to the service client.
 */

import { enqueueRetryJob, emailDeliveryIdempotencyKey } from "@/lib/retry/service";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isEmailCapable,
  type NotificationType,
  type NotificationRecipient,
} from "./catalog";
import type { NotificationRow } from "./records";

/**
 * The wallet balance (cents) below which WALLET_LOW_BALANCE fires. Mirrors
 * odesseus_private.notification_wallet_low_threshold_cents(); the migration
 * contract test pins both to the same value.
 */
export const WALLET_LOW_THRESHOLD_CENTS = 500;

/** Emails are enqueued with this prefix so retry logs read clearly. */
export const NOTIFICATION_EMAIL_LOG_PREFIX = "[ODESSEUS_NOTIFICATION_EMAIL]";

export type NotificationEmailDraft = {
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
};

/** Deterministic preference key: candidate rows key on the user, employer on the org. */
export function recipientPreferenceKey(
  recipientType: NotificationRecipient,
  organizationId: string | null
): string {
  return recipientType === "employer_member"
    ? `employer:${organizationId ?? ""}`
    : "candidate";
}

/**
 * The generic email draft for a notification. `to` is filled in by the worker
 * after address resolution. A missing message body degrades to a plain
 * "Open Odesseus" line rather than an empty paragraph.
 */
export function buildNotificationEmail(
  notification: Pick<
    NotificationRow,
    "title" | "message" | "action_url"
  >
): NotificationEmailDraft {
  return {
    subject: `Odesseus: ${notification.title}`,
    heading: notification.title,
    body: notification.message?.trim() || "See your notification in Odesseus.",
    ctaLabel: notification.action_url ? "View details" : undefined,
    ctaHref: notification.action_url ?? undefined,
  };
}

export type NotificationEmailAction =
  | { kind: "enqueue"; notification: NotificationRow; to: string }
  | { kind: "skip"; notification: NotificationRow; reason: "unwanted" | "no_address" };

/**
 * Decides, for a batch of pending rows, which become emails.
 *
 * Rules (pure, unit-tested):
 *   - A type that cannot email (mailing list absent / catalog says no) skips.
 *   - The recipient's email switch off skips — in-app rows are unaffected.
 *   - No deliverable address skips (dead auth record).
 *   - Anything else enqueues.
 *
 * @param emailEnabledByUser  user_id -> candidate email-flag (default true).
 * @param emailEnabledByOrg   org_id -> employer email-flag (default true).
 * @param emailByUser         user_id -> resolved address or null.
 */
export function planNotificationEmailActions(
  notifications: NotificationRow[],
  emailEnabledByUser: Record<string, boolean>,
  emailEnabledByOrg: Record<string, boolean>,
  emailByUser: Record<string, string | null>
): NotificationEmailAction[] {
  return notifications.map((notification) => {
    if (!isEmailCapable(notification.notification_type as NotificationType)) {
      return {
        kind: "skip",
        notification,
        reason: "unwanted",
      };
    }

    const emailWanted =
      notification.recipient_type === "employer_member"
        ? emailEnabledByOrg[notification.organization_id ?? ""] !== false
        : emailEnabledByUser[notification.recipient_user_id] !== false;

    if (!emailWanted) {
      return { kind: "skip", notification, reason: "unwanted" };
    }

    const to = emailByUser[notification.recipient_user_id] ?? null;
    if (!to) {
      return { kind: "skip", notification, reason: "no_address" };
    }

    return { kind: "enqueue", notification, to };
  });
}

/**
 * The cron worker. Returns a summary for the route to report. Never throws on
 * a single row's failure — the row simply stays 'none' and the next tick
 * retries it; whole-batch failures (unreadable table, etc.) do throw so the
 * cron surfaces a 500.
 */
export async function deliverPendingNotificationEmails(options: {
  batch?: number;
} = {}): Promise<{ evaluated: number; enqueued: number; skipped: number }> {
  const batch = Math.min(Math.max(options.batch ?? 50, 1), 200);
  const client = createServiceClient();

  const { data: due, error: readError } = await client
    .from("notifications")
    .select("*")
    .eq("email_delivery_status", "none")
    .order("created_at", { ascending: true })
    .limit(batch);

  if (readError) {
    throw new Error(`Could not read pending notification emails: ${readError.message}`);
  }

  const rows = (due ?? []) as NotificationRow[];
  if (rows.length === 0) {
    return { evaluated: 0, enqueued: 0, skipped: 0 };
  }

  const userIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const row of rows) {
    userIds.add(row.recipient_user_id);
    if (row.recipient_type === "employer_member" && row.organization_id) {
      orgIds.add(row.organization_id);
    }
  }

  const userIdList = [...userIds];
  const emailEnabledByUser: Record<string, boolean> = {};
  const { data: candidatePrefs } = await client
    .from("notification_preferences")
    .select("user_id,email")
    .in("user_id", userIdList);
  for (const pref of candidatePrefs ?? []) {
    emailEnabledByUser[pref.user_id] = pref.email;
  }

  const emailEnabledByOrg: Record<string, boolean> = {};
  if (orgIds.size > 0) {
    const { data: employerPrefs } = await client
      .from("employer_notification_preferences")
      .select("org_id,email")
      .in("org_id", [...orgIds]);
    for (const pref of employerPrefs ?? []) {
      emailEnabledByOrg[pref.org_id] = pref.email;
    }
  }

  const emailByUser = await resolveRecipientEmails(client, userIdList);
  const actions = planNotificationEmailActions(
    rows,
    emailEnabledByUser,
    emailEnabledByOrg,
    emailByUser
  );

  const enqueueIds: string[] = [];
  const skipIds: string[] = [];

  for (const action of actions) {
    const notification = action.notification;
    if (action.kind === "skip") {
      skipIds.push(notification.id);
      continue;
    }

    // Enqueue first; only a successful enqueue advances the row to 'queued'.
    try {
      const draft = buildNotificationEmail(notification);
      await enqueueRetryJob(
        "email_delivery",
        emailDeliveryIdempotencyKey(
          `notification:${notification.notification_type}`,
          action.to,
          notification.id
        ),
        {
          ...draft,
          to: action.to,
          logPrefix: NOTIFICATION_EMAIL_LOG_PREFIX,
          notificationId: notification.id,
        },
        // Notification emails are not time-critical; a wider retry window
        // keeps transient provider failures from exhausting attempts.
        { maxAttempts: 4, initialDelaySeconds: 120 }
      );
      enqueueIds.push(notification.id);
    } catch (error) {
      console.error(
        `${NOTIFICATION_EMAIL_LOG_PREFIX} enqueue failed for ${notification.id}; it stays 'none' for the next tick`,
        error
      );
    }
  }

  await flushStatus(client, enqueueIds, "queued");
  await flushStatus(client, skipIds, "skipped");

  return {
    evaluated: rows.length,
    enqueued: enqueueIds.length,
    skipped: skipIds.length,
  };
}

async function flushStatus(
  client: ReturnType<typeof createServiceClient>,
  ids: string[],
  status: "queued" | "skipped"
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await client
    .from("notifications")
    .update({ email_delivery_status: status })
    .in("id", ids)
    .eq("email_delivery_status", "none");
  if (error) {
    console.error(
      `${NOTIFICATION_EMAIL_LOG_PREFIX} could not mark ${ids.length} rows ${status}`,
      error
    );
  }
}

/**
 * Resolves recipient email addresses from the auth records. One admin lookup
 * per unique user per tick (bounded by batch), cached in-process. A missing or
 * unresolvable address yields null and the planner skips that row.
 */
async function resolveRecipientEmails(
  client: ReturnType<typeof createServiceClient>,
  userIds: string[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const userId of userIds) {
    try {
      const { data } = await client.auth.admin.getUserById(userId);
      out[userId] = typeof data?.user?.email === "string" ? data.user.email : null;
    } catch (error) {
      console.error(`${NOTIFICATION_EMAIL_LOG_PREFIX} cannot resolve email for ${userId}`, error);
      out[userId] = null;
    }
  }
  return out;
}