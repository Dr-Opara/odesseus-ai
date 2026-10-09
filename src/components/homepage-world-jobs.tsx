"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getHomepageJobsClient,
  withoutMatchScore,
} from "@/lib/jobs/homepage-client";
import CompanyLogo from "@/components/company-logo";
import type { HomepageJob, HomepageJobsResult } from "@/lib/jobs/homepage-types";

const quickLinks = [
  { icon: "⚡", label: "Find jobs" },
  { icon: "▣", label: "Auto apply" },
  { icon: "▥", label: "Interview prep" },
  { icon: "$", label: "Earn while you search" },
];

function JobCard({ job }: { job: HomepageJob }) {
  return (
    <article className="oh-world-job-card">
      <div className="oh-world-job-company-row">
        <CompanyLogo
          company={job.company}
          logoUrl={job.companyLogoUrl ?? null}
          sourceUrl={job.sourceUrl ?? job.applyUrl ?? null}
          className="oh-world-job-logo"
        />
        <strong>{job.company}</strong>
      </div>

      <h3>{job.title}</h3>

      <p>
        {job.location || "Location not listed"}
        {job.workArrangement ? <span> · {job.workArrangement}</span> : null}
      </p>

      <b>{job.salaryText || "Salary not listed"}</b>

      {job.freshnessLabel ? (
        <span className="oh-world-job-freshness">✓ {job.freshnessLabel}</span>
      ) : null}
    </article>
  );
}

export default function HomepageWorldJobs({
  initialResult,
}: {
  initialResult?: HomepageJobsResult;
}) {
  const [result, setResult] = useState<HomepageJobsResult | { status: "loading" }>(
    initialResult ?? { status: "loading" }
  );

  useEffect(() => {
    if (initialResult) return;
    let cancelled = false;
    getHomepageJobsClient().then((next) => {
      if (!cancelled) setResult(withoutMatchScore(next));
    });
    return () => {
      cancelled = true;
    };
  }, [initialResult]);

  const jobs = useMemo(() => {
    if (result.status !== "ok") return [];
    const seen = new Set<string>();
    return result.data
      .filter((job) => {
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}::${job.location || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 18);
  }, [result]);

  return (
    <section className="oh-world-jobs-section" aria-labelledby="oh-world-jobs-heading">
      <div className="oh-world-jobs-quicklinks" aria-label="Odesseus capabilities">
        {quickLinks.map((item) => (
          <div className="oh-world-jobs-quicklink" key={item.label}>
            <span aria-hidden="true">{item.icon}</span>
            <strong>{item.label}</strong>
          </div>
        ))}
      </div>

      <div className="oh-world-jobs-header">
        <div>
          <span className="oh-world-jobs-eyebrow">◉ &nbsp; JOBS AROUND THE WORLD</span>
          <h2 id="oh-world-jobs-heading">
            Explore opportunities from companies and teams hiring across global markets.
          </h2>
        </div>
        <div className="oh-world-jobs-arrows" aria-hidden="true">
          <span>‹</span>
          <span>›</span>
        </div>
      </div>

      {result.status === "loading" ? (
        <div className="oh-world-jobs-loading" aria-label="Loading jobs">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : jobs.length > 0 ? (
        <div className="oh-world-job-marquee">
          <div className="oh-world-job-marquee-track">
            {[0, 1].map((copy) => (
              <div
                className="oh-world-job-marquee-group"
                key={copy}
                aria-hidden={copy === 1 ? "true" : undefined}
              >
                {jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="oh-world-jobs-refreshing">
          Job opportunities are refreshing. Check back shortly.
        </div>
      )}
    </section>
  );
}
