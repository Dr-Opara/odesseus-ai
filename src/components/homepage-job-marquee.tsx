"use client";

import { useEffect, useMemo, useState } from "react";
import { getHomepageJobsClient, withoutMatchScore } from "@/lib/jobs/homepage-client";
import type { HomepageJob, HomepageJobsResult } from "@/lib/jobs/homepage-types";

function JobLogo({ job }: { job: HomepageJob }) {
  const initial = job.company.trim().charAt(0).toUpperCase() || "O";
  return (
    <span
      className="oh-marquee-job-logo"
      aria-hidden="true"
      style={job.companyLogoUrl ? { backgroundImage: `url("${job.companyLogoUrl}")` } : undefined}
    >
      {job.companyLogoUrl ? null : initial}
    </span>
  );
}

function JobCard({ job }: { job: HomepageJob }) {
  return (
    <article className="oh-marquee-job-card">
      <div className="oh-marquee-job-company">
        <JobLogo job={job} />
        <div>
          <strong>{job.company}</strong>
          {job.freshnessLabel ? <small>{job.freshnessLabel}</small> : null}
        </div>
      </div>
      <h3>{job.title}</h3>
      <p>
        {job.location || "Location not listed"}
        {job.workArrangement ? <span> · {job.workArrangement}</span> : null}
      </p>
      <b>{job.salaryText || "Salary not listed"}</b>
    </article>
  );
}

export default function HomepageJobMarquee({
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
    return result.data.filter((job) => {
      const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}::${job.location || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 18);
  }, [result]);

  return (
    <section className="oh-world-jobs" aria-labelledby="world-jobs-heading">
      <div className="oh-world-jobs-heading">
        <div>
          <span>◉ &nbsp; JOBS AROUND THE WORLD</span>
          <h2 id="world-jobs-heading">
            Explore opportunities from companies and teams hiring across global markets.
          </h2>
        </div>
      </div>

      {result.status === "loading" ? (
        <div className="oh-marquee-job-loading" aria-label="Loading jobs">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : jobs.length > 0 ? (
        <div className="oh-job-marquee">
          <div className="oh-job-marquee-track">
            {[0, 1].map((copy) => (
              <div
                className="oh-job-marquee-group"
                key={copy}
                aria-hidden={copy === 1 ? "true" : undefined}
              >
                {jobs.map((job) => (
                  <JobCard job={job} key={job.id} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="oh-world-jobs-unavailable">
          <strong>More opportunities are on the way.</strong>
          <span>We could not load the live job feed right now.</span>
        </div>
      )}
    </section>
  );
}
