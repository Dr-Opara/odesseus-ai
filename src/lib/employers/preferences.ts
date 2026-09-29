/**
 * The mapping between the Figma notification toggles and the backend's
 * organization notification channels.
 *
 * The backend stores preferences per organization as one boolean per channel
 * (`employer_notification_preferences`: `new_applicants`, `strong_fit`,
 * `pipeline`, `interview_events`, `capacity`, `billing`, `featured`). The Figma
 * screen offers a different, coarser set of toggles.
 *
 * This module is client-safe on purpose: no Supabase import, no server
 * dependency. Both the server-side adapter (which reads the stored row) and the
 * client panel (which writes it) map through the same table, so a toggle cannot
 * mean one channel on the read path and a different one on the write path.
 *
 * Only toggles with a real backing channel are listed. The Figma set has no
 * switch for pipeline updates or featured expiry, so none is offered — a
 * switch that could not suppress anything would misrepresent what the employer
 * actually controls.
 */

import type { EmployerNotificationPreferences } from "./types";

/** A toggle row as the preferences screen renders it. */
export type PreferenceRow = {
  key: keyof EmployerNotificationPreferences;
  label: string;
  /** The backend channel this toggle governs. */
  channel: string;
};

/** The toggle rows, in display order. */
export const EMPLOYER_PREFERENCE_ROWS: PreferenceRow[] = [
  { key: "newApplicant", label: "New applicant", channel: "new_applicants" },
  { key: "strongFitCandidate", label: "Strong-fit candidate", channel: "strong_fit" },
  { key: "interviewUpdate", label: "Interview update", channel: "interview_events" },
  { key: "capacityWarning", label: "Plan capacity warning", channel: "capacity" },
  { key: "billingNotice", label: "Billing notice", channel: "billing" },
];

/** Figma toggle -> backend channel. */
export const CHANNEL_BY_TOGGLE: Record<keyof EmployerNotificationPreferences, string> =
  Object.fromEntries(
    EMPLOYER_PREFERENCE_ROWS.map((row) => [row.key, row.channel])
  ) as Record<keyof EmployerNotificationPreferences, string>;

/** The channels a full write covers. */
export const MANAGED_CHANNELS: string[] = EMPLOYER_PREFERENCE_ROWS.map((row) => row.channel);

/** Projects the backend's stored channel booleans onto the Figma toggles. */
export function toPreferences(
  stored: Record<string, boolean | undefined> | null | undefined
): EmployerNotificationPreferences {
  const preferences = {} as EmployerNotificationPreferences;
  for (const row of EMPLOYER_PREFERENCE_ROWS) {
    preferences[row.key] = Boolean(stored?.[row.channel]);
  }
  return preferences;
}

/** Flattens the Figma toggles into the backend's channel set for a write. */
export function toChannels(
  preferences: EmployerNotificationPreferences
): Record<string, boolean> {
  const channels: Record<string, boolean> = {};
  for (const row of EMPLOYER_PREFERENCE_ROWS) {
    channels[row.channel] = Boolean(preferences[row.key]);
  }
  return channels;
}
