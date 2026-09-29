"use client";

import { useEffect, useState } from "react";
import JobCarousel from "@/components/job-carousel";
import { getHomepageJobs } from "@/lib/jobs/homepage";
import type { HomepageJobsResult } from "@/lib/jobs/homepage-types";

function stripMatchScore(result: HomepageJobsResult): HomepageJobsResult {
  if (result.status !== "ok") return result;
  return { ...result, data: result.data.map(({ matchScore: _matchScore, ...job }) => job) };
}

/**
 * Client boundary for the homepage job carousel.
 *
 * With `initialResult` (desktop `page.tsx`, a server component): the server
 * already knows the signed-in state and has stripped `matchScore` for logged
 * -out visitors, so it's rendered as-is with no loading flash.
 *
 * Without it (mobile splash, a client-only component): fetches on mount and
 * always strips `matchScore` defensively — client-only rendering can't
 * confirm signed-in state, and F1-C's rule is to hide personalization
 * whenever that can't be confirmed, never to show it speculatively.
 */
export default function HomepageJobFeed({ initialResult }: { initialResult?: HomepageJobsResult }) {
  const [result, setResult] = useState<HomepageJobsResult | { status: "loading" }>(
    initialResult ?? { status: "loading" }
  );

  useEffect(() => {
    if (initialResult) return;
    let cancelled = false;
    getHomepageJobs().then((r) => {
      if (!cancelled) setResult(stripMatchScore(r));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry() {
    setResult({ status: "loading" });
    const r = await getHomepageJobs();
    setResult(initialResult !== undefined ? r : stripMatchScore(r));
  }

  return <JobCarousel result={result} onRetry={retry} />;
}
