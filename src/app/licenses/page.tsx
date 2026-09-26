import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";

/** Placeholder entries only, until a production dependency-license inventory is generated. */
const packages = [
  ["Next.js", "MIT"],
  ["React", "MIT"],
  ["Supabase JS", "MIT"],
] as const;

export default function LicensesPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />
          <section className="figma-page-hero">
            <span className="figma-eyebrow">OPEN-SOURCE LICENSES</span>
            <h1>Third-party software used by Odesseus.ai.</h1>
          </section>
          <section className="figma-two-grid">
            {packages.map(([name, license]) => (
              <article key={name} className="figma-info-card">
                <h2>{name}</h2>
                <p>{license}</p>
              </article>
            ))}
          </section>
          <p className="muted" style={{ marginTop: 20 }}>
            Populate this list from the production dependency inventory before release.
          </p>
        </div>
        <MarketingFooter />
      </main>

      <MobileScreen index="26" title="Open-Source Licenses" lead="Third-party software used by Odesseus.ai.">
        <div className="m-list">
          {packages.map(([name, license]) => (
            <div className="m-card" key={name}>
              <span className="m-icon">📦</span>
              <span className="m-copy">
                <strong>{name}</strong>
                <small>{license}</small>
              </span>
            </div>
          ))}
        </div>
        <p className="m-note">
          Populate this list from the production dependency inventory before release.
        </p>
      </MobileScreen>
    </>
  );
}
