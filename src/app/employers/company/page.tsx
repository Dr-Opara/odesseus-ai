import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import CompanyProfileForm from "@/components/employers/company-profile-form";

/** Company Profile (Figma screen 85, F13-Q). Edits the same company data captured during onboarding. */
export default async function EmployerCompanyProfilePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1120px,100%)", margin: "54px auto 90px" }}>
          <h1>Company Profile</h1>
          <p className="muted">Manage public employer information.</p>
          <CompanyProfileForm />
        </section>
      </div>
    </main>
  );
}
