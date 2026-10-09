import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import NotificationsPanel from "@/components/employers/notifications-panel";
import { getEmployerNotifications, getNotificationPreferences } from "@/lib/employers/notifications-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";

/**
 * Employer Notifications (Figma screen 86, F13-R).
 *
 * The list, unread state, and mark-as-read actions F13-R requires are rendered
 * above the preference toggles in the same visual row language, because Figma's
 * particular mock shows only the toggles. The categories are the backend's own:
 * new applicant, strong-fit candidate, pipeline update, interview event,
 * capacity warning, seat warning, billing/subscription, and featured expiry.
 *
 * Both reads are independent, so one failing does not blank the other: the
 * preference toggles still render if the notification feed is unavailable, and
 * vice versa.
 */
export default async function EmployerNotificationsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [notificationsResult, preferencesResult, orgId] = await Promise.all([
    getEmployerNotifications(),
    getNotificationPreferences(),
    getEmployerOrgId(),
  ]);

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">NOTIFICATIONS</span>
          <h1>Employer Notifications</h1>
          <p className="muted">Choose hiring alerts and review what has come in.</p>

          {notificationsResult.status === "ok" && preferencesResult.status === "ok" ? (
            <NotificationsPanel
              orgId={orgId ?? ""}
              initialNotifications={notificationsResult.data}
              initialPreferences={preferencesResult.data}
            />
          ) : (
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="Notifications aren't available yet"
                message={
                  notificationsResult.status === "unavailable"
                    ? notificationsResult.reason
                    : preferencesResult.status === "unavailable"
                      ? preferencesResult.reason
                      : "Odesseus could not load your notification settings."
                }
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
