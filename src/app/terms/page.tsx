import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="legal-page-shell">
      <div className="legal-page-card">
        <Link href="/" className="legal-back-link">← Odesseus.ai</Link>
        <p className="legal-kicker">LEGAL</p>
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: September 23, 2026</p>

        <section><h2>1. Using Odesseus.ai</h2><p>Odesseus.ai provides job discovery, job-match analysis, resume improvement, application assistance, application tracking, interview preparation, and related career tools. You are responsible for the accuracy of the information you provide and for reviewing material before it is submitted on your behalf.</p></section>
        <section><h2>2. Your account</h2><p>You must provide accurate account information and protect your login credentials. You are responsible for activity performed through your account unless prohibited by law.</p></section>
        <section><h2>3. AI-assisted features</h2><p>AI-generated recommendations may contain errors or omissions. Odesseus.ai is designed to assist your decisions, not replace your judgment. Resume changes and application actions should be reviewed by you before approval where the product requests approval.</p></section>
        <section><h2>4. Applications and third-party services</h2><p>Job listings, application systems, employers, interview platforms, and other third-party services are controlled by their respective providers. Odesseus.ai does not guarantee that a listing remains available, that an application will be accepted, or that using the service will result in an interview or offer.</p></section>
        <section><h2>5. Pricing and billing</h2><p>Charges, credits, passes, renewals, and other paid features are displayed before purchase. Applicable taxes, currency conversion, refunds, and payment processing may depend on your market and payment provider.</p></section>
        <section><h2>6. Acceptable use</h2><p>You may not use Odesseus.ai to impersonate another person, submit materially false information, interfere with the service, violate applicable law, or abuse third-party platforms.</p></section>
        <section><h2>7. Intellectual property</h2><p>Odesseus.ai and its software, branding, and original product content are protected by applicable intellectual-property laws. You retain ownership of content you upload, subject to the permissions needed for us to operate the service.</p></section>
        <section><h2>8. Service availability</h2><p>Features may change, be added, or be discontinued. We may suspend access when reasonably necessary for security, abuse prevention, maintenance, legal compliance, or protection of the service.</p></section>
        <section><h2>9. Disclaimers and liability</h2><p>To the extent permitted by law, the service is provided without guarantees of employment outcomes. Nothing in Odesseus.ai constitutes legal, financial, immigration, or employment-law advice.</p></section>
        <section><h2>10. Contact</h2><p>Questions about these Terms may be submitted through Odesseus.ai support.</p></section>
      </div>
    </main>
  );
}
