import Image from "next/image";
import Link from "next/link";

export default function MarketingFooter() {
  return (
    <footer className="shell marketing-footer">
      <div className="marketing-footer-top">
        <div className="marketing-footer-brand">
          <div className="marketing-wordmark">
            <Image src="/odesseus-logo.png" alt="Odesseus.ai" width={134} height={22} style={{ height: 22, width: "auto" }} />
          </div>
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
        </div>
      </div>

      <div className="marketing-footer-bottom">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Odesseus is developed by ProcessPilot Technologies LLC.
        </p>
      </div>
    </footer>
  );
}
