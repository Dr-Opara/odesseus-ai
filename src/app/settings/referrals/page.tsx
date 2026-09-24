import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileReferFriend from "@/components/mobile/mobile-refer-friend";

function slugify(name: string | null | undefined, fallback: string) {
  const base = (name || "").trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return base || fallback;
}

export default async function ReferralsSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  const referralSlug = slugify(profile?.full_name, userId.slice(0, 8));

  return <MobileReferFriend referralSlug={referralSlug} />;
}
