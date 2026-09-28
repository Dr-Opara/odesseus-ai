import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileWorkAuthorization from "@/components/mobile/mobile-work-authorization";

export default async function WorkAuthorizationSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: authorization } = await supabase
    .from("candidate_work_authorization")
    .select("country_code,authorized_without_sponsorship,sponsorship_required,relocation_allowed")
    .eq("user_id", userId)
    .maybeSingle();

  return (
    <MobileWorkAuthorization
      userId={userId}
      initial={{
        country_code: authorization?.country_code ?? null,
        authorized_without_sponsorship: authorization?.authorized_without_sponsorship ?? false,
        sponsorship_required: authorization?.sponsorship_required ?? false,
        relocation_allowed: authorization?.relocation_allowed ?? false,
      }}
    />
  );
}
