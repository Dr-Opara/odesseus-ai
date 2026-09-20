import Link from "next/link";
import BrandLogo from "@/components/brand-logo";

export default function MarketingFooter() {
  return (
    <footer className="shell marketing-footer">
      <div className="marketing-footer-top">
        <div className="marketing-footer-brand">
          <BrandLogo href="/" width={174} />
          <p className="muted" style={{ fontSize: 13, margin: "10px 0 0", maxWidth: 260 }}>
            Your next move, handled.
          </p>
        </div>

        <div className="marketing-footer-col">
          <div className="marketing-footer-heading">Product</div>
          <Link href="/how-it-works">How It Works</Link>
          <Link href="/apply">Apply</Link>
          <Link href="/live">Live</Link>
          <Link href="/pricing">Pricing</Link>
        </div>

        <div className="marketing-footer-col">
          <div className="marketing-footer-heading">Company</div>
          <Link href="/about">About</Link>
          <Link href="/partners">Partner Program</Link>
        </div>

        <div className="marketing-footer-col">
          <div className="marketing-footer-heading">Account</div>
          <Link href="/login">Sign In</Link>
          <Link href="/signup">Get Started</Link>
        </div>
      </div>

      <div className="marketing-footer-bottom">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Odysseus is developed by ProcessPilot Technologies LLC.
        </p>
      </div>
    </footer>
  );
}
