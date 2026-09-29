/**
 * INTEGRATION POINT — employer notifications backend ("Phase 2K" per the
 * assignment; not yet shipped for the employer surface — see F13-R). Reads
 * are dev-fixtured; mark-as-read actions always report `unavailable` until
 * a real backend exists to persist read state, so the Checkpoint 6
 * notifications screen has a real failure path rather than a client-only
 * illusion of persistence. Do not build a second/parallel notification
 * system — this is the only adapter employer notification UI should use.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { EMPLOYER_NOTIFICATION_FIXTURES } from "./fixtures/notifications";
import type { EmployerNotification, EmployerNotificationPreferences } from "./types";
import type { EmployerResult } from "./result";

const DEFAULT_PREFERENCES: EmployerNotificationPreferences = {
  newApplicant: true,
  strongFitCandidate: true,
  interviewUpdate: true,
  capacityWarning: true,
  billingNotice: true,
};

export async function getEmployerNotifications(): Promise<EmployerResult<EmployerNotification[]>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Employer notifications API is not yet available." };
  }
  return { status: "ok", data: EMPLOYER_NOTIFICATION_FIXTURES, source: "fixture" };
}

export async function getNotificationPreferences(): Promise<EmployerResult<EmployerNotificationPreferences>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Notification preferences API is not yet available." };
  }
  return { status: "ok", data: DEFAULT_PREFERENCES, source: "fixture" };
}

/** INTEGRATION POINT: replace with a real preferences-update call once the backend ships. */
export async function updateNotificationPreferences(
  _preferences: EmployerNotificationPreferences
): Promise<EmployerResult<EmployerNotificationPreferences>> {
  return { status: "unavailable", reason: "Saving notification preferences is not yet available." };
}

/** INTEGRATION POINT: replace with a real mark-as-read call once the backend ships. */
export async function markNotificationRead(_notificationId: string): Promise<EmployerResult<null>> {
  return { status: "unavailable", reason: "Marking notifications as read is not yet available." };
}

export async function markAllNotificationsRead(): Promise<EmployerResult<null>> {
  return { status: "unavailable", reason: "Marking notifications as read is not yet available." };
}
