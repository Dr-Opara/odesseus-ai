import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileSecurity from "@/components/mobile/mobile-security";

export default async function SecuritySettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");

  const { data: userData } = await supabase.auth.getUser();
  const googleConnected =
    userData.user?.identities?.some((identity) => identity.provider === "google") ?? false;

  return <MobileSecurity googleConnected={googleConnected} />;
}
