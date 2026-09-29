"use client";

import { useEffect, useState } from "react";
import JobCarousel from "@/components/job-carousel";
import {
  getHomepageJobsClient,
  withoutMatchScore,
} from "@/lib/jobs/homepage-client";
import type { HomepageJobsResult } from "@/lib/jobs/homepage-types";

/**
 * Client boundary for the homepage job carousel.
 *
 * With `initialResult` (desktop `page.tsx`, a server component): the server
 * already read the real feed, knows the signed-in state, and has stripped
 * `matchScore` for logged-out visitors, so it renders as-is with no loading
 * flash and no second request.
 *
 * Without it (mobile splash, a client-only component): reads the public feed
 * over HTTP and always strips `matchScore` defensively — a browser-side read
 * can't confirm signed-in state, and the rule is to hide personalization
 * whenever that can't be confirmed, never to show it speculatively.
 */
export default function HomepageJobFeed({ initialResult }: { initialResult?: HomepageJobsResult }) {
  const [result, setResult] = useState<HomepageJobsResult | { status: "loading" }>(
    initialResult ?? { status: "loading" }
  );

  useEffect(() => {
    if (initialResult) return;
    let cancelled = false;
    getHomepageJobsClient().then((r) => {
      if (!cancelled) setResult(withoutMatchScore(r));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry() {
    setResult({ status: "loading" });
    if (initialResult !== undefined) {
      // Server-fed: re-render the route so the read happens with a real
      // session, rather than guessing at one from the browser.
      window.location.reload();
      return;
    }
    setResult(withoutMatchScore(await getHomepageJobsClient()));
  }

  return <JobCarousel result={result} onRetry={retry} />;
}
