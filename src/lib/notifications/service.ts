/**
 * Notification preference read/write service (M8).
 *
 * Preferences are candidate-owned and private: every read and write is scoped
 * to the caller's own row by the `notification_preferences_*_own` RLS
 * policies, and the user id is always resolved from the auth session by the
 * caller — never from request input. A user with no row yet is served the
 * documented product defaults rather than an empty object, so a first-run
 * client renders the same state the database would have produced.
 *
 * This module only stores intent. The delivery pipeline that consumes these
 * flags belongs to the integration milestones and is deliberately not here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type NotificationClient = SupabaseClient<Database>;

/** The channels the product actually offers (mirrors the settings screen). */
export const NOTIFICATION_CHANNELS = [
  "applications",
  "documents",
  "matches",
  "activity",
  "product",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPreferences = Record<NotificationChannel, boolean>;

/**
 * Product defaults: candidate-relevant channels on, marketing off. These match
 * the column defaults in the notification_preferences migration so an
 * un-provisioned user and a freshly inserted row are indistinguishable.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  applications: true,
  documents: true,
  matches: true,
  activity: true,
  product: false,
};

/** Projects a row (or nothing) onto the channel map, filling in any default. */
function toPreferences(
  row: Partial<Record<NotificationChannel, boolean>> | null | undefined
): NotificationPreferences {
  const next = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const channel of NOTIFICATION_CHANNELS) {
    const value = row?.[channel];
    if (typeof value === "boolean") next[channel] = value;
  }
  return next;
}

/** The caller's preferences, or the product defaults when no row exists yet. */
export async function getNotificationPreferences(
  client: NotificationClient,
  userId: string
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from("notification_preferences")
    .select(NOTIFICATION_CHANNELS.join(","))
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load notification preferences: ${error.message}`);
  }

  return toPreferences(data as Partial<NotificationPreferences> | null);
}

/**
 * Applies a partial update to the caller's preferences and returns the stored
 * result. Only channels present in `patch` are touched, so a single-toggle
 * client never has to send the whole set (and never clobbers a concurrent
 * change to another channel with a stale default).
 *
 * The row is upserted rather than updated: a user who has never had a row gets
 * one created with the product defaults plus their change. The `onConflict`
 * key is the user_id primary key, so this is idempotent for repeated writes of
 * the same value.
 */
export async function updateNotificationPreferences(
  client: NotificationClient,
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const changes: Partial<NotificationPreferences> = {};
  for (const channel of NOTIFICATION_CHANNELS) {
    const value = patch[channel];
    if (typeof value === "boolean") changes[channel] = value;
  }

  if (Object.keys(changes).length === 0) {
    // Nothing valid to write: return current state rather than touching the row.
    return getNotificationPreferences(client, userId);
  }

  const { data, error } = await client
    .from("notification_preferences")
    .upsert(
      { user_id: userId, ...changes, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
    .select(NOTIFICATION_CHANNELS.join(","))
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not save notification preferences: ${error.message}`);
  }

  return toPreferences(data as Partial<NotificationPreferences> | null);
}
