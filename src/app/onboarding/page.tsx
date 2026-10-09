import { redirect } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import OnboardingForm from "@/components/onboarding-form";
import MobileOnboardingWizard from "@/components/mobile/mobile-onboarding-wizard";
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
    <>
    <main className="shell odesseus-desktop-only" style={{ minHeight: "100vh", padding: "54px 0 80px" }}>
      <OdesseusWordmark href="/" size="lg" />
      <div className="candidate-column" style={{ marginTop: 80 }}>
        <div className="page-eyebrow muted">Set up your profile</div>
        <h1 className="page-title">Start with your resume.</h1>
        <p className="muted page-subtitle" style={{ maxWidth: 600 }}>
          This becomes Odesseus&apos;s source of truth. You stay in control of what Odesseus uses on your behalf.
        </p>
        <OnboardingForm fullName={profile?.full_name ?? null} />
      </div>
    </main>
    <MobileOnboardingWizard fullName={profile?.full_name ?? null} />
    </>
  );
}
