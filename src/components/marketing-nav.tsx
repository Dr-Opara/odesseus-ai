"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/apply", label: "Apply" },
  { href: "/live", label: "Live" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export default function MarketingNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="marketing-nav">
      <div className="marketing-nav-inner shell">
        <Link href="/" className="marketing-wordmark">ODYSSEUS</Link>

        <nav className="marketing-nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "is-active" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="marketing-nav-actions">
          <Link className="btn btn-secondary" href="/login">Sign In</Link>
          <Link className="btn btn-primary" href="/signup">Get Started →</Link>
        </div>

        <button
          type="button"
          className="marketing-nav-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open ? (
        <div className="marketing-nav-mobile-panel shell">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <div className="marketing-nav-mobile-actions">
            <Link className="btn btn-secondary" href="/login" onClick={() => setOpen(false)}>
              Sign In
            </Link>
            <Link className="btn btn-primary" href="/signup" onClick={() => setOpen(false)}>
              Get Started →
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
