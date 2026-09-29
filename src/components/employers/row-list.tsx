import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared "label above value, chevron if linked" row — the pattern Figma
 * reuses across the dashboard, jobs list, job detail, and onboarding
 * screens. `href` makes the row a link with a trailing chevron; omit it for
 * a plain display row.
 */
export function EmployerRow({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  const content = (
    <>
      <span className="emp-row-label">{label}</span>
      <span className="emp-row-value">{value}</span>
      {href ? (
        <span className="emp-row-chevron" aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="emp-row is-link">
        {content}
      </Link>
    );
  }
  return <div className="emp-row">{content}</div>;
}

export function EmployerRowList({ children }: { children: ReactNode }) {
  return <div className="emp-row-list">{children}</div>;
}
