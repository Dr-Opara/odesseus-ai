import Link from "next/link";
import { redirect } from "next/navigation";
import OnboardingForm from "@/components/onboarding-form";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", data.claims.sub)
    .maybeSingle();

  return (
    <main className="shell" style={{ minHeight: "100vh", padding: "54px 0 80px" }}>
      <Link href="/" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em" }}>Odysseus</Link>
      <div style={{ width: "min(720px,100%)", margin: "80px auto 0" }}>
        <div className="muted" style={{ fontSize: 14 }}>Set up your profile</div>
        <h1 style={{ fontSize: 52, letterSpacing: "-0.05em", margin: "12px 0" }}>Start with your resume.</h1>
        <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 600 }}>
          This becomes Odysseus&apos;s source of truth. You stay in control of what Odysseus uses on your behalf.
        </p>
        <OnboardingForm fullName={profile?.full_name ?? null} />
      </div>
    </main>
  );
}
