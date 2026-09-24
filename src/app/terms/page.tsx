import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";

const SECTIONS = [
  ["1. Using Odesseus.ai", "Odesseus.ai provides job discovery, job-match analysis, resume improvement, application assistance, application tracking, interview preparation, and related career tools. You are responsible for the accuracy of the information you provide and for reviewing material before it is submitted on your behalf."],
  ["2. Your account", "You must provide accurate account information and protect your login credentials. You are responsible for activity performed through your account unless prohibited by law."],
  ["3. AI-assisted features", "AI-generated recommendations may contain errors or omissions. Odesseus.ai is designed to assist your decisions, not replace your judgment. Resume changes and application actions should be reviewed by you before approval where the product requests approval."],
  ["4. Applications and third-party services", "Job listings, application systems, employers, interview platforms, and other third-party services are controlled by their respective providers. Odesseus.ai does not guarantee that a listing remains available, that an application will be accepted, or that using the service will result in an interview or offer."],
  ["5. Pricing and billing", "Charges, credits, passes, renewals, and other paid features are displayed before purchase. Applicable taxes, currency conversion, refunds, and payment processing may depend on your market and payment provider."],
  ["6. Acceptable use", "You may not use Odesseus.ai to impersonate another person, submit materially false information, interfere with the service, violate applicable law, or abuse third-party platforms."],
  ["7. Intellectual property", "Odesseus.ai and its software, branding, and original product content are protected by applicable intellectual-property laws. You retain ownership of content you upload, subject to the permissions needed for us to operate the service."],
  ["8. Service availability", "Features may change, be added, or be discontinued. We may suspend access when reasonably necessary for security, abuse prevention, maintenance, legal compliance, or protection of the service."],
  ["9. Disclaimers and liability", "To the extent permitted by law, the service is provided without guarantees of employment outcomes. Nothing in Odesseus.ai constitutes legal, financial, immigration, or employment-law advice."],
  ["10. Contact", "Questions about these Terms may be submitted through Odesseus.ai support."],
] as const;

export default function TermsPage() {
  return (
    <>
      <main className="legal-page-shell odesseus-desktop-only">
        <div className="legal-page-card">
          <Link href="/" className="legal-back-link">← Odesseus.ai</Link>
          <p className="legal-kicker">LEGAL</p>
          <h1>Terms of Service</h1>
          <p className="legal-updated">Last updated: September 23, 2026</p>
          {SECTIONS.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
      </main>

      <MobileScreen index="23" title="Terms of Service" lead="Effective date: September 23, 2026">
        <div className="m-legal-content">
          {SECTIONS.map(([title, body]) => (
            <div className="m-card m-legal-row" key={title}>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </MobileScreen>
    </>
  );
}
