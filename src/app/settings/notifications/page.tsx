import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileNotifications from "@/components/mobile/mobile-notifications";

export default async function NotificationsSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");

  return <MobileNotifications />;
}
