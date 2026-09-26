"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { resolveMobileScreen } from "@/lib/mobile/screen-map";
import MobileSplash from "@/components/mobile/mobile-splash";

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

export default function MobileRouteExperience({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const screen = resolveMobileScreen(pathname);
  if (!screen) return <>{children}</>;
  if (screen.index === "00") {
    return (
      <>
        <MobileSplash />
        <div className="odesseus-desktop-only">{children}</div>
      </>
    );
  }
  // Auth/onboarding (01–04) and every other mapped screen render their own
  // real mobile presentation inside the page; pass children through.
  return <>{children}</>;
}