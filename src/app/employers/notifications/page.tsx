import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import NotificationsPanel from "@/components/employers/notifications-panel";
import {
  getEmployerNotifications,
  getNotificationPreferences,
} from "@/lib/employers/notifications-adapter";

/**
 * Employer Notifications (Figma screen 86, F13-R). Figma's mock only shows the
 * preference-toggle rows, so the notification list, unread state, and
 * mark-read actions F13-R requires are added above the toggles using the same
 * visual row language.
 */
export default async function EmployerNotificationsPage() {
  const { orgId } = await requireEmployerPage("/employers/notifications");

  const [notificationsResult, preferencesResult] = await Promise.all([
    getEmployerNotifications(orgId),
    getNotificationPreferences(orgId),
  ]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Employer Notifications</h1>
          <p className="muted">Choose hiring alerts.</p>

          {notificationsResult.status === "ok" && preferencesResult.status === "ok" ? (
            <NotificationsPanel
              orgId={orgId}
              initialNotifications={notificationsResult.data}
              initialPreferences={preferencesResult.data}
            />
          ) : (
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="We couldn't load your notifications"
                message={
                  notificationsResult.status === "unavailable"
                    ? notificationsResult.reason
                    : "Odesseus could not load your notification preferences."
                }
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
