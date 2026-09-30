"use client";

import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import HomepageBody from "@/components/homepage-body";
import MarketingFooter from "@/components/marketing-footer";

/**
 * Mobile Splash (screen 00) — the public landing at phone width.
 *
 * Shares HomepageBody with desktop and now also renders the same marketing
 * footer so the mobile web app exposes the same public navigation/content
 * hierarchy as desktop in a mobile-friendly layout.
 */
export default function MobileSplash() {
  return (
    <main className="m-oh-screen odesseus-mobile-only">
      <header className="m-oh-header">
        <nav className="m-oh-nav" aria-label="Mobile primary">
          <OdesseusWordmark href="/" size="sm" />
          <div className="m-oh-nav-actions">
            <Link href="/signin" className="m-oh-nav-signin">
              Sign in
            </Link>
            <Link href="/signup" className="m-oh-nav-cta">
              Get Started
            </Link>
          </div>
        </nav>
        <div className="m-oh-primary-links">
          <Link href="/how-it-works">Job Seekers</Link>
          <Link href="/employers">Employers</Link>
          <Link href="/pricing">Pricing</Link>
        </div>
      </header>

      <div className="m-oh-body">
        <HomepageBody />
      </div>

      <MarketingFooter />
    </main>
  );
}
