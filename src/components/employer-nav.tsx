"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";

const links = [
  { href: "/employers", label: "Employer Home" },
  { href: "/employers/pricing", label: "Pricing" },
];

// The employer marketing header (its links and the mobile menu that carried
// Employer Home / Pricing / For Candidates / Sign In / Post a Job) is
// desktop-only. On phones the public entry points are owned by the splash —
// Get Started, Business Login, See Pricing — so this header is not rendered
// below 768px. The routes themselves stay public for desktop.

export default function EmployerNav({ inverse = false }: { inverse?: boolean }) {
  const [open, setOpen] = useState(false);
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
        <button className="figma-nav-toggle" type="button" aria-expanded={open} aria-label="Toggle menu" onClick={() => setOpen(v => !v)}>
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open ? (
        <div className={`figma-nav-mobile ${inverse ? "is-inverse" : ""}`}>
          {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
          <Link href="/" onClick={() => setOpen(false)}>For Candidates</Link>
          <Link href="/employers/login" onClick={() => setOpen(false)}>Sign In</Link>
          <Link className="figma-btn figma-btn-orange" href="/employers/post-job" onClick={() => setOpen(false)}>Post a Job</Link>
        </div>
      ) : null}
    </header>
  );
}
