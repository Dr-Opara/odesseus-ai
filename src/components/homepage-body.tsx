import Link from "next/link";
import HomepageFeatureShowcase from "@/components/homepage-feature-showcase";
import HomepageHeroProductVisual from "@/components/homepage-hero-product-visual";
import HomepageJobMarquee from "@/components/homepage-job-marquee";
import type { HomepageJobsResult } from "@/lib/jobs/homepage-types";

const journeyLinks = [
  { icon: "↗", label: "Find jobs" },
  { icon: "▣", label: "Smart Apply" },
  { icon: "▥", label: "Interview prep" },
  { icon: "$", label: "Earn with Odesseus Live" },
];

export default function HomepageBody({ initialJobsResult }: { initialJobsResult?: HomepageJobsResult }) {
  return (
    <>
      <section className="oh-hero-grid oh-hero-grid-v2">
        <div className="oh-hero-copy oh-hero-copy-v2">
          <span className="oh-hero-eyebrow oh-hero-eyebrow-pill">✦ &nbsp; AI-POWERED JOB SEARCH</span>
          <h1>
            Find Your Next
            <br />
            Opportunity <em>Faster</em>
          </h1>
          <p>
            Odesseus finds matched roles, optimizes the resume you already have, can Smart Apply to
            supported roles, helps you prepare for interviews, and gives eligible applicants another
            way to earn while they search.
          </p>

          <div className="oh-hero-actions">
            <Link className="oh-hero-primary-cta" href="/signup">
              Get Started <span aria-hidden="true">→</span>
            </Link>
            <Link className="oh-hero-secondary-cta" href="/how-it-works">
              See how it works
            </Link>
          </div>

          <div className="oh-journey-links" aria-label="Odesseus capabilities">
            {journeyLinks.map((item) => (
              <div key={item.label}>
                <span aria-hidden="true">{item.icon}</span>
                <strong>{item.label}</strong>
              </div>
            ))}
          </div>
        </div>

        <HomepageHeroProductVisual />
      </section>

      <HomepageJobMarquee initialResult={initialJobsResult} />

      <HomepageFeatureShowcase />

      <section className="oh-employer-band-v2">
        <div>
          <span>HIRING WITH ODESSEUS</span>
          <h2>Hiring talent?</h2>
          <p>
            Employers can publish jobs, review matched candidates, use evidence-backed Fit Scores,
            and manage hiring pipelines in one place.
          </p>
        </div>
        <Link href="/employers">Explore Employer Tools →</Link>
      </section>
    </>
  );
}
