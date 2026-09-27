"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Employer portal mobile shell (Phase 5).
 *
 * Employer accounts are created on desktop/web only, so the phone flow starts
 * at Business Login and lands here. This shell exists because the employer
 * marketing header (`employer-nav.tsx`) is `odesseus-desktop-only` and has no
 * hamburger — deliberately, so an employer menu can never appear on a phone
 * and never become a place to hide an entry the employer should not see.
 *
 * What is reachable from a phone, and why:
 *  - the overview (active jobs, counts, account details) is read-only and safe;
 *  - team and billing are read-only views of what the organization already has;
 *  - job creation, job editing, seat administration, subscription changes and
 *    featured purchases are desktop-only, and the shell says so rather than
 *    showing a button that silently does nothing.
 *
 * Odesseus Live is a candidate product. It is never linked, priced, or
 * mentioned here — see `tests/unit/employer-portal-ui.test.ts`.
 */

const EMPLOYER_NAV = [
  ["Overview", "/employers/dashboard"],
  ["Jobs", "/employers/dashboard/jobs"],
  ["Team", "/employers/dashboard/team"],
  ["Billing", "/employers/dashboard/billing"],
] as const;

export function EmployerMobileNav({ active }: { active: string }) {
  return (
    <nav className="m-bottom-nav employer-m-bottom-nav" aria-label="Employer portal">
      {EMPLOYER_NAV.map(([label, href]) => (
        <Link
          className={active === label ? "active" : ""}
          href={href}
          key={href}
          aria-current={active === label ? "page" : undefined}
        >
          <span aria-hidden="true">{label.slice(0, 1)}</span>
          <small>{label}</small>
        </Link>
      ))}
    </nav>
  );
}

/**
 * Shared chrome for every phone-width employer screen: a plain brand bar with
 * the organization name, the screen title, and the content well.
 */
export default function EmployerMobileScreen({
  orgName,
  title,
  eyebrow,
  lead,
  active,
  backHref,
  children,
}: {
  orgName: string | null;
  title: string;
  eyebrow?: string;
  lead?: string;
  active: string;
  /** When set, shows a back affordance to this href instead of a history back. */
  backHref?: string;
  children: ReactNode;
}) {
  return (
    <main className="odesseus-mobile-only m-screen employer-m-screen">
      <header className="m-screen-header employer-m-header">
        {backHref ? (
          <Link href={backHref} aria-label="Back" className="employer-m-back">
            ←
          </Link>
        ) : null}
        <h1>
          {eyebrow ? <span className="m-eyebrow">{eyebrow}</span> : null}
          <span>{title}</span>
        </h1>
      </header>
      <p className="employer-m-org">
        {orgName ? `Signed in to ${orgName}` : "Signed in to your employer account"}
      </p>
      {lead ? <p className="m-lead">{lead}</p> : null}
      {children}
      <EmployerMobileNav active={active} />
    </main>
  );
}

/**
 * The one honest note the phone portal needs: employer administration happens
 * on a desktop browser. It is deliberately explicit, because an employer on a
 * phone needs to know the action is not missing — it is somewhere else.
 */
export function EmployerDesktopOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="m-note employer-m-desktop-note">
      <strong>Manage this on a desktop browser.</strong>
      <p style={{ margin: "4px 0 0" }}>{children}</p>
    </div>
  );
}
