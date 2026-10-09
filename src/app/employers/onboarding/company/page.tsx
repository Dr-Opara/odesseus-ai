import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";

/**
 * Employer Onboarding — Company Details (Figma screen 70). Step 1 of 3.
 * Carries collected fields forward to the plan step via a GET form — no
 * client JS needed, and nothing is persisted until the final review step
 * (F13-B: don't pretend provisioning succeeded before the backend confirms it).
 */
export default async function EmployerOnboardingCompanyPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const defaultCompanyName = typeof user.user_metadata?.company_name === "string" ? user.user_metadata.company_name : "";

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(900px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">STEP 1 OF 3</span>
          <h1>Tell us about your company.</h1>

          <form method="get" action="/employers/onboarding/plan" className="figma-info-card white" style={{ padding: 32, marginTop: 24, display: "grid", gap: 18 }}>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
              Company name
              <input className="input" name="companyName" required defaultValue={defaultCompanyName} placeholder="Acme Security" />
            </label>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
              Website
              <input className="input" name="companyWebsite" type="url" placeholder="acmesecurity.com" />
            </label>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
              Industry
              <input className="input" name="industry" placeholder="Cybersecurity" />
            </label>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
              Company size
              <select className="input" name="companySize" defaultValue="">
                <option value="" disabled>
                  Select a range
                </option>
                <option>1–10 employees</option>
                <option>11–50 employees</option>
                <option>51–200 employees</option>
                <option>201–1,000 employees</option>
                <option>1,000+ employees</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
              HQ location
              <input className="input" name="hqLocation" placeholder="Austin, TX" />
            </label>
            <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>
              Recruiter/admin contact name
              <input className="input" name="contactName" placeholder="Your name" />
            </label>
            <button className="figma-btn figma-btn-orange" type="submit" style={{ width: "100%", marginTop: 6 }}>
              Continue
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
