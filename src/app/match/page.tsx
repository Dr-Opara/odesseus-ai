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
    supabase.from("credit_balances").select("wallet_balance_cents,interview_passes").eq("user_id", userId).maybeSingle(),
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");

  return (
    <AppShell
      fullName={profile.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
    >
      <section className="shell" style={{ padding: "54px 0 90px" }}>
      <div className="candidate-column" style={{ marginTop: 30 }}>
        <div className="badge">Odesseus Match</div>
        <h1 className="page-title">
          Is this role worth your time?
        </h1>
        <p className="muted page-subtitle" style={{ maxWidth: 680, marginBottom: 30 }}>
          Paste the job description. Odesseus will compare it with the experience you already verified.
        </p>

        <MatchForm />
      </div>
      </section>
    </AppShell>
  );
}
