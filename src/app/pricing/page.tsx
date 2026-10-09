import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobilePricing from "@/components/mobile/mobile-pricing";

export default function PricingPage() {
  return (
    <>
      <main className="figma-site figma-soft-page odesseus-desktop-only">
        <div className="figma-page-wrap">
          <MarketingNav />

          <section className="figma-page-hero">
            <span className="figma-eyebrow">PRICING</span>
            <h1>Flexible pricing for candidates and employers.</h1>
            <p>Choose what you need without forcing every user into the same plan.</p>
          </section>

          <section className="pricing-desktop-shell" aria-label="Odesseus pricing">
            <MobilePricing />
          </section>
        </div>
        <MarketingFooter />
      </main>

      <MobileScreen index="30" title="Pricing" lead="Pay for what you use. Prep is free." minHeight={1000}>
        <MobilePricing />
      </MobileScreen>
    </>
  );
}
