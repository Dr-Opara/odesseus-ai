"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";

const links = [
  { href: "/how-it-works", label: "Job Seekers" },
  { href: "/employers", label: "Employers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

// Signed-out mobile public navigation is intentionally minimal.
//
// On a phone the splash (screen 00) owns the public calls to action —
// Get Started -> /signup, Business Login -> /employers/login, and
// See Pricing -> /pricing. Repeating Sign In and Get Started inside a
// collapsible phone menu was duplicating those exact actions, so the header
// carries no hamburger at all below the desktop breakpoint. What remains at
// phone width is the wordmark (a link home) plus the shared MarketingFooter,
// which already lists every public route: How it works, Pricing, Agents,
// About, Partner Program, FAQ, For Employers and Employer Pricing.
//
// The desktop navigation is unchanged: the same links, the same Sign In and
// Get Started actions, and no hamburger at any width.
export default function MarketingNav({ inverse = false }: { inverse?: boolean }) {
  const pathname = usePathname();

  return (
    <header className={`figma-nav ${inverse ? "is-inverse" : ""}`}>
      <div className="figma-nav-inner">
        <OdesseusWordmark href="/" size="sm" inverse={inverse} />
        <nav className="figma-nav-links" aria-label="Primary">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "is-active" : undefined}>
              {link.label}
            </Link>
          ))}
          <Link href="/about#faq">FAQ</Link>
        </nav>
        <div className="figma-nav-actions">
          <Link className={`figma-text-link ${inverse ? "is-inverse" : ""}`} href="/login">Sign In</Link>
          <Link className="figma-btn figma-btn-orange" href="/signup">Get Started</Link>
        </div>
      </div>
    </header>
  );
}
