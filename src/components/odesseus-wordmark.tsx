import Link from "next/link";

export default function OdesseusWordmark({
  href,
  className = "",
  size = "md",
  inverse = false,
}: {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  inverse?: boolean;
}) {
  const wordmark = (
    <span className={`odesseus-brand-lockup odesseus-wordmark-${size} ${inverse ? "is-inverse" : ""} ${className}`.trim()} aria-label="Odesseus.ai">
      <span className="odesseus-o-icon" aria-hidden="true"><span>O</span></span>
      <span className="odesseus-wordmark-name">Odesseus</span>
      <span className="odesseus-wordmark-ai">.ai</span>
    </span>
  );

  return href ? (
    <Link href={href} className="odesseus-wordmark-link" aria-label="Odesseus.ai">
      {wordmark}
    </Link>
  ) : wordmark;
}
