import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MobileReportJob from "@/components/mobile/mobile-report-job";

export default async function ReportJobPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job: jobId } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  let roleTitle = "This job";
  let companyName = "";

  if (jobId) {
    const { data: job } = await supabase
      .from("job_opportunities")
      .select("role_title,company_name")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (job) {
      roleTitle = job.role_title;
      companyName = job.company_name;
    }
  }

  return <MobileReportJob roleTitle={roleTitle} companyName={companyName} />;
}
