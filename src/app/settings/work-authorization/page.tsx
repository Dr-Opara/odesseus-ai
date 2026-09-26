import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileWorkAuthorization from "@/components/mobile/mobile-work-authorization";

export default async function WorkAuthorizationSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: preferences } = await supabase
    .from("job_preferences")
    .select("work_authorization,sponsorship_needed")
    .eq("user_id", userId)
    .maybeSingle();

  return (
    <MobileWorkAuthorization
      userId={userId}
      initial={{
        work_authorization: preferences?.work_authorization ?? null,
        sponsorship_needed: preferences?.sponsorship_needed ?? null,
      }}
    />
  );
}
