"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared mobile screen chrome — the header, back affordance, title area and
 * bottom navigation used by the candidate app screens. Presentation only:
 * every screen renders real data passed down from a server component that
 * reads through `src/lib/candidate` services.
 */

const MOBILE_NAV = [
  ["05", "⌂", "Home", "/dashboard"],
  ["06", "⌕", "Match", "/jobs"],
  ["10", "▣", "Apps", "/applications"],
  ["11", "♧", "Prep", "/interviews"],
  ["12", "◉", "Profile", "/profile"],
] as const;

export function MobileBottomNav({ active }: { active: string }) {
  return (
    <nav className="m-bottom-nav">
      {MOBILE_NAV.map(([index, icon, label, href]) => (
        <Link
          className={active === index ? "active" : ""}
          href={href}
          key={index}
        >
          <span aria-hidden="true">{icon}</span>
          <small>{label}</small>
        </Link>
      ))}
    </nav>
  );
}

export default function MobileScreen({
  index,
  title,
  eyebrow,
  lead,
  minHeight = 844,
  showBack = true,
  right,
  nav,
  children,
}: {
  index: string;
  /** Display title. Split on "\n" into stacked lines like the Figma screens. */
  title: string;
  /** Small muted eyebrow rendered above the title (Home screen style). */
  eyebrow?: string;
  lead?: string;
  minHeight?: number;
  showBack?: boolean;
  right?: ReactNode;
  nav?: boolean;
  children: ReactNode;
}) {
  const lines = title.split("\n");

  return (
    <main
      className={`odesseus-mobile-only m-screen m-screen-${index}`}
      style={{ minHeight }}
    >
      <header className="m-screen-header">
        {showBack ? (
          <button type="button" onClick={() => history.back()} aria-label="Back">
            ←
          </button>
        ) : null}
        <h1>
          {eyebrow ? <span className="m-eyebrow">{eyebrow}</span> : null}
          {lines.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </h1>
        {right}
      </header>
      {lead ? <p className="m-lead">{lead}</p> : null}
      {children}
      {nav ? <MobileBottomNav active={index} /> : null}
    </main>
  );
}