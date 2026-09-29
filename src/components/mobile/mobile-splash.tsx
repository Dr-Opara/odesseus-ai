"use client";

import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import HomepageBody from "@/components/homepage-body";

/**
 * Mobile Splash (screen 00) — the public landing at phone width.
 *
 * Single source of truth for Screen 00: the production mobile homepage (`/`
 * under the mobile breakpoint) renders this component, and the QA preview
 * (`/qa/mobile/00`) frames the real `/` route in an iframe, so both paths
 * always show the exact same approved Figma experience. Shares
 * `HomepageBody` (hero, job carousel, trust band, capability tiles, logo
 * strip) with the desktop landing in `src/app/page.tsx` — only the compact
 * nav here differs. `HomepageBody` self-fetches jobs client-side since this
 * is a client-only component with no server-verified signed-in state.
 */
export default function MobileSplash() {
  return (
    <main className="m-oh-screen odesseus-mobile-only">
      <nav className="m-oh-nav">
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
      <div className="m-oh-body">
        <HomepageBody />
      </div>
    </main>
  );
}
