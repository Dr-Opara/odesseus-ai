/**
 * Notification preference read/write service (M8 backend slice, extended by 2K).
 *
 * Candidate preferences are candidate-owned and private: every read and write
 * is scoped to the caller's own row by the `notification_preferences_*_own`
 * RLS policies, and the user id is always resolved from the auth session by
 * the caller — never from request input. A user with no row yet is served the
 * documented product defaults rather than an empty object, so a first-run
 * client renders the same state the database would have produced.
 *
 * Employer preferences are organization-owned: any member may read them;
 * only org owners/admins may change them (enforced by RLS plus the route
 * layer, mirroring the employer_jobs split).
 *
 * Channel semantics (Phase 2K): a channel boolean decides whether
 * notifications of that channel are RECORDED at all (in-app). `email` is the
 * outbound-email switch: off keeps in-app rows, it only stops the email.
 * Critical notification types (CAPTCHA / MFA / sensitive / manual action /
 * wallet low balance) are never suppressible and bypass the channel check in
 * the recorder; `email` still applies to them, because opting out of email
 * must never lose an application-blocking alert a user could read in-app.
 *
 * This module only stores intent. The delivery pipeline lives in
 * src/lib/notifications/email.ts (outbound) and src/lib/notifications/records.ts
 * (the in-app surface).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type NotificationClient = SupabaseClient<Database>;

/** The candidate channels the product actually offers (mirrors the settings screen). */
export const NOTIFICATION_CHANNELS = [
  "applications",
  "documents",
  "matches",
  "activity",
  "product",
  "interview_reminders",
  "wallet_billing",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPreferences = Record<NotificationChannel, boolean> & {
  /** Master outbound-email switch. Off keeps in-app rows; only email is skipped. */
  email: boolean;
};

/**
 * Product defaults: candidate-relevant channels on, marketing off, email on.
 * These match the column defaults in the notification_preferences migrations so
 * an un-provisioned user and a freshly inserted row are indistinguishable.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  applications: true,
  documents: true,
  matches: true,
  activity: true,
  product: false,
  interview_reminders: true,
  wallet_billing: true,
  email: true,
};

/** The employer notification channels (org-scoped preference row). */
export const EMPLOYER_NOTIFICATION_CHANNELS = [
  "new_applicants",
  "strong_fit",
  "pipeline",
  "interview_events",
  "capacity",
  "billing",
  "featured",
] as const;

export type EmployerNotificationChannel =
  (typeof EMPLOYER_NOTIFICATION_CHANNELS)[number];

export type EmployerNotificationPreferences = Record<
  EmployerNotificationChannel,
  boolean
> & {
  /** Master outbound-email switch for the org's members. */
  email: boolean;
};

/** Employer defaults: everything transactional on (no marketing channels exist). */
export const DEFAULT_EMPLOYER_NOTIFICATION_PREFERENCES: EmployerNotificationPreferences = {
  new_applicants: true,
  strong_fit: true,
  pipeline: true,
  interview_events: true,
  capacity: true,
  billing: true,
  featured: true,
  email: true,
};

const CANDIDATE_SELECT = `${NOTIFICATION_CHANNELS.join(",")},email`;
const EMPLOYER_SELECT = `${EMPLOYER_NOTIFICATION_CHANNELS.join(",")},email`;

/** Projects a row (or nothing) onto the channel map, filling in any default. */
function toPreferences(
  row: Partial<NotificationPreferences> | null | undefined
): NotificationPreferences {
  const next = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const channel of NOTIFICATION_CHANNELS) {
    const value = row?.[channel];
    if (typeof value === "boolean") next[channel] = value;
  }
  if (typeof row?.email === "boolean") next.email = row.email;
  return next;
}

/** Projects an employer preferences row (or nothing) onto the full map. */
function toEmployerPreferences(
  row: Partial<EmployerNotificationPreferences> | null | undefined
): EmployerNotificationPreferences {
  const next = { ...DEFAULT_EMPLOYER_NOTIFICATION_PREFERENCES };
  for (const channel of EMPLOYER_NOTIFICATION_CHANNELS) {
    const value = row?.[channel];
    if (typeof value === "boolean") next[channel] = value;
  }
  if (typeof row?.email === "boolean") next.email = row.email;
  return next;
}

/** The caller's preferences, or the product defaults when no row exists yet. */
export async function getNotificationPreferences(
  client: NotificationClient,
  userId: string
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from("notification_preferences")
    .select(CANDIDATE_SELECT)
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
  if (typeof patch.email === "boolean") changes.email = patch.email;

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
    .select(CANDIDATE_SELECT)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not save notification preferences: ${error.message}`);
  }

  return toPreferences(data as Partial<NotificationPreferences> | null);
}

/** The org's preferences, or the all-on defaults when no row exists yet. */
export async function getEmployerNotificationPreferences(
  client: NotificationClient,
  orgId: string
): Promise<EmployerNotificationPreferences> {
  const { data, error } = await client
    .from("employer_notification_preferences")
    .select(EMPLOYER_SELECT)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load employer notification preferences: ${error.message}`
    );
  }

  return toEmployerPreferences(data as Partial<EmployerNotificationPreferences> | null);
}

/**
 * Applies a partial update to the org's preferences. The route layer enforces
 * owner/admin membership before calling; the row is upserted so an org with no
 * row yet gets the defaults plus its change, idempotent on the org_id PK.
 */
export async function updateEmployerNotificationPreferences(
  client: NotificationClient,
  orgId: string,
  patch: Partial<EmployerNotificationPreferences>
): Promise<EmployerNotificationPreferences> {
  const changes: Partial<EmployerNotificationPreferences> = {};
  for (const channel of EMPLOYER_NOTIFICATION_CHANNELS) {
    const value = patch[channel];
    if (typeof value === "boolean") changes[channel] = value;
  }
  if (typeof patch.email === "boolean") changes.email = patch.email;

  if (Object.keys(changes).length === 0) {
    return getEmployerNotificationPreferences(client, orgId);
  }

  const { data, error } = await client
    .from("employer_notification_preferences")
    .upsert(
      { org_id: orgId, ...changes, updated_at: new Date().toISOString() },
      { onConflict: "org_id" }
    )
    .select(EMPLOYER_SELECT)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not save employer notification preferences: ${error.message}`
    );
  }

  return toEmployerPreferences(data as Partial<EmployerNotificationPreferences> | null);
}