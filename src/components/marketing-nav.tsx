"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";

const links = [
  { href: "/how-it-works", label: "Job Seekers" },
  { href: "/employers", label: "Employers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/job-search", label: "Job Search" },
];

// Keep the homepage header focused on the primary conversion paths.
// Company/support links (About, Careers, FAQ, Partner Program) live in the
// footer on both desktop and mobile.
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
        </nav>
        <div className="figma-nav-actions">
          <Link className={`figma-text-link ${inverse ? "is-inverse" : ""}`} href="/signin">Sign In</Link>
          <Link className="figma-btn figma-btn-orange" href="/signup">Get Started</Link>
        </div>
      </div>
    </header>
  );
}
