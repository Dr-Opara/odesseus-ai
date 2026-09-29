import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import CompanyProfileForm from "@/components/employers/company-profile-form";
import { getEmployerProfile } from "@/lib/employers/onboarding-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";

/**
 * Company Profile (Figma screen 85, F13-Q).
 *
 * The profile is read server-side and handed to the form, so the page renders
 * with real values on first paint. An employer whose workspace was never
 * provisioned is sent to set-up rather than shown an empty form that could not
 * save.
 */
export default async function EmployerCompanyProfilePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [profile, orgId] = await Promise.all([getEmployerProfile(), getEmployerOrgId()]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1120px,100%)", margin: "54px auto 90px" }}>
          <h1>Company Profile</h1>
          <p className="muted">Manage public employer information.</p>

          {profile.status === "ok" ? (
            <CompanyProfileForm orgId={orgId ?? ""} profile={profile.data} />
          ) : (
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="Your company profile isn't available yet"
                message={profile.reason}
                actionHref="/employers/onboarding/company"
                actionLabel="Set up your workspace"
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
