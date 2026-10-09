import HomepageJobFeed from "@/components/homepage-job-feed";
import HomepageWorldJobs from "@/components/homepage-world-jobs";
import HomepageFeatureShowcase from "@/components/homepage-feature-showcase";
import CompanyLogo from "@/components/company-logo";
import type { HomepageJobsResult } from "@/lib/jobs/homepage-types";

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
                <CompanyLogo
                  company={company.name}
                  sourceUrl={`https://${company.domain}`}
                  className="oh-company-logo"
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
        <div className="oh-hero-copy oh-hero-copy-refresh">
          <div className="oh-hero-kicker">
            <span className="oh-hero-eyebrow oh-hero-eyebrow-pill">
              <span aria-hidden="true">⚡</span>
              AI-POWERED JOB SEARCH
            </span>
            <span className="oh-hero-flow">Find. Match. Optimize. Apply. Prepare.</span>
          </div>
          <h1 className="oh-hero-title-refresh">
            <span>Find Your Next</span>
            <span>
              Opportunity <em>Faster</em>
            </span>
          </h1>
          <p className="oh-hero-description-refresh">
            Odesseus finds matched roles, tailors your resume, auto-applies, helps you prepare for
            interviews, and gives you another way to earn while you search.
          </p>
        </div>

        <HomepageJobFeed initialResult={initialJobsResult} />
      </section>

      <HomepageWorldJobs initialResult={initialJobsResult} />

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
