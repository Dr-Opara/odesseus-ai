import Link from "next/link";
import { redirect } from "next/navigation";
import MatchForm from "@/components/match-form";
import { createClient } from "@/lib/supabase/server";

export default async function MatchPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  return (
    <main className="shell" style={{ padding: "54px 0 90px" }}>
      <Link href="/dashboard" className="wordmark">Odysseus</Link>

      <div style={{ width: "min(820px,100%)", margin: "70px auto 0" }}>
        <div className="badge">Odysseus Match</div>
        <h1 style={{ fontSize: 50, letterSpacing: "-0.05em", margin: "16px 0 10px" }}>
          Is this role worth your time?
        </h1>
        <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 680, marginBottom: 30 }}>
          Paste the job description. Odysseus will compare it with the experience you already verified.
        </p>

        <MatchForm />
      </div>
    </main>
  );
}
