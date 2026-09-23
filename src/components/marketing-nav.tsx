"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import OdesseusWordmark from "@/components/odesseus-wordmark";

const links = [
  { href: "/how-it-works", label: "Job Seekers" },
  { href: "/employers", label: "Employers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export default function MarketingNav({ inverse = false }: { inverse?: boolean }) {
  const [open, setOpen] = useState(false);
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
        <button className="figma-nav-toggle" type="button" aria-expanded={open} aria-label="Toggle menu" onClick={() => setOpen(v => !v)}>
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open ? (
        <div className={`figma-nav-mobile ${inverse ? "is-inverse" : ""}`}>
          {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
          <Link href="/about#faq" onClick={() => setOpen(false)}>FAQ</Link>
          <Link href="/login" onClick={() => setOpen(false)}>Sign In</Link>
          <Link className="figma-btn figma-btn-orange" href="/signup" onClick={() => setOpen(false)}>Get Started</Link>
        </div>
      ) : null}
    </header>
  );
}
