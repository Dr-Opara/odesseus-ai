"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";

const links = [
  { href: "/employers", label: "Employer Home" },
  { href: "/employers/pricing", label: "Pricing" },
];

// The employer marketing header is desktop-only, and it has no collapsible
// mobile menu.
//
// Employer Home / Pricing / For Candidates / Sign In / Post a Job are
// desktop links. They are deliberately NOT reproduced in a phone-width
// menu: on phones the public business entry points are owned by the mobile
// splash (Business Login -> /employers/login, See Pricing -> /pricing), and
// duplicating Sign In / Post a Job there would just be the same two actions a
// second time. The header therefore keeps no hamburger at all, so those five
// labels can never appear below the desktop breakpoint.
//
// `odesseus-desktop-only` hides the header entirely under 768px. Between
// 768px and 900px the marketing collapse rule hides the link and action rows,
// which leaves the wordmark as a plain brand bar — still no employer menu.
export default function EmployerNav({ inverse = false }: { inverse?: boolean }) {
  const pathname = usePathname();

  return (
    <header className={`figma-nav odesseus-desktop-only ${inverse ? "is-inverse" : ""}`}>
      <div className="figma-nav-inner">
        <OdesseusWordmark href="/employers" size="sm" inverse={inverse} />
        <nav className="figma-nav-links" aria-label="Employer">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "is-active" : undefined}>
              {link.label}
            </Link>
          ))}
          <Link href="/">For Candidates</Link>
        </nav>
        <div className="figma-nav-actions">
          <Link className={`figma-text-link ${inverse ? "is-inverse" : ""}`} href="/employers/login">Sign In</Link>
          <Link className="figma-btn figma-btn-orange" href="/employers/post-job">Post a Job</Link>
        </div>
      </div>
    </header>
  );
}
