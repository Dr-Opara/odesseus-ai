import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata = { title: "Partner Program Terms — Odesseus" };

export default function PartnerTermsPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="shell partner-terms">
        <div className="badge">Partner Program Terms</div>
        <h1>Clear expectations for Odesseus partners.</h1>
        <p className="muted">These launch terms describe the operating rules for the program and should receive final legal review before broad public promotion.</p>

        {[
          ["Truthful marketing","Partners must accurately describe Odesseus and may not promise jobs, interviews, income, or hiring outcomes."],
          ["Disclosure","Partners are responsible for clearly disclosing sponsored, affiliate, or compensated relationships as required by applicable law and platform rules."],
          ["Brand usage","Odesseus names, logos, screenshots, and campaign assets may be used only for approved program activity and may not imply ownership, endorsement, or employment."],
          ["Prohibited promotion","Spam, deceptive claims, impersonation, fake accounts, self-referrals, unauthorized paid search bidding, and other misleading acquisition methods are prohibited."],
          ["Commission eligibility","Only qualifying purchases attributed under the partner’s approved terms are eligible. Failed payments, refunds, chargebacks, test transactions, and self-referrals do not qualify."],
          ["Platform compliance","Partners must follow Instagram, Facebook, TikTok, and any other applicable platform policies."],
          ["Termination","Odesseus may suspend or end participation for policy violations, fraud, brand misuse, or other material breaches of program terms."],
        ].map(([title,body]) => (
          <section className="partner-term-section" key={title}><h2>{title}</h2><p className="muted">{body}</p></section>
        ))}
      </section>
      <MarketingFooter />
    </main>
  );
}
