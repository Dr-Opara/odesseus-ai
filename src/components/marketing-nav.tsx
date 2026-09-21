"use client";

import { useState } from "react";
import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import { usePathname } from "next/navigation";

const links = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/apply", label: "Apply" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

const agents = [
  { href: "/agents#match-agent", label: "Job Match & Qualification Agent", note: "Qualify the role and improve your existing resume." },
  { href: "/agents#application-agent", label: "Application Agent", note: "Apply only after you approve the resume." },
  { href: "/agents#interview-agent", label: "Interview Agent", note: "Prepare first, then start Odesseus Live." },
];

export default function MarketingNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="marketing-nav">
      <div className="marketing-nav-inner shell">
        <OdesseusWordmark href="/" size="sm" className="marketing-wordmark" />

        <nav className="marketing-nav-links">
          {links.slice(0, 2).map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "is-active" : undefined}>
              {link.label}
            </Link>
          ))}

          <details className="marketing-agents-menu">
            <summary className={pathname === "/agents" ? "is-active" : undefined}>Agents <span aria-hidden="true">⌄</span></summary>
            <div className="marketing-agents-dropdown">
              {agents.map((agent) => (
                <Link key={agent.href} href={agent.href}>
                  <strong>{agent.label}</strong>
                  <span>{agent.note}</span>
                </Link>
              ))}
            </div>
          </details>

          {links.slice(2).map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "is-active" : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="marketing-nav-actions">
          <Link className="btn btn-secondary" href="/login">Sign In</Link>
          {pathname === "/" ? <Link className="btn btn-primary" href="/signup">Get Started →</Link> : null}
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
          <Link href="/how-it-works" onClick={() => setOpen(false)}>How It Works</Link>
          <Link href="/apply" onClick={() => setOpen(false)}>Apply</Link>
          <div className="marketing-nav-mobile-group">
            <Link href="/agents" onClick={() => setOpen(false)}>Agents</Link>
            {agents.map((agent) => (
              <Link className="marketing-nav-mobile-agent" key={agent.href} href={agent.href} onClick={() => setOpen(false)}>
                {agent.label}
              </Link>
            ))}
          </div>
          <Link href="/pricing" onClick={() => setOpen(false)}>Pricing</Link>
          <Link href="/about" onClick={() => setOpen(false)}>About</Link>
          <div className="marketing-nav-mobile-actions">
            <Link className="btn btn-secondary" href="/login" onClick={() => setOpen(false)}>Sign In</Link>
            {pathname === "/" ? (
              <Link className="btn btn-primary" href="/signup" onClick={() => setOpen(false)}>Get Started →</Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
