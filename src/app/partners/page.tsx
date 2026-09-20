import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata = {
  title: "Partner Program — Odesseus",
  description: "Partner with Odesseus as a creator, affiliate, ambassador, or campaign partner.",
};

export default function PartnersPage() {
  return (
    <main className="marketing-page">
      <MarketingNav />
      <section className="shell partner-hero">
        <div className="badge">Odesseus Partner Program</div>
        <h1>Partner with Odesseus.</h1>
        <p>Create content. Grow your audience. Help more people navigate their job search with AI.</p>
        <div className="partner-hero-actions">
          <Link className="btn btn-primary" href="/partners/apply">Apply to partner</Link>
          <a className="btn btn-secondary" href="#how-it-works">How it works</a>
        </div>
        <div className="partner-platform-row">
          <span>Instagram</span><span>Facebook</span><span>TikTok</span>
        </div>
      </section>

      <section id="how-it-works" className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">How it works</div>
          <h2>From application to collaboration.</h2>
        </div>
        <div className="partner-steps">
          {[
            ["01","Apply","Tell us about your content, audience, and the platforms you use."],
            ["02","Get approved","Our team reviews every application and decides whether there is a fit."],
            ["03","Create","Create approved Odesseus content, tag our social account, and use your referral link."],
            ["04","Earn","Receive rewards or commissions according to your approved partner terms."],
          ].map(([num,title,body]) => (
            <article className="card partner-step" key={num}>
              <span>{num}</span><h3>{title}</h3><p className="muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">Ways to partner</div>
          <h2>Built for different kinds of creators.</h2>
        </div>
        <div className="partner-types">
          {[
            ["Affiliate Partners","Share Odesseus with your audience using a personal referral link and approved program terms."],
            ["Creator Partners","Create original social content that demonstrates how Odesseus supports the job-search journey."],
            ["Brand Ambassadors","Build an ongoing relationship with the Odesseus brand across multiple campaigns."],
            ["Sponsored Campaigns","Participate in specific launches and content briefs when there is a strong audience fit."],
          ].map(([title,body]) => (
            <article className="card partner-type" key={title}><h3>{title}</h3><p className="muted">{body}</p></article>
          ))}
        </div>
        <p className="muted partner-reward-note">Partner rewards and commission terms are provided upon approval.</p>
      </section>

      <section className="shell partner-cta card">
        <div><div className="badge">Launch with us</div><h2>Want to help introduce Odesseus to the world?</h2></div>
        <Link className="btn btn-primary" href="/partners/apply">Apply to the Partner Program</Link>
      </section>
      <MarketingFooter />
    </main>
  );
}
