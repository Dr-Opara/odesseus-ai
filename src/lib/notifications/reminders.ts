/**
 * Interview reminder firing (Phase 2K).
 *
 * Reminder rows are materialized by odesseus_private.trg_notification_interview
 * at scheduling time with due_at = scheduled_at - window, then this cron fires
 * them when they come due: it creates the INTERVIEW_REMINDER notification
 * (deduped per interview-window so a replay never double-notifies) and marks
 * the reminder fired.
 *
 * The windows mirror odesseus_private.notification_interview_reminder_minutes()
 * (1440 / 60 minutes); the migration contract test pins both.
 *
 * The interview_reminders channel is respected here (TS-side, same semantics
 * as the SQL gate): a user who turned it off gets no notification row, and the
 * reminder is still marked fired so it is not retried every tick.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { createNotificationOnce } from "./records";

/** Mirrors odesseus_private.notification_interview_reminder_minutes(). */
export const INTERVIEW_REMINDER_MINUTES = [1440, 60] as const;

/** Reminder bucket label for a window in minutes, matching the SQL CASE. */
export function reminderTypeForMinutes(minutes: number): string {
  switch (minutes) {
    case 1440:
      return "1_day";
    case 60:
      return "1_hour";
    default:
      return `${minutes}_min`;
  }
}

type DueReminder = {
  id: string;
  user_id: string;
  interview_id: string;
  reminder_type: string;
  due_at: string;
  timezone: string | null;
};

export type ReminderRunSummary = {
  fired: number;
  notified: number;
  skippedChannelOff: number;
  skippedNotApplicable: number;
};

/** Fires due interview reminders (cron worker). Throws only on whole-batch failures. */
export async function fireDueInterviewReminders(options: {
  batch?: number;
} = {}): Promise<ReminderRunSummary> {
  const batch = Math.min(Math.max(options.batch ?? 50, 1), 200);
  const client = createServiceClient();

  const { data: due, error: readError } = await client
    .from("notification_reminders")
    .select("id,user_id,interview_id,reminder_type,due_at,timezone")
    .eq("status", "scheduled")
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(batch);

  if (readError) {
    throw new Error(`Could not read due interview reminders: ${readError.message}`);
  }

  const reminders = (due ?? []) as DueReminder[];
  const summary: ReminderRunSummary = {
    fired: 0,
    notified: 0,
    skippedChannelOff: 0,
    skippedNotApplicable: 0,
  };
  if (reminders.length === 0) return summary;

  const interviewIds = [...new Set(reminders.map((r) => r.interview_id))];
  const userIds = [...new Set(reminders.map((r) => r.user_id))];

  const { data: interviews } = await client
    .from("interviews")
    .select("id,user_id,application_id,scheduled_at,timezone,status")
    .in("id", interviewIds);
  const interviewsById = new Map((interviews ?? []).map((row) => [row.id, row]));

  const applicationIds = [
    ...new Set(
      (interviews ?? [])
        .map((interview) => interview.application_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const applicationsById = new Map<
    string,
    { role_title: string | null; company_name: string }
  >();
  if (applicationIds.length > 0) {
    const { data: apps } = await client
      .from("applications")
      .select("id,role_title,company_name")
      .in("id", applicationIds);
    for (const app of apps ?? []) {
      applicationsById.set(app.id, app);
    }
  }

  const { data: prefs } = await client
    .from("notification_preferences")
    .select("user_id,interview_reminders")
    .in("user_id", userIds);
  const channelEnabledByUser = new Map<string, boolean>();
  for (const pref of prefs ?? []) {
    channelEnabledByUser.set(pref.user_id, pref.interview_reminders);
  }

  for (const reminder of reminders) {
    const interview = interviewsById.get(reminder.interview_id);
    if (!interview) {
      // Interview gone: nothing to notify; clear the reminder so it is not retried.
      await markFired(client, reminder.id);
      summary.fired += 1;
      continue;
    }

    if (interview.status === "cancelled" || interview.status === "completed") {
      // The trigger normally reconciles these, but a stale reminder is still
      // cleared defensively: cancelled/completed interviews must never email.
      await markCancelled(client, reminder.id);
      summary.skippedNotApplicable += 1;
      continue;
    }

    if (channelEnabledByUser.get(reminder.user_id) === false) {
      await markFired(client, reminder.id);
      summary.skippedChannelOff += 1;
      continue;
    }

    const application =
      interview.application_id != null
        ? applicationsById.get(interview.application_id)
        : undefined;

    const createdNotification = await createNotificationOnce(client, {
      recipient_user_id: reminder.user_id,
      recipient_type: "candidate",
      notification_type: "INTERVIEW_REMINDER",
      title: "Interview reminder",
      message: buildReminderMessage(interview, application),
      entity_type: "interview",
      entity_id: reminder.interview_id,
      action_url: "/interviews",
      priority: "normal",
      dedupe_key: `interview:${reminder.interview_id}:reminder:${reminder.reminder_type}`,
      metadata: {
        reminder_type: reminder.reminder_type,
        due_at: reminder.due_at,
      },
    });

    await markFired(client, reminder.id, createdNotification?.id);
    summary.fired += 1;
    if (createdNotification) summary.notified += 1;
  }

  return summary;
}

function buildReminderMessage(
  interview: { scheduled_at: string | null; timezone: string | null },
  application:
    | { role_title: string | null; company_name: string }
    | undefined
): string {
  const role =
    application?.role_title?.trim() || application?.company_name?.trim() || "an interview";
  const subject = application?.company_name
    ? `${application.role_title || "your interview"} at ${application.company_name}`
    : role;

  if (!interview.scheduled_at) {
    return `Reminder: ${subject} is coming up.`;
  }

  const when = new Date(interview.scheduled_at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: interview.timezone ?? undefined,
  });
  const tz = interview.timezone ? ` (${interview.timezone})` : "";
  return `Reminder: ${subject} is scheduled for ${when}${tz}.`;
}

async function markFired(
  client: ReturnType<typeof createServiceClient>,
  id: string,
  firedNotificationId?: string
): Promise<void> {
  const { error } = await client
    .from("notification_reminders")
    .update({
      status: "fired",
      ...(firedNotificationId ? { fired_notification_id: firedNotificationId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) {
    console.error(`[ODESSEUS_REMINDERS] could not mark reminder ${id} fired`, error);
  }
}

async function markCancelled(
  client: ReturnType<typeof createServiceClient>,
  id: string
): Promise<void> {
  const { error } = await client
    .from("notification_reminders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) {
    console.error(`[ODESSEUS_REMINDERS] could not cancel reminder ${id}`, error);
  }
}