import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";

const rows = [
  ["📜", "Terms of Service", "Rules for using Odesseus.ai", "/terms"],
  ["🔒", "Privacy Policy", "How information is handled", "/privacy"],
  ["♿", "Accessibility Statement", "Our accessibility commitment", "/accessibility"],
  ["📦", "Open-Source Licenses", "Third-party software notices", "/licenses"],
  ["ℹ", "About Odesseus.ai", "Product and company information", "/about"],
] as const;

export default function LegalPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />
          <section className="figma-page-hero">
            <span className="figma-eyebrow">LEGAL</span>
            <h1>Policies and product information.</h1>
          </section>
          <section className="figma-two-grid">
            {rows.map(([, title, sub, href]) => (
              <Link key={href} href={href} className="figma-info-card">
                <h2>{title}</h2>
                <p>{sub}</p>
              </Link>
            ))}
          </section>
        </div>
        <MarketingFooter />
      </main>

      <MobileScreen index="22" title="Legal" showBack>
        <div className="m-list">
          {rows.map(([icon, title, sub, href]) => (
            <Link className="m-card" href={href} key={href}>
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
