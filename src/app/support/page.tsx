import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";

const rows = [
  ["💬", "Contact Support", "Send a message to the Odesseus team", "mailto:support@odesseus.ai"],
  ["⚠", "Report a Problem", "Tell us when something isn't working", "mailto:support@odesseus.ai?subject=Problem%20report"],
  ["💳", "Billing Support", "Questions about charges or payments", "mailto:billing@odesseus.ai"],
  ["♿", "Accessibility Support", "Report an accessibility issue", "/accessibility"],
  ["❓", "FAQ", "Browse common questions", "/faq"],
] as const;

export default function SupportPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />
          <section className="figma-page-hero">
            <span className="figma-eyebrow">HELP &amp; SUPPORT</span>
            <h1>Get help with your account or Odesseus services.</h1>
          </section>
          <section className="figma-two-grid">
            {rows.map(([, title, sub, href]) => (
              <Link key={title} href={href} className="figma-info-card">
                <h2>{title}</h2>
                <p>{sub}</p>
              </Link>
            ))}
          </section>
        </div>
        <MarketingFooter />
      </main>

      <MobileScreen index="28" title="Help & Support" lead="Get help with your account or Odesseus services.">
        <div className="m-list">
          {rows.map(([icon, title, sub, href]) => (
            <Link className="m-card" href={href} key={title}>
              <span className="m-icon">{icon}</span>
              <span className="m-copy">
                <strong>{title}</strong>
                <small>{sub}</small>
              </span>
              <b className="m-chevron">›</b>
            </Link>
          ))}
        </div>
      </MobileScreen>
    </>
  );
}
