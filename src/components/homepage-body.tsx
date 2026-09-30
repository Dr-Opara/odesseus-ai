import Link from "next/link";
import HomepageJobFeed from "@/components/homepage-job-feed";
import {
  APPLY_TIERS,
  FAILED_SUBMISSION_LABEL,
  FAILED_SUBMISSION_PRICE_LABEL,
  PREP_AGENT_LABEL,
  PREP_AGENT_PRICE_LABEL,
} from "@/lib/pricing/candidate-pricing";
import type { HomepageJobsResult } from "@/lib/jobs/homepage-types";

const capabilityTiles = [
  { icon: "▣", label: APPLY_TIERS.standard.label, value: APPLY_TIERS.standard.priceLabel },
  { icon: "⚡", label: APPLY_TIERS.smart.label, value: APPLY_TIERS.smart.priceLabel },
  { icon: "◇", label: PREP_AGENT_LABEL, value: PREP_AGENT_PRICE_LABEL },
  { icon: "♧", label: FAILED_SUBMISSION_LABEL, value: FAILED_SUBMISSION_PRICE_LABEL },
];

const trustStats = [
  { value: "Verified", label: "Employer profiles" },
  { value: "AI-Matched", label: "Role recommendations" },
  { value: "Wallet-based", label: "Pay only on success" },
  { value: "Free", label: "Interview preparation" },
];

type GlobalCompany = {
  name: string;
  country: string;
};

const globalCompaniesTop: GlobalCompany[] = [
  { name: "Amazon", country: "🇺🇸" },
  { name: "Microsoft", country: "🇺🇸" },
  { name: "Google", country: "🇺🇸" },
  { name: "NVIDIA", country: "🇺🇸" },
  { name: "Shopify", country: "🇨🇦" },
  { name: "Mercado Libre", country: "🇦🇷" },
  { name: "Nubank", country: "🇧🇷" },
  { name: "SAP", country: "🇩🇪" },
  { name: "Siemens", country: "🇩🇪" },
  { name: "Spotify", country: "🇸🇪" },
  { name: "Klarna", country: "🇸🇪" },
  { name: "ASML", country: "🇳🇱" },
  { name: "Booking.com", country: "🇳🇱" },
  { name: "Revolut", country: "🇬🇧" },
  { name: "Wise", country: "🇬🇧" },
  { name: "Airbus", country: "🇫🇷" },
  { name: "Atlassian", country: "🇦🇺" },
  { name: "Canva", country: "🇦🇺" },
];

const globalCompaniesBottom: GlobalCompany[] = [
  { name: "Samsung", country: "🇰🇷" },
  { name: "Sony", country: "🇯🇵" },
  { name: "Rakuten", country: "🇯🇵" },
  { name: "Alibaba", country: "🇨🇳" },
  { name: "Tencent", country: "🇨🇳" },
  { name: "ByteDance", country: "🇨🇳" },
  { name: "Grab", country: "🇸🇬" },
  { name: "Sea", country: "🇸🇬" },
  { name: "TCS", country: "🇮🇳" },
  { name: "Infosys", country: "🇮🇳" },
  { name: "Flutterwave", country: "🇳🇬" },
  { name: "MTN", country: "🇿🇦" },
  { name: "Safaricom", country: "🇰🇪" },
  { name: "Naspers", country: "🇿🇦" },
  { name: "Careem", country: "🇦🇪" },
  { name: "Emirates Group", country: "🇦🇪" },
  { name: "Aramco", country: "🇸🇦" },
  { name: "Noon", country: "🇦🇪" },
];

function CompanyMarqueeLane({
  companies,
  direction,
}: {
  companies: GlobalCompany[];
  direction: "left" | "right";
}) {
  return (
    <div className="oh-company-marquee" data-direction={direction}>
      <div className="oh-company-marquee-track">
        {[0, 1].map((copy) => (
          <div
            className="oh-company-marquee-group"
            key={copy}
            aria-hidden={copy === 1 ? "true" : undefined}
          >
            {companies.map((company) => (
              <span className="oh-company-chip" key={company.name}>
                <span className="oh-company-country" aria-hidden="true">
                  {company.country}
                </span>
                <strong>{company.name}</strong>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Shared homepage body (Figma screen 01 — Homepage): hero copy, employer CTA,
 * job carousel, trust band, capability tiles, global-company marquee. Used by
 * both the desktop landing (`src/app/page.tsx`, server-fed via
 * `initialJobsResult`) and the mobile splash (`mobile-splash.tsx`, which lets
 * `HomepageJobFeed` self-fetch client-side). Only nav chrome and page
 * container differ between the two.
 */
export default function HomepageBody({ initialJobsResult }: { initialJobsResult?: HomepageJobsResult }) {
  return (
    <>
      <section className="oh-hero-grid">
        <div className="oh-hero-copy">
          <span className="oh-hero-eyebrow">A smarter way to get hired</span>
          <h1>
            Discover Your
            <br />
            Dream Job with
            <br />
            <em>Odesseus.ai</em>
          </h1>
          <p>
            Find matched roles, optimize the resume you already have, choose Apply or Smart Apply,
            track applications, and prepare for interviews.
          </p>
          <Link className="oh-employer-cta" href="/employers">
            <span className="oh-employer-cta-icon" aria-hidden="true">
              ✥
            </span>
            <strong>Hiring talent?</strong>
            <span>Find matched candidates with Odesseus →</span>
          </Link>
        </div>

        <HomepageJobFeed initialResult={initialJobsResult} />
      </section>

      <div className="oh-trust-band">
        <span className="oh-trust-label">Built for job seekers worldwide</span>
        {trustStats.map((stat) => (
          <div className="oh-trust-stat" key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>

      <div className="oh-capability-tiles">
        {capabilityTiles.map((tile) => (
          <div className="oh-capability-tile" key={tile.label}>
            <span className="oh-capability-tile-icon" aria-hidden="true">
              {tile.icon}
            </span>
            <strong>{tile.label}</strong>
            <span>{tile.value}</span>
          </div>
        ))}
      </div>

      <div className="oh-logo-strip">
        <span className="oh-logo-strip-label">EXPLORE OPPORTUNITIES WORLDWIDE</span>
        <p className="oh-logo-strip-subtitle">
          A global view of leading employers across North America, Latin America, Europe, Africa,
          the Middle East, Asia, and Australia.
        </p>
        <div className="oh-company-marquee-stack" aria-label="Examples of global employers">
          <CompanyMarqueeLane companies={globalCompaniesTop} direction="left" />
          <CompanyMarqueeLane companies={globalCompaniesBottom} direction="right" />
        </div>
        <span className="oh-logo-strip-note">
          Company names are illustrative; live job availability varies by source and region.
        </span>
      </div>
    </>
  );
}
