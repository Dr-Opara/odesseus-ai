import Link from "next/link";
import { headers } from "next/headers";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import {
  jobAgeLabel,
  jobSummary,
  searchPublicJobs,
} from "@/lib/jobs/public-search";
import {
  marketForCountry,
  marketFromLocationInput,
} from "@/lib/jobs/location-market";

export const dynamic = "force-dynamic";

function logoUrl(job: { applyUrl: string | null; sourceUrl: string | null }) {
  const candidate = job.applyUrl ?? job.sourceUrl;
  if (!candidate) return null;
  try {
    const domain = new URL(candidate).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  } catch {
    return null;
  }
}

function typeLabel(value: string | null) {
  if (!value) return null;
  const map: Record<string, string> = {
    fulltime: "Full-time",
    parttime: "Part-time",
    contract: "Contract",
    internship: "Internship",
    temporary: "Temporary",
  };
  return map[value] ?? value;
}

export default async function JobSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; location?: string; type?: string }>;
}) {
  const { q = "", location = "", type = "" } = await searchParams;
  const requestHeaders = await headers();
  const visitorCountry = requestHeaders.get("x-vercel-ip-country");
  const inferredMarket = marketForCountry(visitorCountry);
  const typedMarket = marketFromLocationInput(location);
  const activeMarket = location.trim() ? typedMarket : inferredMarket;
  const displayLocation = location.trim() || activeMarket?.label || "";

  const jobs = await searchPublicJobs({
    query: q,
    location: typedMarket ? "" : location,
    market: activeMarket,
    employmentType: type,
    limit: 100,
  });

  return (
    <main className="figma-site jobs-public-page">
      <div className="figma-page-wrap">
        <MarketingNav />

        <section className="public-jobs-hero">
          <div>
            <span className="figma-eyebrow">JOB SEARCH</span>
            <h1>Find your next opportunity</h1>
            <p>
              Browse jobs across industries posted or discovered within the last 30 days.
              Your location is selected automatically, and you can search another market anytime.
            </p>
          </div>
        </section>

        <form className="public-jobs-search" action="/job-search" method="get">
          <label className="public-jobs-search-field public-jobs-search-keyword">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Job title, skill, or company"
              aria-label="Job title, skill, or company"
            />
          </label>

          <label className="public-jobs-search-field">
            <span aria-hidden="true">⌖</span>
            <input
              name="location"
              defaultValue={displayLocation}
              placeholder="Location"
              aria-label="Location"
            />
          </label>

          <select name="type" defaultValue={type} aria-label="Employment type">
            <option value="">All job types</option>
            <option value="Full Time">Full-time</option>
            <option value="Part Time">Part-time</option>
            <option value="Contract">Contract</option>
            <option value="Internship">Internship</option>
            <option value="Temporary">Temporary</option>
          </select>

          <button type="submit">Search</button>
        </form>

        <section className="public-jobs-content">
          <div className="public-jobs-heading-row">
            <div>
              <h2>Latest Jobs</h2>
              <p>
                {jobs.length} role{jobs.length === 1 ? "" : "s"} posted within the last 30 days
                {activeMarket ? ` · Showing ${activeMarket.label}` : ""}
              </p>
            </div>
            {(q || location || type) ? (
              <Link href="/job-search" className="public-jobs-clear">Clear filters</Link>
            ) : null}
          </div>

          {jobs.length ? (
            <div className="public-jobs-grid">
              {jobs.map((job) => {
                const icon = logoUrl(job);
                const applyHref =
                  job.applyUrl ??
                  job.sourceUrl ??
                  (job.provider === "employer" ? "/signup" : "/job-search");
                const isExternal = /^https?:///i.test(applyHref);
                return (
                  <article className="public-job-card" key={job.id}>
                    <div className="public-job-card-top">
                      <span
                        className="public-job-logo"
                        style={icon ? { backgroundImage: `url("${icon}")` } : undefined}
                        aria-hidden="true"
                      >
                        {icon ? null : job.company.charAt(0).toUpperCase()}
                      </span>

                      <div className="public-job-title-block">
                        <h3>{job.title}</h3>
                        <p>{job.company}</p>
                      </div>

                    </div>

                    <div className="public-job-meta">
                      {job.location ? <span>{job.location}</span> : null}
                      {job.workArrangement ? <span>{job.workArrangement}</span> : null}
                      {typeLabel(job.employmentType) ? <span>{typeLabel(job.employmentType)}</span> : null}
                    </div>

                    {job.salaryText ? <div className="public-job-salary">{job.salaryText}</div> : null}

                    <p className="public-job-summary">{jobSummary(job.description)}</p>

                    <div className="public-job-card-footer">
                      <span>{jobAgeLabel(job.postedAt)}</span>
                      <a
                        className="public-job-apply"
                        href={applyHref}
                        {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                      >
                        Apply
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="public-jobs-empty">
              <h2>No recent jobs match those filters.</h2>
              <p>Try a broader keyword, location, or job type.</p>
              <Link href="/job-search">View all recent jobs</Link>
            </div>
          )}
        </section>
      </div>

      <MarketingFooter />
    </main>
  );
}
