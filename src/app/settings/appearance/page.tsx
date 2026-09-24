import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileAppearance from "@/components/mobile/mobile-appearance";

export default async function AppearanceSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");

  return <MobileAppearance />;
}
