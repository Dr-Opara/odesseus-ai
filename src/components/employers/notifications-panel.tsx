"use client";

import { useState } from "react";
import { markNotificationRead, markAllNotificationsRead, updateNotificationPreferences } from "@/lib/employers/notifications-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerNotification, EmployerNotificationPreferences } from "@/lib/employers/types";

const PREFERENCE_ROWS: { key: keyof EmployerNotificationPreferences; label: string }[] = [
  { key: "newApplicant", label: "New applicant" },
  { key: "strongFitCandidate", label: "Strong-fit candidate" },
  { key: "interviewUpdate", label: "Interview update" },
  { key: "capacityWarning", label: "Plan capacity warning" },
  { key: "billingNotice", label: "Billing notice" },
];

export default function NotificationsPanel({
  initialNotifications,
  initialPreferences,
}: {
  initialNotifications: EmployerNotification[];
  initialPreferences: EmployerNotificationPreferences;
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [failure, setFailure] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleMarkOneRead(id: string) {
    const previous = notifications;
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const result = await markNotificationRead(id);
    if (result.status === "unavailable") {
      setNotifications(previous);
      setFailure(result.reason);
    }
  }

  async function handleMarkAllRead() {
    const previous = notifications;
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    const result = await markAllNotificationsRead();
    if (result.status === "unavailable") {
      setNotifications(previous);
      setFailure(result.reason);
    }
  }

  async function handleTogglePreference(key: keyof EmployerNotificationPreferences) {
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    const result = await updateNotificationPreferences(next);
    if (result.status === "unavailable") {
      setPreferences(previous);
      setFailure(result.reason);
    }
  }

  return (
    <>
      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </strong>
        {unreadCount > 0 ? (
          <button type="button" className="emp-btn-secondary" onClick={handleMarkAllRead}>
            Mark all as read
          </button>
        ) : null}
      </div>

      <div className="emp-row-list" style={{ marginTop: 14 }}>
        {notifications.length === 0 ? (
          <EmployerStatePanel kind="empty" title="No Notifications Yet" message="Hiring alerts will show up here." />
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
        {PREFERENCE_ROWS.map((row) => (
          <label key={row.key} className="emp-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <span className="emp-row-value">{row.label}</span>
            <input type="checkbox" checked={preferences[row.key]} onChange={() => handleTogglePreference(row.key)} style={{ width: 20, height: 20, accentColor: "var(--od-orange)" }} />
          </label>
        ))}
      </div>

      {failure ? (
        <div style={{ marginTop: 20 }}>
          <EmployerStatePanel kind="error" title="Couldn't save that change" message={failure} />
        </div>
      ) : null}
    </>
  );
}
