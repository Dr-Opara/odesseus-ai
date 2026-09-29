/**
 * Employer notifications adapter (F1). Production uses the real backend:
 * GET `/api/employer/orgs/{orgId}/notifications`,
 * GET `…/notifications/unread-count`,
 * POST `…/notifications/read` (ids), POST `…/notifications/read-all`,
 * GET/PUT `…/notification-preferences`.
 *
 * Read state is backend-persisted. The screen marks a row optimistically and
 * rolls back when the call fails, so persistence is never implied by a
 * client-only state change. This is the only adapter employer notification UI
 * should use — there is no second, parallel notification system.
 */
import { isProductionRuntime } from "@/lib/config/runtime";
import { employerApi } from "./api-client";
import { EMPLOYER_NOTIFICATION_FIXTURES } from "./fixtures/notifications";
import type {
  EmployerNotification,
  EmployerNotificationCategory,
  EmployerNotificationPreferences,
} from "./types";
import type { EmployerResult } from "./result";

type BackendNotification = {
  id: string;
  notification_type: string;
  title: string;
  message?: string | null;
  action_url?: string | null;
  read_at?: string | null;
  created_at: string;
};

const CATEGORY_BY_TYPE: Record<string, EmployerNotificationCategory> = {
  EMPLOYER_NEW_APPLICANT: "new_applicant",
  EMPLOYER_STRONG_FIT: "strong_fit",
  EMPLOYER_PIPELINE_UPDATED: "pipeline_update",
  EMPLOYER_INTERVIEW_EVENT: "interview_event",
  EMPLOYER_JOB_CAPACITY_WARNING: "capacity_warning",
  EMPLOYER_JOB_CAPACITY_REACHED: "capacity_reached",
  EMPLOYER_RECRUITER_SEAT_WARNING: "seat_warning",
  EMPLOYER_SUBSCRIPTION_EVENT: "billing",
  EMPLOYER_PAYMENT_FAILED: "payment_failed",
  EMPLOYER_FEATURED_JOB_EXPIRING: "featured_expiring",
  EMPLOYER_FEATURED_JOB_EXPIRED: "featured_expired",
};

function toNotification(row: BackendNotification): EmployerNotification {
  return {
    id: row.id,
    category: CATEGORY_BY_TYPE[row.notification_type] ?? "other",
    title: row.title,
    ...(row.message ? { detail: row.message } : {}),
    ...(row.action_url ? { actionUrl: row.action_url } : {}),
    createdAt: row.created_at,
    read: Boolean(row.read_at),
  };
}

export async function getEmployerNotifications(
  orgId: string
): Promise<EmployerResult<EmployerNotification[]>> {
  const response = await employerApi<{ items?: BackendNotification[] }>(
    `/api/employer/orgs/${orgId}/notifications?limit=25`
  );
  if (response.ok) {
    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    return { status: "ok", data: items.map(toNotification), source: "live" };
  }
  if (isProductionRuntime()) return { status: "unavailable", reason: response.reason };
  return { status: "ok", data: EMPLOYER_NOTIFICATION_FIXTURES, source: "fixture" };
}

export async function getUnreadNotificationCount(orgId: string): Promise<EmployerResult<number>> {
  const response = await employerApi<{ count?: number }>(
    `/api/employer/orgs/${orgId}/notifications/unread-count`
  );
  if (response.ok && typeof response.data?.count === "number") {
    return { status: "ok", data: response.data.count, source: "live" };
  }
  const list = await getEmployerNotifications(orgId);
  if (list.status !== "ok") return list;
  return {
    status: "ok",
    data: list.data.filter((notification) => !notification.read).length,
    source: list.source,
  };
}

type BackendPreferences = Partial<EmployerNotificationPreferences>;

export async function getNotificationPreferences(
  orgId: string
): Promise<EmployerResult<EmployerNotificationPreferences>> {
  const response = await employerApi<{ preferences?: BackendPreferences }>(
    `/api/employer/orgs/${orgId}/notification-preferences`
  );
  if (response.ok && response.data?.preferences) {
    return { status: "ok", data: response.data.preferences as EmployerNotificationPreferences, source: "live" };
  }
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: response.ok ? "Preferences are not set yet." : response.reason };
  }
  return {
    status: "ok",
    source: "fixture",
    data: {
      new_applicants: true,
      strong_fit: true,
      interview_events: true,
      capacity: true,
      billing: true,
      pipeline: true,
      featured: true,
      email: true,
    },
  };
}

/** Persist one preference change. The backend applies it to the org row. */
export async function updateNotificationPreference<K extends keyof EmployerNotificationPreferences>(
  orgId: string,
  key: K,
  value: EmployerNotificationPreferences[K]
): Promise<EmployerResult<EmployerNotificationPreferences>> {
  const response = await employerApi<{ preferences?: BackendPreferences }>(
    `/api/employer/orgs/${orgId}/notification-preferences`,
    { method: "PUT", body: { [key]: value } }
  );
  if (response.ok) {
    return {
      status: "ok",
      source: "live",
      data: (response.data?.preferences ?? { [key]: value }) as EmployerNotificationPreferences,
    };
  }
  return { status: "unavailable", reason: response.reason };
}

/** Mark the given notifications read. */
export async function markNotificationsRead(
  orgId: string,
  ids: string[]
): Promise<EmployerResult<null>> {
  if (ids.length === 0) return { status: "ok", data: null, source: "live" };
  const response = await employerApi<{ ok?: boolean }>(
    `/api/employer/orgs/${orgId}/notifications/read`,
    { method: "POST", body: { ids } }
  );
  if (response.ok) return { status: "ok", data: null, source: "live" };
  return { status: "unavailable", reason: response.reason };
}

/** Mark every unread notification for this org read. */
export async function markAllNotificationsRead(orgId: string): Promise<EmployerResult<null>> {
  const response = await employerApi<{ ok?: boolean }>(
    `/api/employer/orgs/${orgId}/notifications/read-all`,
    { method: "POST", body: {} }
  );
  if (response.ok) return { status: "ok", data: null, source: "live" };
  return { status: "unavailable", reason: response.reason };
}
