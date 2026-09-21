import Link from "next/link";

export default function OdesseusWordmark({
  href,
  className = "",
  size = "md",
}: {
  href?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const wordmark = (
    <span className={`odesseus-wordmark odesseus-wordmark-${size} ${className}`.trim()} aria-label="Odesseus.ai">
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
