import type { ReactNode } from "react";
import Link from "next/link";

export type IconColor =
  | "purple"
  | "teal"
  | "green"
  | "orange"
  | "pink"
  | "cyan"
  | "olive"
  | "navy"
  | "red";

/**
 * One settings-style row: circular colored icon, title, subtitle, and a
 * trailing chevron/right-side slot. Matches the row pattern used across
 * Figma Mobile v1 screens 14, 15, 16, 17, 19 (and similar).
 */
export default function MobileIconRow({
  icon,
  color,
  title,
  sub,
  href,
  right,
  onClick,
}: {
  icon: string;
  color: IconColor;
  title: string;
  sub?: string;
  href?: string;
  right?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={`m-icon m-icon-circle m-icon-${color}`} aria-hidden="true">
        {icon}
      </span>
      <span className="m-copy">
        <strong>{title}</strong>
        {sub ? <small>{sub}</small> : null}
      </span>
      {right ?? <b className="m-chevron">›</b>}
    </>
  );

  if (href) {
    return (
      <Link className="m-card" href={href}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className="m-card" style={{ width: "100%", textAlign: "left", border: "1px solid var(--m-line)" }} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className="m-card">{content}</div>;
}
