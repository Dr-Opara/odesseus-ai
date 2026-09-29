import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import { getEmployerJobs, getEmployerCapacity } from "@/lib/employers/jobs-adapter";
import { getCandidates } from "@/lib/employers/candidates-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import { jobStatusLabel } from "@/lib/employer/plans";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { EmployerNotices } from "@/components/employer/employer-cards";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";

/**
 * Employer Jobs (Figma screen 74) on the canonical `/employers/dashboard/jobs`
 * route.
 *
 * This is the merged page: the backend route and its real aggregation, wearing
 * the Figma presentation. It combines what each implementation had that the
 * other did not:
 *
 *  - From the backend page: `requireEmployerOverview` (so the organization,
 *    role, and job counts are the resolved, scoped ones), the server-side
 *    read failures surfaced as `notices`, the honest "no workspace yet" state,
 *    and the read-only phone rendering.
 *  - From the Figma page: the full employer app nav, the capacity badge, and
 *    the row list.
 *
 * Counts are real. The applicant count per job is counted from the hiring
 * backend's applicant list rather than defaulted, because "0 applicants" and
 * "we could not load applicants" are different statements. Capacity is the
 * stored subscription's limit, the same number publishing is gated on.
 */
export default async function EmployerJobsPage() {
  const [overview, jobs, capacity, applicants, orgId] = await Promise.all([
    requireEmployerOverview("/employers/dashboard/jobs"),
    getEmployerJobs(),
    getEmployerCapacity(),
    getCandidates(),
    getEmployerOrgId(),
  ]);

  const orgName = overview.organization?.name ?? overview.account.companyName;

  const countsByJob = new Map<string, number>();
  if (applicants.status === "ok") {
    for (const candidate of applicants.data) {
      countsByJob.set(candidate.appliedJobId, (countsByJob.get(candidate.appliedJobId) ?? 0) + 1);
    }
  }

  function rowValue(job: { id: string; title: string; status: string }): string {
    if (job.status !== "Published") return jobStatusLabel(job.status);
    if (applicants.status !== "ok") return "Applicants unavailable";
    const count = countsByJob.get(job.id) ?? 0;
    return `${count} applicant${count === 1 ? "" : "s"}`;
  }

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerAppNav />
        </div>

        <section className="odesseus-desktop-only" style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", flexWrap: "wrap" }}
          >
            <div>
              <span className="figma-eyebrow">JOBS</span>
              <h1>Your jobs</h1>
              <p className="muted">
                {overview.jobCounts.published} live · {overview.jobCounts.draft} draft ·{" "}
                {overview.jobCounts.closed} closed
              </p>
            </div>
            <Link className="figma-btn figma-btn-orange" href="/employers/post-job">
              + Post a Job
            </Link>
          </div>

          <EmployerNotices notices={overview.notices} />

          {capacity.status === "ok" ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge
                capacity={{
                  activeJobCount: capacity.data.activeJobCount,
                  planLimit: capacity.data.planLimit,
                  planId: capacity.data.planId,
                }}
              />
            </div>
          ) : null}

          <div style={{ marginTop: 24 }}>
            {overview.needsOrganization ? (
              <p className="muted">
                Your company workspace is not set up yet, so there are no jobs to show.
              </p>
            ) : jobs.status === "ok" && jobs.data.length > 0 ? (
              <EmployerRowList>
                {jobs.data.map((job) => (
                  <EmployerRow
                    key={job.id}
                    label={job.title}
                    value={rowValue(job)}
                    href={`/employers/jobs/${job.id}`}
                  />
                ))}
              </EmployerRowList>
            ) : jobs.status === "ok" ? (
              <EmployerStatePanel
                kind="empty"
                title="No Jobs Yet"
                message="Post your first role to start receiving applicants."
                actionHref="/employers/post-job"
                actionLabel="Post a Job"
              />
            ) : (
              <EmployerStatePanel kind="error" title="Jobs aren't available" message={jobs.reason} />
            )}
          </div>
        </section>

        <EmployerMobileScreen
          orgName={orgName}
          eyebrow="Employer"
          title="Your jobs"
          active="Jobs"
          backHref="/employers/dashboard"
          lead={
            overview.needsOrganization
              ? "Your company workspace is not set up yet."
              : `${overview.jobCounts.published} live · ${overview.jobCounts.draft} draft · ${overview.jobCounts.closed} closed`
          }
        >
          {overview.jobs.length ? (
            <div className="m-list" style={{ margin: "0 4px" }}>
              {overview.jobs.map((job) => (
                <div className="m-card employer-m-job" key={job.id}>
                  <div className="m-copy">
                    <strong>{job.title}</strong>
                    <small>
                      {job.location || "Location not set"} · {jobStatusLabel(job.status)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-note employer-m-empty">
              {overview.needsOrganization
                ? "Your company workspace is not set up yet, so there are no jobs to show."
                : "No jobs yet."}
            </p>
          )}

          <EmployerDesktopOnlyNotice>
            Post a new job or edit an existing one from a desktop browser at /employers/post-job.
          </EmployerDesktopOnlyNotice>
          <div style={{ height: 84 }} aria-hidden="true" />
        </EmployerMobileScreen>
      </div>
    </main>
  );
}
