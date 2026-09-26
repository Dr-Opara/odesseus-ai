import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileLive from "@/components/mobile/mobile-live";

export default async function MobileLivePage({
  searchParams,
}: {
  searchParams: Promise<{ id: string }>;
}) {
  const { id } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: interview }, { data: liveSession }, { data: credits }] = await Promise.all([
    supabase
      .from("interviews")
      .select("id,stage,scheduled_at,meeting_provider,status,applications(company_name,role_title)")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("live_interview_sessions")
      .select("id,status,ended_at,activated_at,created_at")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_balances")
      .select("interview_passes,live_unlimited_until")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!interview) redirect("/interviews");

  return (
    <MobileLive
      interview={interview}
      interviewPasses={credits?.interview_passes ?? 0}
      liveUnlimitedUntil={credits?.live_unlimited_until ?? null}
      liveSession={liveSession}
    />
  );
}