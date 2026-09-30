import Link from "next/link";
import HomepageJobFeed from "@/components/homepage-job-feed";
import HomepageFeatureShowcase from "@/components/homepage-feature-showcase";
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
  { value: "7+", label: "Job sources" },
  { value: "Global", label: "Markets" },
  { value: "$0.39", label: "Apply" },
  { value: "Free", label: "Prep" },
];

const trustAvatars = [
  "https://randomuser.me/api/portraits/women/44.jpg",
  "https://randomuser.me/api/portraits/men/32.jpg",
  "https://randomuser.me/api/portraits/women/68.jpg",
  "https://randomuser.me/api/portraits/men/46.jpg",
];

type GlobalCompany = {
  name: string;
  domain: string;
};

const globalCompanies: GlobalCompany[] = [
  { name: "Amazon", domain: "amazon.com" },
  { name: "Microsoft", domain: "microsoft.com" },
  { name: "Google", domain: "google.com" },
  { name: "Apple", domain: "apple.com" },
  { name: "Shopify", domain: "shopify.com" },
  { name: "Mercado Libre", domain: "mercadolibre.com" },
  { name: "Nubank", domain: "nubank.com.br" },
  { name: "SAP", domain: "sap.com" },
  { name: "Siemens", domain: "siemens.com" },
  { name: "Spotify", domain: "spotify.com" },
  { name: "ASML", domain: "asml.com" },
  { name: "Revolut", domain: "revolut.com" },
  { name: "Airbus", domain: "airbus.com" },
  { name: "Canva", domain: "canva.com" },
  { name: "Samsung", domain: "samsung.com" },
  { name: "Sony", domain: "sony.com" },
  { name: "Alibaba", domain: "alibaba.com" },
  { name: "Tencent", domain: "tencent.com" },
  { name: "Grab", domain: "grab.com" },
  { name: "TCS", domain: "tcs.com" },
  { name: "Infosys", domain: "infosys.com" },
  { name: "Flutterwave", domain: "flutterwave.com" },
  { name: "MTN", domain: "mtn.com" },
  { name: "Safaricom", domain: "safaricom.co.ke" },
  { name: "Careem", domain: "careem.com" },
  { name: "Aramco", domain: "aramco.com" },
];

function GlobalCompanyMarquee() {
  return (
    <div className="oh-company-marquee" aria-label="Examples of companies across global markets">
      <div className="oh-company-marquee-track">
        {[0, 1].map((copy) => (
          <div
            className="oh-company-marquee-group"
            key={copy}
            aria-hidden={copy === 1 ? "true" : undefined}
          >
            {globalCompanies.map((company) => (
              <span className="oh-company-chip" key={company.name}>
                <span
                  className="oh-company-logo"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url("https://www.google.com/s2/favicons?domain=${company.domain}&sz=64")`,
                  }}
                />
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
            Odesseus.ai finds high-match roles, shows why they fit, optimizes the resume you already
            have for each job, and lets you choose Apply or Smart Apply to handle supported
            applications. Then it tracks your progress, prepares you with role-specific interview
            practice, and supports you through live interviews and post-interview follow-up.
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
        <div className="oh-trust-intro">
          <div className="oh-trust-avatars" aria-hidden="true">
            {trustAvatars.map((avatar, index) => (
              <span
                key={avatar}
                className="oh-trust-avatar"
                style={{ backgroundImage: `url("${avatar}")`, zIndex: trustAvatars.length - index }}
              />
            ))}
          </div>
          <span className="oh-trust-label">Trusted by job seekers worldwide</span>
        </div>
        <div className="oh-trust-metrics">
          {trustStats.map((stat) => (
            <div className="oh-trust-stat" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
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

      <HomepageFeatureShowcase />

      <div className="oh-logo-strip">
        <span className="oh-logo-strip-label">GLOBAL COMPANIES</span>
        <p className="oh-logo-strip-subtitle">
          Explore opportunities across companies and markets around the world.
        </p>
        <GlobalCompanyMarquee />
        <span className="oh-logo-strip-note">
          Illustrative company list. Job availability varies by source and region.
        </span>
      </div>
    </>
  );
}
