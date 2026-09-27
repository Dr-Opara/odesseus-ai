"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import { employerLogout } from "@/app/employers/actions";

/**
 * Employer portal header (Phase 5).
 *
 * This is the authenticated employer chrome, and it is intentionally NOT the
 * public employer marketing header (`employer-nav.tsx`). The public header
 * stays desktop-only with no hamburger; this one is the signed-in portal and
 * therefore needs a small, complete navigation on both form factors:
 *
 *  - Desktop: the four portal sections plus sign out. Job creation, seat
 *    administration, subscription changes and featured purchases live here and
 *    are desktop-first.
 *  - Mobile: a plain brand bar with sign out only. The portal's phone screens
 *    carry their own four-item bottom navigation; duplicating those links in a
 *    collapsed hamburger would be the same actions a second time.
 *
 * There is deliberately no Odesseus Live entry here. Live is a candidate
 * product and must not be reachable from an employer session.
 */

const PORTAL_LINKS = [
  { href: "/employers/dashboard", label: "Overview" },
  { href: "/employers/dashboard/jobs", label: "Jobs" },
  { href: "/employers/dashboard/team", label: "Team" },
  { href: "/employers/dashboard/billing", label: "Billing" },
] as const;

export default function EmployerPortalHeader({
  orgName,
  role,
}: {
  orgName: string | null;
  role: string | null;
}) {
  const pathname = usePathname();

  return (
    <>
      <header className="figma-nav odesseus-desktop-only employer-portal-nav">
        <div className="figma-nav-inner">
          <OdesseusWordmark href="/employers/dashboard" size="sm" />
          <nav className="figma-nav-links" aria-label="Employer portal">
            {PORTAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={pathname === link.href ? "is-active" : undefined}
                aria-current={pathname === link.href ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="figma-nav-actions">
            <span className="employer-portal-identity">
              {orgName || "Your organization"}
              {role ? <small>{role}</small> : null}
            </span>
            <form action={employerLogout}>
              <button className="figma-text-link employer-signout" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <header className="odesseus-mobile-only employer-portal-mobile-bar">
        <OdesseusWordmark href="/employers/dashboard" size="sm" />
        <div className="employer-portal-mobile-bar-right">
          <span className="employer-portal-mobile-org">{orgName || "Employer account"}</span>
          <form action={employerLogout}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
    </>
  );
}
