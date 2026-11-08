import Link from "next/link";

const socialIcons = [
  { label: "X", slug: "x", href: "https://x.com/odesseusai" },
  { label: "Instagram", slug: "instagram", href: "https://instagram.com/odesseus.ai" },
  { label: "TikTok", slug: "tiktok", href: "https://www.tiktok.com/@odesseus_ai" },
] as const;

const technologyBrands = [
  { label: "OpenAI", slug: "openai" },
  { label: "Supabase", slug: "supabase" },
  { label: "Vercel", slug: "vercel" },
  { label: "Stripe", slug: "stripe" },
] as const;

function BrandIcon({ slug, label }: { slug: string; label: string }) {
  return (
    <span
      className="figma-footer-brand-icon"
      aria-hidden="true"
      title={label}
      style={{
        backgroundImage: `url("https://cdn.simpleicons.org/${slug}/FFFFFF")`,
      }}
    />
  );
}

export default function MarketingFooter() {
  return (
    <footer className="figma-footer">
      <div className="figma-footer-grid figma-footer-grid-expanded">
        <div>
          <strong>Job Seekers</strong>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/agents">Agents</Link>
          <Link href="/first-100">First 100</Link>
        </div>

        <div>
          <strong>Employers</strong>
          <Link href="/employers">For Employers</Link>
          <Link href="/employers#pricing">Employer Pricing</Link>
        </div>

        <div>
          <strong>Company</strong>
          <Link href="/about">About</Link>
          <Link href="/careers">Careers</Link>
          <Link href="/partners">Partner Program</Link>
          <Link href="/about#faq">FAQ</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms and Conditions</Link>
        </div>

        <div className="figma-footer-locations">
          <strong>Location</strong>
          <div className="figma-footer-location">
            <small>Headquarters</small>
            <span>Austin, Texas</span>
          </div>
          <div className="figma-footer-location">
            <small>Serving job seekers worldwide</small>
            <span>Built in the U.S. for careers everywhere.</span>
          </div>
        </div>

        <div className="figma-footer-list-column">
          <strong>Social</strong>
          {socialIcons.map((item) => (
            <a
              className="figma-footer-logo-link"
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              key={item.label}
            >
              <BrandIcon slug={item.slug} label={item.label} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>

        <div className="figma-footer-list-column">
          <strong>Technology ecosystem</strong>
          {technologyBrands.map((item) => (
            <span className="figma-footer-logo-link" key={item.label}>
              <BrandIcon slug={item.slug} label={item.label} />
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="figma-footer-legal">
        <p>
          The names and logos of companies referenced on Odesseus.ai are trademarks of their
          respective owners. Unless explicitly stated, these references do not indicate endorsement,
          sponsorship, partnership, or affiliation with Odesseus.ai.
        </p>
        <p>
          By continuing to use this website, you agree to the{" "}
          <Link href="/terms" className="figma-footer-legal-link">
            Terms and Conditions
          </Link>{" "}
          and acknowledge the{" "}
          <Link href="/privacy" className="figma-footer-legal-link">
            Privacy Policy
          </Link>
          .
        </p>
        <p className="figma-footer-copyright">
          &copy; 2026 Odesseus.ai. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
