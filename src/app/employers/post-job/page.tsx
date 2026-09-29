import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import PostJobForm from "@/components/employers/post-job-form";
import { getEmployerJobs } from "@/lib/employers/jobs-adapter";
import { getEmployerProfile } from "@/lib/employers/onboarding-adapter";
import { EMPLOYER_PLANS } from "@/lib/pricing/candidate-pricing";

/** Post a Job (Figma screen 75, F13-E). */
export default async function EmployerPostJobPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    redirect("/employers/signup?next=/employers/post-job");
  }

  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/signup?error=Create%20an%20employer%20account%20with%20your%20company%20email%20to%20post%20a%20job.");
  }

  const [jobsResult, profileResult] = await Promise.all([getEmployerJobs(), getEmployerProfile()]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Post a Job</h1>
          <p className="muted">Create a new role.</p>

          {profileResult.status === "ok" && jobsResult.status === "ok" ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge
                capacity={{
                  activeJobCount: jobsResult.data.filter((j) => j.status === "Published").length,
                  planLimit: EMPLOYER_PLANS.find((p) => p.name === profileResult.data.planId)?.activeJobLimit ?? 0,
                  planId: profileResult.data.planId,
                }}
              />
            </div>
          ) : null}

          <PostJobForm />
        </section>
      </div>
    </main>
  );
}
