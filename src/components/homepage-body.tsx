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

const topCompanies = ["amazon", "Microsoft", "Google", "NVIDIA", "Meta"];

/**
 * Shared homepage body (Figma screen 01 — Homepage): hero copy, employer CTA,
 * job carousel, trust band, capability tiles, top-companies strip. Used by
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
        <span className="oh-logo-strip-label">GET HIRED AT TOP COMPANIES</span>
        <div className="oh-logo-strip-row">
          {topCompanies.map((company) => (
            <span key={company}>{company}</span>
          ))}
        </div>
      </div>
    </>
  );
}
