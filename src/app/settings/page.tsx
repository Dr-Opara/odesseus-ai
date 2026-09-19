import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import PasswordChangeForm from "@/components/password-change-form";
import JobPreferencesForm from "@/components/job-preferences-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : undefined;

  if (!userId) redirect("/login");

  const [{ data: profile }, { data: credits }, { data: jobPreferences }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.from("credit_balances").select("application_credits,interview_passes").eq("user_id", userId).maybeSingle(),
    supabase
      .from("job_preferences")
      .select("min_match_score,target_titles,target_locations,remote_only")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return (
    <AppShell
      fullName={profile?.full_name}
      applicationCredits={credits?.application_credits ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
    >
      <section className="shell" style={{ padding: "54px 0 100px" }}>
        <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
          <div className="muted" style={{ fontSize: 14 }}>Settings</div>
          <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "10px 0 6px" }}>
            Account &amp; preferences.
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 30 }}>
            Manage your account, security, and how Odysseus searches on your behalf.
          </p>

          <div className="card" style={{ padding: 26, marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: 13 }}>Account</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>{profile?.full_name || "Your account"}</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <span className="muted" style={{ fontSize: 13 }}>Email</span>
                <div>{email || "Not available"}</div>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <Link className="btn btn-secondary" href="/profile">
                Edit name &amp; profile details
              </Link>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <PasswordChangeForm />
          </div>

          <JobPreferencesForm userId={userId} initial={jobPreferences} />
        </div>
      </section>
    </AppShell>
  );
}
