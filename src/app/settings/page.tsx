import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import PasswordChangeForm from "@/components/password-change-form";
import JobPreferencesForm from "@/components/job-preferences-form";
import LocalizationForm from "@/components/localization-form";
import DeleteAccountForm from "@/components/delete-account-form";
import { listCountries, type Country } from "@/lib/countries/service";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : undefined;

  if (!userId) redirect("/login");

  const [
    { data: profile },
    { data: credits },
    { data: jobPreferences },
    countries,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name,country_code,locale,preferred_currency,timezone,preferred_language,application_contact_email"
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("credit_balances").select("application_credits,interview_passes").eq("user_id", userId).maybeSingle(),
    supabase
      .from("job_preferences")
      .select("min_match_score,target_titles,target_locations,remote_only")
      .eq("user_id", userId)
      .maybeSingle(),
    listCountries(supabase).catch(() => [] as Country[]),
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
            Manage your account, security, and how Odesseus searches on your behalf.
          </p>

          {error ? (
            <div style={{ marginBottom: 18, padding: 14, borderRadius: 12, background: "#fff1ef" }}>{error}</div>
          ) : null}

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

          <div style={{ marginBottom: 18 }}>
            <JobPreferencesForm userId={userId} initial={jobPreferences} />
          </div>

          <div className="card" style={{ padding: 26, marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: 13 }}>Application Agent</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 8px" }}>Control how Odesseus applies.</h2>
            <p className="muted" style={{ margin: "0 0 18px", lineHeight: 1.55 }}>
              Choose Review, Hybrid, or Auto and set the limits Odesseus must respect before an application can proceed.
            </p>
            <div className="figma-three-grid compact">
              <div className="card" style={{ padding: 18 }}><strong>Review</strong><div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Approve every application.</div></div>
              <div className="card" style={{ padding: 18, borderColor: "var(--brand-blue)" }}><strong>Hybrid</strong><div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Auto-apply only when your rules and match threshold are met.</div></div>
              <div className="card" style={{ padding: 18 }}><strong>Auto</strong><div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Apply automatically only when every rule is satisfied.</div></div>
            </div>
            <div className="match-meta-grid" style={{ marginTop: 16 }}>
              <div className="card" style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Minimum Match Score</span><strong style={{ display: "block", marginTop: 6 }}>85%</strong></div>
              <div className="card" style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Daily Application Limit</span><strong style={{ display: "block", marginTop: 6 }}>10</strong></div>
              <div className="card" style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Default Apply Type</span><strong style={{ display: "block", marginTop: 6 }}>Smart Apply · $0.99</strong></div>
              <div className="card" style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Status</span><strong style={{ display: "block", marginTop: 6 }}>Active</strong></div>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "14px 0 0" }}>
              These controls are shown now so the UI matches the approved product model. Backend persistence and enforcement are connected in the next phase.
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            <LocalizationForm
              countries={countries}
              email={email}
              initial={
                profile
                  ? {
                      country_code: profile.country_code,
                      locale: profile.locale,
                      preferred_currency: profile.preferred_currency,
                      timezone: profile.timezone,
                      preferred_language: profile.preferred_language,
                      application_contact_email:
                        profile.application_contact_email,
                    }
                  : null
              }
            />
          </div>

          <div className="card" style={{ padding: 26, marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: 13 }}>Data &amp; privacy</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Your data</h2>
            <p className="muted" style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
              Download a copy of everything Odesseus has on file for you, including your
              profile, applications, interviews, and job matches.
            </p>
            <a className="btn btn-secondary" href="/api/account/export" download>
              Export my data
            </a>
          </div>

          <div className="card" style={{ padding: 26 }}>
            <div className="muted" style={{ fontSize: 13 }}>Danger zone</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Delete account</h2>
            <DeleteAccountForm />
          </div>
        </div>
      </section>
    </AppShell>
  );
}
