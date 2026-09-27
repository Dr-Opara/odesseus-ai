import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export default function EarnPage() {
  return (
    <main className="odesseus-marketing">
      <section className="od-home">
        <MarketingNav />
        <section className="od-earn-hero">
          <span className="od-kicker">EARN WITH ODESSEUS</span>
          <h1>Your job search can pay you back.</h1>
          <p>Eligible annual members can share premium interview access with up to 10 unique friends and earn from guest sessions while continuing their own job search.</p>
          <div className="od-hero-actions">
            <Link className="od-primary-btn" href="/signup">Join Odesseus</Link>
            <Link className="od-secondary-link" href="/pricing">See candidate pricing →</Link>
          </div>
        </section>

        <section className="od-section">
          <div className="od-section-heading">
            <span className="od-kicker">HOW IT WORKS</span>
            <h2>Use it yourself. Share it with friends. Earn when they use your guest access.</h2>
          </div>
          <div className="od-earn-flow">
            <article><span>1</span><h3>Choose an eligible annual membership</h3><p>Your membership includes your personal interview access plus the ability to invite guests.</p></article>
            <article><span>2</span><h3>Invite up to 10 unique friends</h3><p>Every guest uses their own Odesseus account, resume, job information, and private workspace.</p></article>
            <article><span>3</span><h3>Earn from guest sessions</h3><p>Offer access to people in your network and earn through eligible paid guest sessions.</p></article>
          </div>
        </section>

        <section className="od-section od-earn-rules">
          <div>
            <span className="od-kicker">10 UNIQUE GUESTS</span>
            <h2>Built for sharing, not account sharing.</h2>
            <p>Invited guests never receive your login or see your job-search information. A guest slot becomes used after that guest activates interview access. Unused invitations can be revoked.</p>
          </div>
          <div className="od-earn-rule-card">
            <div><strong>10</strong><span>unique guest slots per membership year</span></div>
            <div><strong>Private</strong><span>separate guest accounts and workspaces</span></div>
            <div><strong>Reset</strong><span>guest allocation renews with the eligible annual membership</span></div>
          </div>
        </section>

        <section className="od-section od-earn-disclosure">
          <span className="od-kicker">MEMBERSHIP DETAILS</span>
          <h2>Designed to help candidates offset the cost of their job search.</h2>
          <p>Guest-session pricing, owner earnings, platform fees, session allowances, payout eligibility, and country availability will be shown before a member enables paid sharing. Earnings are not guaranteed.</p>
          <Link className="od-primary-btn" href="/signup">Create free account</Link>
        </section>
      </section>
      <MarketingFooter />
    </main>
  );
}
