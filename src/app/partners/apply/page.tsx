import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import PartnerApplicationForm from "@/components/partner-application-form";

export const metadata = { title: "Apply — Odysseus Partner Program" };

export default async function PartnerApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { submitted } = await searchParams;
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="shell partner-apply-shell">
        {submitted === "1" ? (
          <div className="card partner-success">
            <div className="badge">Application received</div>
            <h1>Thanks for applying.</h1>
            <p className="muted">Our team will review your profile and contact you if there’s a fit.</p>
          </div>
        ) : (
          <>
            <div className="partner-apply-heading">
              <div className="badge">Partner application</div>
              <h1>Tell us about you and your audience.</h1>
              <p className="muted">We review applications manually. You do not need to already be an Odysseus customer.</p>
            </div>
            <PartnerApplicationForm />
          </>
        )}
      </section>
      <MarketingFooter />
    </main>
  );
}
