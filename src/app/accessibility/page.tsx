import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";

const sections = [
  ["Designed for more people", "Usable across different abilities, devices and assistive technologies."],
  ["Our approach", "Readable contrast, scalable text, keyboard navigation, meaningful labels and assistive technology compatibility."],
] as const;

export default function AccessibilityPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />
          <section className="figma-page-hero">
            <span className="figma-eyebrow">ACCESSIBILITY</span>
            <h1>Our commitment to an inclusive Odesseus experience.</h1>
          </section>
          <section className="figma-two-grid">
            {sections.map(([title, body]) => (
              <article key={title} className="figma-info-card">
                <h2>{title}</h2>
                <p>{body}</p>
              </article>
            ))}
          </section>
          <section className="figma-info-card peach" style={{ marginTop: 24 }}>
            <h2>Feedback</h2>
            <p>Contact support if you experience an accessibility barrier.</p>
          </section>
        </div>
        <MarketingFooter />
      </main>

      <MobileScreen index="25" title="Accessibility Statement" lead="Our commitment to an inclusive Odesseus experience.">
        <div className="m-list">
          {sections.map(([title, body]) => (
            <div className="m-card" key={title}>
              <span className="m-icon">♿</span>
              <span className="m-copy">
                <strong>{title}</strong>
                <small>{body}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="m-note-card m-card" style={{ marginTop: 14 }}>
          <strong>Feedback</strong>
          <p className="muted">Contact support if you experience an accessibility barrier.</p>
        </div>
        <a className="m-action" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/support">
          Contact Accessibility Support
        </a>
      </MobileScreen>
    </>
  );
}
