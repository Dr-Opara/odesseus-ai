import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";

export default function MarketingFooter() {
  return (
    <footer className="figma-footer">
      <div className="figma-footer-grid">
        <div>
          <OdesseusWordmark size="md" inverse />
          <p>AI-powered career support from discovery to interview.</p>
        </div>
        <div><strong>Job Seekers</strong><Link href="/how-it-works">How it works</Link><Link href="/pricing">Pricing</Link><Link href="/agents">Agents</Link></div>
        <div><strong>Employers</strong><Link href="/employers">For Employers</Link><Link href="/employers#pricing">Employer Pricing</Link></div>
        <div><strong>Company</strong><Link href="/about">About</Link><Link href="/careers">Careers</Link><Link href="/partners">Partner Program</Link><Link href="/about#faq">FAQ</Link></div>
      </div>
      <div className="figma-footer-bottom">
        <span>Developed by ProcessPilot Technologies LLC</span>
        <span>© 2026 Odesseus.ai</span>
      </div>
    </footer>
  );
}
