"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
  saveNotificationPreferencesAction,
} from "@/lib/employers/actions";
import { EMPLOYER_PREFERENCE_ROWS } from "@/lib/employers/preferences";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerNotification, EmployerNotificationPreferences } from "@/lib/employers/types";

/**
 * The notification list and preference toggles (F13-R).
 *
 * Read state and preferences are applied optimistically and rolled back if the
 * backend refuses. That is safe because a refusal here is a real failure and
 * never a silent no-op — the routes either persist the change or answer with
 * an error, and nothing is reported as saved until they do.
 *
 * The preference rows come from `@/lib/employers/preferences`, which is the
 * single mapping between the Figma toggles and the backend's org channels.
 * Both are client-safe, so the mapping can be shared without pulling a server
 * client into this bundle.
 */
export default function NotificationsPanel({
  orgId,
  initialNotifications,
  initialPreferences,
}: {
  orgId: string;
  initialNotifications: EmployerNotification[];
  initialPreferences: EmployerNotificationPreferences;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [failure, setFailure] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleMarkOneRead(id: string) {
    const previous = notifications;
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setFailure(null);
    const result = await markNotificationReadAction(orgId, id);
    if (result.status === "unavailable") {
      setNotifications(previous);
      setFailure(result.reason);
      return;
    }
    router.refresh();
  }

  async function handleMarkAllRead() {
    const previous = notifications;
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    setFailure(null);
    const result = await markAllNotificationsReadAction(orgId);
    if (result.status === "unavailable") {
      setNotifications(previous);
      setFailure(result.reason);
      return;
    }
    router.refresh();
  }

  async function handleTogglePreference(key: keyof EmployerNotificationPreferences) {
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setFailure(null);

    const result = await saveNotificationPreferencesAction(orgId, toChannels(next));
    if (result.status === "unavailable") {
      setPreferences(previous);
      setFailure(result.reason);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}</strong>
        {unreadCount > 0 ? (
          <button type="button" className="emp-btn-secondary" onClick={handleMarkAllRead}>
            Mark all as read
          </button>
        ) : null}
      </div>

      <div className="emp-row-list" style={{ marginTop: 14 }}>
        {notifications.length === 0 ? (
          <EmployerStatePanel
            kind="empty"
            title="No Notifications Yet"
            message="Hiring alerts will show up here."
          />
        ) : (
          notifications.map((n) => (
            <button
              type="button"
              key={n.id}
              className="emp-row"
              style={{ textAlign: "left", width: "100%", border: "none", cursor: n.read ? "default" : "pointer", opacity: n.read ? 0.6 : 1 }}
              onClick={() => !n.read && handleMarkOneRead(n.id)}
            >
              <span className="emp-row-label">{n.read ? "Read" : "Unread"}</span>
              <span className="emp-row-value">{n.title}</span>
            </button>
          ))
        )}
      </div>

      <h2 style={{ marginTop: 40 }}>Notification Preferences</h2>
      <div className="emp-row-list" style={{ marginTop: 14 }}>
        {EMPLOYER_PREFERENCE_ROWS.map((row) => (
          <label key={row.key} className="emp-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <span className="emp-row-value">{row.label}</span>
            <input
              type="checkbox"
              checked={preferences[row.key]}
              onChange={() => handleTogglePreference(row.key)}
              style={{ width: 20, height: 20, accentColor: "var(--od-orange)" }}
            />
          </label>
        ))}
      </div>

      {failure ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="Couldn&rsquo;t save that change" message={failure} />
        </div>
      ) : null}
    </>
  );
}

/**
 * Flattens the Figma toggles into the backend's org channel set.
 *
 * The route upserts a partial patch, so the full channel map is sent rather
 * than one key: sending only the changed toggle would leave the rest at
 * whatever the stored row held, which is not the same as "keep what is on
 * screen".
 */
function toChannels(preferences: EmployerNotificationPreferences): Record<string, boolean> {
  return {
    new_applicants: preferences.newApplicant,
    strong_fit: preferences.strongFitCandidate,
    interview_events: preferences.interviewUpdate,
    capacity: preferences.capacityWarning,
    billing: preferences.billingNotice,
  };
}
