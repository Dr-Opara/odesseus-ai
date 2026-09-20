import Image from "next/image";
import Link from "next/link";

export default function BrandLogo({
  href = "/",
  width = 176,
  priority = false,
  className,
}: {
  href?: string;
  width?: number;
  priority?: boolean;
  className?: string;
}) {
  const height = Math.round((width * 260) / 1200);

  return (
    <Link
      href={href}
      className={className}
      aria-label="Odesseus.ai home"
      style={{ display: "inline-flex", alignItems: "center", lineHeight: 0 }}
    >
      <Image
        src="/brand/odysseus-wordmark.svg"
        alt="Odesseus.ai"
        width={width}
        height={height}
        priority={priority}
        style={{ width, height: "auto", display: "block" }}
      />
    </Link>
  );
}
