import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import FeatureJobForm from "@/components/employers/feature-job-form";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import { getFeaturedJobPackages } from "@/lib/employers/featured-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";

/**
 * Job Add-ons / Featured Jobs purchase (Figma screen 83, F13-O).
 *
 * The three packages and their prices are approved commercial data read from
 * the billing catalog, not a fixture. The purchase itself is a Stripe checkout
 * the org's featured route creates; nothing here marks the job featured.
 */
export default async function EmployerFeatureJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [jobResult, orgId] = await Promise.all([getEmployerJob(id), getEmployerOrgId()]);
  const packages = getFeaturedJobPackages();

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(900px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">JOBS</span>
          <h1>Job Add-ons</h1>
          <p className="muted">Promote a specific job post.</p>

          {jobResult.status === "ok" ? (
            <FeatureJobForm
              orgId={orgId ?? ""}
              jobId={jobResult.data.id}
              jobTitle={jobResult.data.title}
              jobStatus={jobResult.data.status}
              packages={packages}
              alreadyFeatured={jobResult.data.featured}
            />
          ) : (
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="This job isn't available"
                message={jobResult.reason}
                actionHref="/employers/dashboard/jobs"
                actionLabel="Back to Jobs"
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
