import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import CompanyProfileForm from "@/components/employers/company-profile-form";

/** Company Profile (Figma screen 85, F13-Q). Edits the same company data captured during onboarding. */
export default async function EmployerCompanyProfilePage() {
  const { orgId } = await requireEmployerPage("/employers/company");

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1120px,100%)", margin: "54px auto 90px" }}>
          <h1>Company Profile</h1>
          <p className="muted">Manage public employer information.</p>
          <CompanyProfileForm orgId={orgId} initialProfile={null} />
        </section>
      </div>
    </main>
  );
}
