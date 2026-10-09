"use client";

import { useMemo } from "react";
import CompanyLogo from "@/components/company-logo";
import type { HomepageJob, HomepageJobsResult } from "@/lib/jobs/homepage-types";

function ProductPreview({ job }: { job: HomepageJob }) {
  const match =
    typeof job.matchScore === "number" ? `${Math.round(job.matchScore)}% Match` : null;

  return (
    <div className="oh-product-preview" aria-label="Odesseus product preview">
      <div className="oh-product-glow" aria-hidden="true" />

      <div className="oh-product-shell">
        <aside className="oh-product-sidebar" aria-hidden="true">
          <span className="oh-product-brand-mark">O</span>
          <span>☆</span>
          <span>⌂</span>
          <span>▱</span>
          <span>♙</span>
          <span>▣</span>
        </aside>

        <div className="oh-product-main">
          <div className="oh-product-search">⌕&nbsp;&nbsp; Find your next opportunity...</div>

          <div className="oh-product-job-card">
            <div className="oh-product-job-heading">
              <CompanyLogo
                company={job.company}
                logoUrl={job.companyLogoUrl ?? null}
                sourceUrl={job.sourceUrl ?? job.applyUrl ?? null}
                className="oh-product-job-logo"
                eager
              />
              <div>
                <strong>{job.title}</strong>
                <span>{job.company}</span>
                <small>
                  {[job.location, job.workArrangement].filter(Boolean).join(" · ") || "Opportunity"}
                </small>
              </div>
              {match ? <b>{match}</b> : null}
            </div>

            <div className="oh-product-job-salary">
              {job.salaryText || "Salary listed in job details"}
            </div>

            <div className="oh-product-job-tags">
              {job.workArrangement ? <span>{job.workArrangement}</span> : null}
              <span>{job.freshnessLabel || "Active"}</span>
            </div>

            <div className="oh-product-job-actions">
              <span className="is-primary">Apply with Odesseus</span>
              <span>View Details</span>
            </div>
          </div>
        </div>
      </div>

      <div className="oh-product-status-card" aria-hidden="true">
        <div>
          <span className="is-orange">▤</span>
          <strong>Resume Optimized</strong>
        </div>
        <div>
          <span className="is-red">✓</span>
          <strong>Application Submitted</strong>
        </div>
        <div>
          <span className="is-pink">✧</span>
          <strong>Interview Prep Ready</strong>
        </div>
      </div>

      <div className="oh-product-live-pill" aria-hidden="true">
        <span className="oh-product-live-orb">O</span>
        <div>
          <strong>Interview support</strong>
          <small>
            Get interview support
            <br />
            and earn while you search.
          </small>
        </div>
        <b>›</b>
      </div>
    </div>
  );
}

function ProductPreviewLoading() {
  return (
    <div className="oh-product-preview is-loading" aria-label="Loading Odesseus preview">
      <div className="oh-product-glow" />
      <div className="oh-product-shell">
        <div className="oh-product-loading-card" />
      </div>
    </div>
  );
}

export default function JobCarousel({
  result,
  onRetry,
}: {
  result: HomepageJobsResult | { status: "loading" };
  onRetry: () => void;
}) {
  const job = useMemo(
    () => (result.status === "ok" && result.data.length > 0 ? result.data[0] : null),
    [result]
  );

  if (result.status === "loading") return <ProductPreviewLoading />;

  if (result.status === "unavailable") {
    return (
      <div className="oh-product-preview-state">
        <strong>Jobs are refreshing.</strong>
        <span>The homepage is ready, but the current feed could not be loaded.</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="oh-product-preview-state">
        <strong>New opportunities are on the way.</strong>
        <span>Odesseus will surface a live role here as soon as the feed refreshes.</span>
        <a href="/jobs">Browse jobs</a>
      </div>
    );
  }

  return <ProductPreview job={job} />;
}
