import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import HomepageBody from "@/components/homepage-body";
import { createClient } from "@/lib/supabase/server";
import { getCandidateUserId } from "@/lib/candidate/service";
import { getHomepageJobsForRequest } from "@/lib/jobs/homepage-server";

export default async function Home() {
  const supabase = await createClient();
  const userId = await getCandidateUserId(supabase);
  // Real home feed (GET /api/jobs/home-feed). A logged-out visitor never sees
  // a Match Score; a signed-in one only ever sees the score the backend
  // actually returned for their own verified data.
  const jobsResult = await getHomepageJobsForRequest(Boolean(userId));

  return (
    <main className="figma-site oh-hero odesseus-desktop-only">
      <div className="figma-page-wrap">
        <MarketingNav />
        <HomepageBody initialJobsResult={jobsResult} />
      </div>
      <MarketingFooter />
    </main>
  );
}
