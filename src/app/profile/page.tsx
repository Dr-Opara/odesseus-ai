import { redirect } from "next/navigation";
import Link from "next/link";
import ProfileForm from "@/components/profile-form";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: profile }, { data: credits }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name,headline,location,work_preference")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("credit_balances").select("application_credits,interview_passes").eq("user_id", userId).maybeSingle(),
  ]);

  return (
    <AppShell
      fullName={profile?.full_name}
      applicationCredits={credits?.application_credits ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="profile"
    >
      <section className="shell" style={{ padding: "54px 0 90px" }}>
      <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
        <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", marginBottom: 10 }}>Profile</h1>
        <p className="muted">The verified information Odysseus uses on your behalf.</p>
        <ProfileForm userId={userId} initial={profile} />

        <div className="card profile-integration-card">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Integrations</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 6px" }}>Email + Calendar</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
              Let Odysseus detect employer responses, assessments, interview invitations, and scheduled interviews.
            </p>
          </div>
          <Link href="/integrations" className="btn btn-secondary">
            Manage Google
          </Link>
        </div>
      </div>
      </section>
    </AppShell>
  );
}
