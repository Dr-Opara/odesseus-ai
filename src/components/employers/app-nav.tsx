"use client";

import { useState } from "react";
import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import { employerLogout } from "@/app/employers/actions";

// Canonical employer routes. The employer portal is one app with one path per
// feature, so these are the `/employers/dashboard/*` locations the backend
// owns rather than a parallel set — two live pages for one feature is how a
// surface ends up showing stale data on whichever link someone kept.
const links = [
  { href: "/employers/dashboard", label: "Dashboard" },
  { href: "/employers/dashboard/jobs", label: "Jobs" },
  { href: "/employers/candidates", label: "Applicants" },
  { href: "/employers/pipeline", label: "Pipeline" },
  { href: "/employers/analytics", label: "Analytics" },
  { href: "/employers/dashboard/team", label: "Team" },
  { href: "/employers/dashboard/billing", label: "Billing" },
  { href: "/employers/notifications", label: "Notifications" },
  { href: "/employers/company", label: "Company Profile" },
];

/**
 * Minimal authenticated employer app header (Figma screen 85 and beyond) —
 * distinct from the public marketing `EmployerNav` (which shows "Sign In" /
 * a "Post a Job" marketing CTA and is desktop-only). This is the header for
 * screens an employer only sees once signed in. Reuses the same
 * toggle/`.figma-nav-mobile` pattern as `MarketingNav`/`EmployerNav` — below
 * 900px the shared globals.css rule hides `.figma-nav-links` and expects a
 * toggle button to reveal a mobile menu; without one, these links would be
 * completely unreachable on phone widths.
 */
export default function EmployerAppNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="figma-nav emp-app-nav">
      <div className="figma-nav-inner">
        <OdesseusWordmark href="/employers/dashboard" size="sm" />
        <nav className="figma-nav-links" aria-label="Employer">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="figma-nav-actions">
          <Link className="figma-btn figma-btn-orange" href="/employers/post-job">
            Post a Job
          </Link>
          <form action={employerLogout}>
            <button className="figma-text-link employer-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
        <button className="figma-nav-toggle" type="button" aria-expanded={open} aria-label="Toggle menu" onClick={() => setOpen((v) => !v)}>
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open ? (
        <div className="figma-nav-mobile">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link className="figma-btn figma-btn-orange" href="/employers/post-job" onClick={() => setOpen(false)}>
            Post a Job
          </Link>
          <form action={employerLogout}>
            <button className="figma-text-link employer-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </header>
  );
}
