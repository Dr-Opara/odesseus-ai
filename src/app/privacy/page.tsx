import Link from "next/link";
import MobileScreen from "@/components/mobile/mobile-screen";

const SECTIONS = [
  ["1. Information we collect", "Depending on the features you use, Odesseus.ai may process account information, profile and career preferences, uploaded resumes and documents, job descriptions, application records, interview-preparation content, billing information handled through payment providers, and technical information needed to operate and secure the service."],
  ["2. No required email inbox access", "The candidate experience does not require Odesseus.ai to read your personal email inbox to track applications or interview invitations. You can return to your account and update application status or begin interview preparation directly."],
  ["3. How information is used", "We use information to operate accounts, match jobs to your profile, improve an existing resume for a selected role, support approved applications, maintain application history, provide interview preparation, process payments, prevent abuse, and improve the product."],
  ["4. AI processing", "Information relevant to an AI-assisted feature may be sent to configured AI service providers to generate the requested analysis or output. We limit the information sent to what is reasonably necessary for that feature."],
  ["5. Service providers", "We may use infrastructure, authentication, database, payment, analytics, communications, security, and AI providers to operate Odesseus.ai. Those providers process information subject to their contractual and legal obligations."],
  ["6. Data retention", "We retain information for as long as reasonably needed to provide the service, maintain records requested by you, satisfy legal obligations, resolve disputes, and protect the platform. Retention may vary by data type and account status."],
  ["7. Security", "We use administrative, technical, and organizational safeguards designed to protect information. No online service can guarantee absolute security."],
  ["8. Your choices", "You may update eligible account information, manage certain preferences and notifications, and request available account or data actions through product settings or support."],
  ["9. Changes to this policy", "We may update this Privacy Policy as the service evolves. Material changes will be reflected by an updated effective date and, where appropriate, additional notice."],
  ["10. Contact", "Privacy questions may be submitted through Odesseus.ai support."],
] as const;

export default function PrivacyPage() {
  return (
    <>
      <main className="legal-page-shell odesseus-desktop-only">
        <div className="legal-page-card">
          <Link href="/" className="legal-back-link">← Odesseus.ai</Link>
          <p className="legal-kicker">LEGAL</p>
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Last updated: September 23, 2026</p>
          {SECTIONS.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
      </main>

      <MobileScreen index="24" title="Privacy Policy" lead="A clear view of how Odesseus uses data.">
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
