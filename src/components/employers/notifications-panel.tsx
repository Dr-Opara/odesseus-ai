"use client";

import { useState } from "react";
import Link from "next/link";
import {
  markAllNotificationsRead,
  markNotificationsRead,
  updateNotificationPreference,
} from "@/lib/employers/notifications-adapter";
import EmployerStatePanel from "@/components/employers/state-panel";
import type { EmployerNotification, EmployerNotificationPreferences } from "@/lib/employers/types";

const PREFERENCE_ROWS: { key: keyof EmployerNotificationPreferences; label: string }[] = [
  { key: "new_applicants", label: "New applicant" },
  { key: "strong_fit", label: "Strong-fit candidate" },
  { key: "interview_events", label: "Interview update" },
  { key: "capacity", label: "Plan capacity warning" },
  { key: "billing", label: "Billing notice" },
  { key: "email", label: "Email me these alerts" },
];

/**
 * Notification list, unread state, mark-read actions, and the org's channel
 * preferences (F13-R). Read state is persisted by the backend: rows are marked
 * optimistically and rolled back when the call fails, and a preference toggle
 * is only kept once the backend confirms it.
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
  const [notifications, setNotifications] = useState(initialNotifications);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [failure, setFailure] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleMarkOneRead(id: string) {
    const previous = notifications;
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const result = await markNotificationsRead(orgId, [id]);
    if (result.status === "unavailable") {
      setNotifications(previous);
      setFailure(result.reason);
    }
  }

  async function handleMarkAllRead() {
    const previous = notifications;
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    const result = await markAllNotificationsRead(orgId);
    if (result.status === "unavailable") {
      setNotifications(previous);
      setFailure(result.reason);
    }
  }

  async function handleTogglePreference(key: keyof EmployerNotificationPreferences) {
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    const result = await updateNotificationPreference(orgId, key, next[key]);
    if (result.status === "unavailable") {
      setPreferences(previous);
      setFailure(result.reason);
    }
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
              <span className="emp-row-value">
                {n.title}
                {n.detail ? <span className="muted"> · {n.detail}</span> : null}
              </span>
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

      <p className="muted" style={{ marginTop: 24, fontSize: 13 }}>
        Alerts are recorded for your hiring team only.{" "}
        <Link href="/employers/dashboard" className="link">
          Back to dashboard
        </Link>
      </p>
    </>
  );
}
