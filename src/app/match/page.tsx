import { redirect } from "next/navigation";
import MatchForm from "@/components/match-form";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";

export default async function MatchPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: profile }, { data: credits }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name,onboarding_completed")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("credit_balances").select("application_credits,interview_passes").eq("user_id", userId).maybeSingle(),
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");

  return (
    <AppShell
      fullName={profile.full_name}
      applicationCredits={credits?.application_credits ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
    >
      <section className="shell" style={{ padding: "54px 0 90px" }}>
      <div style={{ width: "min(820px,100%)", margin: "30px auto 0" }}>
        <div className="badge">Odysseus Match</div>
        <h1 style={{ fontSize: 50, letterSpacing: "-0.05em", margin: "16px 0 10px" }}>
          Is this role worth your time?
        </h1>
        <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 680, marginBottom: 30 }}>
          Paste the job description. Odysseus will compare it with the experience you already verified.
        </p>

        <MatchForm />
      </div>
      </section>
    </AppShell>
  );
}
