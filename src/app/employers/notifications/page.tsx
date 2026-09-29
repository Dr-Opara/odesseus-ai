import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import NotificationsPanel from "@/components/employers/notifications-panel";
import { getEmployerNotifications, getNotificationPreferences } from "@/lib/employers/notifications-adapter";

/**
 * Employer Notifications (Figma screen 86, F13-R). Figma's mock only shows
 * the preference-toggle rows; the notification list/unread-state/mark-read
 * functionality F13-R explicitly requires isn't in that particular mock, so
 * it's added above the toggles using the same visual row language rather
 * than skipped. Supports the Phase 2K categories: new applicant, strong-fit
 * candidate, pipeline update, interview event, capacity warning, seat
 * warning, billing/subscription, featured-job expiration.
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

  const [notificationsResult, preferencesResult] = await Promise.all([getEmployerNotifications(), getNotificationPreferences()]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Employer Notifications</h1>
          <p className="muted">Choose hiring alerts.</p>

          {notificationsResult.status === "ok" && preferencesResult.status === "ok" ? (
            <NotificationsPanel initialNotifications={notificationsResult.data} initialPreferences={preferencesResult.data} />
          ) : (
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="Notifications aren't available yet"
                message={notificationsResult.status === "unavailable" ? notificationsResult.reason : "Notification preferences aren't available yet."}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
