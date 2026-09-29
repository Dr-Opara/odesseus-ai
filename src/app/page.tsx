import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import HomepageBody from "@/components/homepage-body";
import { createClient } from "@/lib/supabase/server";
import { getCandidateUserId } from "@/lib/candidate/service";
import { getHomepageJobs } from "@/lib/jobs/homepage";
import type { HomepageJobsResult } from "@/lib/jobs/homepage-types";

export default async function Home() {
  const supabase = await createClient();
  const userId = await getCandidateUserId(supabase);
  const jobsResult = await getHomepageJobs();
  const visibleResult: HomepageJobsResult =
    !userId && jobsResult.status === "ok"
      ? { ...jobsResult, data: jobsResult.data.map(({ matchScore: _matchScore, ...job }) => job) }
      : jobsResult;

  return (
    <main className="figma-site oh-hero odesseus-desktop-only">
      <div className="figma-page-wrap">
        <MarketingNav />
        <HomepageBody initialJobsResult={visibleResult} />
      </div>
      <MarketingFooter />
    </main>
  );
}
