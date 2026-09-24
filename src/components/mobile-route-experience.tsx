"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { resolveMobileScreen } from "@/lib/mobile/screen-map";

/**
 * Mobile/desktop rendering boundary (Phase 4, evolved by Phase 5).
 *
 * Phase 4 swapped in hardcoded Figma mock screens at phone widths. Phase 5
 * replaces that: every real page now renders its own mobile presentation
 * (inside `odesseus-mobile-only`) fed by the same shared candidate services
 * the desktop layout uses, so there is no second backend and no mock data.
 *
 * This component only keeps the two boundary exceptions:
 *  - screen 00 (the public landing): a marketing splash on phone widths, the
 *    real marketing landing on desktop — no backend records involved;
 *  - auth/onboarding screens (01–04): the real signup/onboarding pages are
 *    already shared and render responsively.
 *
 * Everything else passes straight through to the real page.
 */

function Splash() {
  return (
    <main className="m-splash odesseus-mobile-only">
      <span className="m-splash-orb m-splash-orb-tl-a" aria-hidden="true" />
      <span className="m-splash-orb m-splash-orb-tl-b" aria-hidden="true" />
      <span className="m-splash-orb m-splash-orb-br-a" aria-hidden="true" />
      <span className="m-splash-orb m-splash-orb-br-b" aria-hidden="true" />
      <span className="m-splash-orb m-splash-orb-br-c" aria-hidden="true" />

      <div className="m-splash-card">
        <div className="m-stack">
          <div className="m-stack-card m-stack-nvidia">Discover</div>
          <div className="m-stack-card m-stack-amazon">Tailor</div>
          <div className="m-stack-card m-stack-google">Apply</div>
          <div className="m-stack-card m-stack-ms">
            <div className="m-stack-ms-top">
              <span className="m-stack-ms-logo" aria-hidden="true">O</span>
              <b>Odesseus</b>
            </div>
            <h2>
              Your next
              <br />
              move, handled.
            </h2>
            <small>Every material step approved by you</small>
          </div>
        </div>

        <h1>
          Discover Your
          <br />
          <em>Dream Job</em>
          <br />
          with <em>Odesseus.ai</em>
        </h1>
        <p>
          Find roles that fit your experience, strengthen your resume, apply with your
          approval, and prepare for what comes next.
        </p>
        <Link href="/signup" className="m-primary">
          <span>Get Started</span>
          <b aria-hidden="true">→</b>
        </Link>

        <div className="m-splash-stats">
          <span><b>500K+</b><small>Applicants</small></span>
          <span><b>100K+</b><small>Hires</small></span>
          <span><b>20+</b><small>Countries</small></span>
          <span><b>95%</b><small>Satisfaction</small></span>
        </div>

        <div className="m-splash-footer">
          <strong>Odesseus.ai</strong>
          <span>Career agents built around your approval.</span>
        </div>
      </div>
    </main>
  );
}

export default function MobileRouteExperience({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const screen = resolveMobileScreen(pathname);
  if (!screen) return <>{children}</>;
  if (screen.index === "00") {
    return (
      <>
        <Splash />
        <div className="odesseus-desktop-only">{children}</div>
      </>
    );
  }
  // Auth/onboarding (01–04) and every other mapped screen render their own
  // real mobile presentation inside the page; pass children through.
  return <>{children}</>;
}