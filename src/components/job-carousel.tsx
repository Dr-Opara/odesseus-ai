"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HomepageJob, HomepageJobsResult } from "@/lib/jobs/homepage-types";

const DESKTOP_PAGE_SIZE = 3;
const AUTO_ADVANCE_MS = 6000;

function JobCardContent({ job }: { job: HomepageJob }) {
  const badgeLabel =
    typeof job.matchScore === "number" ? `${Math.round(job.matchScore)}% Match` : job.freshnessLabel;

  return (
    <>
      {badgeLabel ? (
        <span className={`oh-job-badge${typeof job.matchScore === "number" ? " is-match" : ""}`}>
          {badgeLabel}
        </span>
      ) : null}
      <div style={{ display: "flex", alignItems: "center" }}>
        <span className="oh-job-logo" aria-hidden="true">
          {job.companyLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.companyLogoUrl} alt="" width={44} height={44} style={{ borderRadius: 10 }} />
          ) : (
            job.company.charAt(0).toUpperCase()
          )}
        </span>
        <span className="oh-job-company">{job.company}</span>
      </div>
      <div className="oh-job-title">{job.title}</div>
      {job.salaryText || job.location || job.workArrangement ? (
        <div className="oh-job-meta">
          {job.salaryText ? <span className="oh-job-salary">{job.salaryText}</span> : null}
          {job.salaryText && (job.location || job.workArrangement) ? " · " : ""}
          {[job.location, job.workArrangement].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {job.tags && job.tags.length > 0 ? (
        <div className="oh-job-tags">
          {job.tags.map((tag) => (
            <span className="oh-job-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function CarouselSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div className="oh-carousel-skeleton" key={i} aria-hidden="true" />
      ))}
    </>
  );
}

function CarouselEmpty({ message }: { message: string }) {
  return (
    <div className="oh-carousel-empty">
      <p>{message}</p>
      <a className="oh-retry-btn" href="/jobs">
        Browse jobs
      </a>
    </div>
  );
}

function CarouselError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="oh-carousel-error">
      <p>We couldn&apos;t load jobs right now.</p>
      <button className="oh-retry-btn" type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/**
 * Homepage job carousel (F1-B/F1-C/F1-F). Data-only props, agnostic to where
 * the jobs came from — it renders whatever the reader returned and never
 * reaches for a data source of its own. Renders both a desktop (paged 3-up,
 * arrows, dots, auto-advance) and mobile (native scroll-snap, dots)
 * presentation; CSS shows only one per viewport.
 */
export default function JobCarousel({
  result,
  onRetry,
}: {
  result: HomepageJobsResult | { status: "loading" };
  onRetry: () => void;
}) {
  const jobs = useMemo(() => (result.status === "ok" ? result.data : []), [result]);
  const [desktopPage, setDesktopPage] = useState(0);
  const [mobileIndex, setMobileIndex] = useState(0);
  const mobileTrackRef = useRef<HTMLDivElement | null>(null);
  const mobileCardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const desktopPageCount = Math.max(1, Math.ceil(jobs.length / DESKTOP_PAGE_SIZE));
  const currentPage = Math.min(desktopPage, desktopPageCount - 1);

  useEffect(() => {
    if (result.status !== "ok" || desktopPageCount <= 1) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = setInterval(() => {
      setDesktopPage((page) => (page + 1) % desktopPageCount);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [result.status, desktopPageCount]);

  useEffect(() => {
    const track = mobileTrackRef.current;
    if (!track) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) return;
        const index = mobileCardRefs.current.findIndex((el) => el === visible.target);
        if (index >= 0) setMobileIndex(index);
      },
      { root: track, threshold: 0.6 }
    );

    mobileCardRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [jobs]);

  const desktopVisible = useMemo(
    () => jobs.slice(currentPage * DESKTOP_PAGE_SIZE, currentPage * DESKTOP_PAGE_SIZE + DESKTOP_PAGE_SIZE),
    [jobs, currentPage]
  );

  if (result.status === "loading") {
    return (
      <div className="oh-carousel">
        <div className="oh-carousel-track odesseus-desktop-only" style={{ display: "grid" }}>
          <CarouselSkeleton count={DESKTOP_PAGE_SIZE} />
        </div>
        <div className="odesseus-mobile-only oh-carousel-skeleton" style={{ margin: "0 18px" }} />
      </div>
    );
  }

  if (result.status === "unavailable") {
    return (
      <div className="oh-carousel">
        <CarouselError onRetry={onRetry} />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="oh-carousel">
        <CarouselEmpty message="No matched roles yet. Check back soon or browse open jobs." />
      </div>
    );
  }

  return (
    <div className="oh-carousel" aria-label="Job listings">
      <div className="oh-carousel-track odesseus-desktop-only" style={{ display: "grid" }}>
        {desktopVisible.map((job) => (
          <a className="oh-job-card" href={job.applyUrl || "/jobs"} key={job.id}>
            <JobCardContent job={job} />
          </a>
        ))}
      </div>
      {desktopPageCount > 1 ? (
        <div className="oh-carousel-controls odesseus-desktop-only" style={{ display: "flex" }}>
          <button
            className="oh-carousel-arrow"
            type="button"
            aria-label="Previous jobs"
            disabled={currentPage === 0}
            onClick={() => setDesktopPage((p) => Math.max(0, p - 1))}
          >
            ‹
          </button>
          <div className="oh-carousel-dots">
            {Array.from({ length: desktopPageCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                className={`oh-carousel-dot${i === currentPage ? " is-active" : ""}`}
                aria-label={`Go to page ${i + 1}`}
                onClick={() => setDesktopPage(i)}
              />
            ))}
          </div>
          <button
            className="oh-carousel-arrow"
            type="button"
            aria-label="Next jobs"
            disabled={currentPage === desktopPageCount - 1}
            onClick={() => setDesktopPage((p) => Math.min(desktopPageCount - 1, p + 1))}
          >
            ›
          </button>
        </div>
      ) : null}

      <div
        className="odesseus-mobile-only m-job-carousel-track"
        ref={mobileTrackRef}
        style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", gap: 12, padding: "0 18px" }}
      >
        {jobs.map((job, i) => (
          <div
            className="oh-job-card"
            key={job.id}
            ref={(el) => {
              mobileCardRefs.current[i] = el;
            }}
            style={{ scrollSnapAlign: "center", minWidth: "78vw", flexShrink: 0 }}
          >
            <a href={job.applyUrl || "/jobs"} style={{ textDecoration: "none", color: "inherit", display: "grid", gap: 10 }}>
              <JobCardContent job={job} />
            </a>
          </div>
        ))}
      </div>
      <div className="oh-carousel-dots odesseus-mobile-only" style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        {jobs.map((job, i) => (
          <span
            key={job.id}
            className={`oh-carousel-dot${i === mobileIndex ? " is-active" : ""}`}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
