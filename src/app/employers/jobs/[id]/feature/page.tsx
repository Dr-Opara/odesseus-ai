import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import FeatureJobForm from "@/components/employers/feature-job-form";
import { getEmployerJob } from "@/lib/employers/jobs-adapter";
import { getFeaturedJobPackages } from "@/lib/employers/featured-adapter";

/** Job Add-ons / Featured Jobs purchase (Figma screen 83, F13-O). */
export default async function EmployerFeatureJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireEmployerPage(`/employers/jobs/${id}/feature`);

  const jobResult = await getEmployerJob(orgId, id);
  const packages = getFeaturedJobPackages();

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(900px,100%)", margin: "54px auto 90px" }}>
          <h1>Job Add-ons</h1>
          <p className="muted">Promote a specific job post.</p>

          {jobResult.status === "ok" ? (
            <FeatureJobForm
              orgId={orgId}
              jobId={jobResult.data.id}
              jobTitle={jobResult.data.title}
              packages={packages}
              alreadyFeatured={Boolean(jobResult.data.featured)}
            />
          ) : (
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel kind="error" title="We couldn't load this job" message={jobResult.reason} actionHref="/employers/jobs" actionLabel="Back to Jobs" />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
