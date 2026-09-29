/**
 * Employer notifications adapter — real backend records.
 *
 * Replaces a development fixture. The notification backend is authoritative
 * (`src/lib/notifications/*`, exposed through
 * `/api/employer/orgs/[orgId]/notifications*` and `.../notification-preferences`).
 *
 * Two things the real backend settled, which the fixture never had to face:
 *
 *  - **Preferences are org-scoped channels, not per-user notification types.**
 *    The stored row is `employer_notification_preferences` keyed on `org_id`,
 *    with one boolean per channel (`new_applicants`, `strong_fit`, `pipeline`,
 *    `interview_events`, `capacity`, `billing`, `featured`) plus an `email`
 *    switch. The Figma toggle set is mapped onto those channels here; writing
 *    an unrecognised key would be rejected by the route's schema.
 *  - **Preference writes are owner/admin only.** The PUT route enforces it, so
 *    a recruiter toggling a switch is a real refusal and the panel rolls back.
 *
 * A missing preference row is the backend's "all on" default, resolved by
 * `getEmployerNotificationPreferences` itself. Nothing here substitutes its
 * own default.
 */

import { createClient } from "@/lib/supabase/server";
import { listNotifications } from "@/lib/notifications/records";
import {
  getEmployerNotificationPreferences,
  type EmployerNotificationPreferences as BackendPreferences,
} from "@/lib/notifications/service";
import { resolveEmployerContext } from "./context";
import { toChannels, toPreferences } from "./preferences";
import type {
  EmployerNotification,
  EmployerNotificationCategory,
  EmployerNotificationPreferences,
} from "./types";
import type { EmployerResult } from "./result";

/**
 * Backend notification type -> Figma category.
 *
 * The type names below are the real ones the catalog declares. Anything not
 * listed is dropped from the list rather than filed under a category that
 * would misdescribe it.
 */
const CATEGORY_BY_TYPE: Record<string, EmployerNotificationCategory> = {
  EMPLOYER_NEW_APPLICANT: "new_applicant",
  EMPLOYER_STRONG_FIT: "strong_fit",
  EMPLOYER_PIPELINE_UPDATED: "pipeline_update",
  EMPLOYER_INTERVIEW_EVENT: "interview_event",
  EMPLOYER_JOB_CAPACITY_WARNING: "capacity_warning",
  EMPLOYER_JOB_CAPACITY_REACHED: "capacity_warning",
  EMPLOYER_RECRUITER_SEAT_WARNING: "seat_warning",
  EMPLOYER_PAYMENT_FAILED: "billing",
  EMPLOYER_SUBSCRIPTION_EVENT: "billing",
  EMPLOYER_FEATURED_JOB_EXPIRING: "featured_expiring",
  EMPLOYER_FEATURED_JOB_EXPIRED: "featured_expiring",
};

/**
 * Figma toggle -> backend channel, and back.
 *
 * The mapping lives in `./preferences` because the client panel needs the same
 * table to write it. Keeping two copies would let a toggle mean one channel on
 * the read path and a different one on the write path, which is the kind of
 * drift that only shows up as "I turned it off and it kept firing".
 */
export {
  EMPLOYER_PREFERENCE_ROWS as PREFERENCE_ROWS,
  CHANNEL_BY_TOGGLE,
  toPreferences,
  toChannels,
} from "./preferences";

/** A stored record, in the shape `listNotifications` returns. */
type StoredNotification = {
  id: string;
  notification_type: string;
  title: string;
  body?: string | null;
  created_at: string;
  read_at?: string | null;
};

function toNotification(row: StoredNotification): EmployerNotification | null {
  const category = CATEGORY_BY_TYPE[row.notification_type];
  if (!category) return null;
  return {
    id: row.id,
    category,
    title: row.title,
    detail: row.body ?? undefined,
    createdAt: row.created_at,
    read: Boolean(row.read_at),
  };
}

/** The organization's notification feed for the signed-in member. */
export async function getEmployerNotifications(): Promise<EmployerResult<EmployerNotification[]>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const { items } = await listNotifications(supabase, resolved.context.userId, {
      limit: 50,
      organizationId: resolved.context.orgId,
    });

    const data = (items as unknown as StoredNotification[])
      .map(toNotification)
      .filter((item): item is EmployerNotification => item !== null);

    return { status: "ok", data, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_NOTIFICATIONS] read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your notifications." };
  }
}

/** The unread count, for the nav badge. */
export async function getUnreadNotificationCount(): Promise<EmployerResult<number>> {
  const notifications = await getEmployerNotifications();
  if (notifications.status === "unavailable") return notifications;
  return {
    status: "ok",
    data: notifications.data.filter((item) => !item.read).length,
    source: "live",
  };
}

/**
 * This organization's notification channel preferences.
 *
 * Read through the backend service, so the all-on default for an org with no
 * row is the backend's own and not a second copy of it here.
 */
export async function getNotificationPreferences(): Promise<
  EmployerResult<EmployerNotificationPreferences>
> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const supabase = await createClient();
    const stored = await getEmployerNotificationPreferences(supabase, resolved.context.orgId);
    return {
      status: "ok",
      data: toPreferences(stored as unknown as Record<string, boolean>),
      source: "live",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_NOTIFICATIONS] preferences read failed", message);
    return { status: "unavailable", reason: "Odesseus could not load your notification settings." };
  }
}

/**
 * Saves this organization's notification channel preferences.
 *
 * Goes over HTTP so the route's owner/admin check stays authoritative. The
 * returned preferences are the ones the backend persisted, so the panel only
 * shows a toggle as changed once it was actually stored.
 */
export async function updateNotificationPreferences(
  preferences: EmployerNotificationPreferences
): Promise<EmployerResult<EmployerNotificationPreferences>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(
      `/api/employer/orgs/${resolved.context.orgId}/notification-preferences`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toChannels(preferences)),
      }
    );
    const payload = (await response.json().catch(() => ({}))) as {
      preferences?: BackendPreferences;
      error?: string;
    };

    if (!response.ok) {
      return {
        status: "unavailable",
        reason: payload.error ?? "Odesseus could not save your notification settings.",
      };
    }

    // Report what was actually stored, not what was requested.
    return {
      status: "ok",
      data: toPreferences(
        (payload.preferences ?? {}) as unknown as Record<string, boolean>
      ),
      source: "live",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_NOTIFICATIONS] preferences save failed", message);
    return { status: "unavailable", reason: "Odesseus could not save your notification settings." };
  }
}

/** Marks one notification read. */
export async function markNotificationRead(notificationId: string): Promise<EmployerResult<null>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(`/api/employer/orgs/${resolved.context.orgId}/notifications/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [notificationId] }),
    });
    if (!response.ok) {
      return { status: "unavailable", reason: "Odesseus could not update that notification." };
    }
    return { status: "ok", data: null, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_NOTIFICATIONS] mark read failed", message);
    return { status: "unavailable", reason: "Odesseus could not update that notification." };
  }
}

/** Marks every unread notification read. */
export async function markAllNotificationsRead(): Promise<EmployerResult<null>> {
  const resolved = await resolveEmployerContext();
  if (resolved.status === "unavailable") return resolved;

  try {
    const response = await fetch(
      `/api/employer/orgs/${resolved.context.orgId}/notifications/read-all`,
      { method: "POST" }
    );
    if (!response.ok) {
      return { status: "unavailable", reason: "Odesseus could not update your notifications." };
    }
    return { status: "ok", data: null, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_EMPLOYER_NOTIFICATIONS] mark all read failed", message);
    return { status: "unavailable", reason: "Odesseus could not update your notifications." };
  }
}
