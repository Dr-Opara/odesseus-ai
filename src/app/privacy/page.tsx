import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-page-shell">
      <div className="legal-page-card">
        <Link href="/" className="legal-back-link">← Odesseus.ai</Link>
        <p className="legal-kicker">LEGAL</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: September 23, 2026</p>

        <section><h2>1. Information we collect</h2><p>Depending on the features you use, Odesseus.ai may process account information, profile and career preferences, uploaded resumes and documents, job descriptions, application records, interview-preparation content, billing information handled through payment providers, and technical information needed to operate and secure the service.</p></section>
        <section><h2>2. No required email inbox access</h2><p>The candidate experience does not require Odesseus.ai to read your personal email inbox to track applications or interview invitations. You can return to your account and update application status or begin interview preparation directly.</p></section>
        <section><h2>3. How information is used</h2><p>We use information to operate accounts, match jobs to your profile, improve an existing resume for a selected role, support approved applications, maintain application history, provide interview preparation, process payments, prevent abuse, and improve the product.</p></section>
        <section><h2>4. AI processing</h2><p>Information relevant to an AI-assisted feature may be sent to configured AI service providers to generate the requested analysis or output. We limit the information sent to what is reasonably necessary for that feature.</p></section>
        <section><h2>5. Service providers</h2><p>We may use infrastructure, authentication, database, payment, analytics, communications, security, and AI providers to operate Odesseus.ai. Those providers process information subject to their contractual and legal obligations.</p></section>
        <section><h2>6. Data retention</h2><p>We retain information for as long as reasonably needed to provide the service, maintain records requested by you, satisfy legal obligations, resolve disputes, and protect the platform. Retention may vary by data type and account status.</p></section>
        <section><h2>7. Security</h2><p>We use administrative, technical, and organizational safeguards designed to protect information. No online service can guarantee absolute security.</p></section>
        <section><h2>8. Your choices</h2><p>You may update eligible account information, manage certain preferences and notifications, and request available account or data actions through product settings or support.</p></section>
        <section><h2>9. Changes to this policy</h2><p>We may update this Privacy Policy as the service evolves. Material changes will be reflected by an updated effective date and, where appropriate, additional notice.</p></section>
        <section><h2>10. Contact</h2><p>Privacy questions may be submitted through Odesseus.ai support.</p></section>
      </div>
    </main>
  );
}
