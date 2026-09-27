import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import EmployerPortalHeader from "@/components/employer/employer-portal-header";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";
import {
  EmployerJobsList,
  EmployerNotices,
} from "@/components/employer/employer-cards";
import { jobStatusLabel } from "@/lib/employer/plans";

/**
 * Employer jobs (Phase 5).
 *
 * The organization's real `employer_jobs` rows with their real statuses and
 * promotions. Desktop is the management surface — job creation and editing are
 * desktop-first — so the phone rendering is a read-only list plus an explicit
 * note about where the write actions live.
 */
export default async function EmployerJobsPage() {
  const overview = await requireEmployerOverview("/employers/dashboard/jobs");
  const orgName = overview.organization?.name ?? overview.account.companyName;

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerPortalHeader orgName={orgName} role={overview.yourRole} />

        <section className="odesseus-desktop-only" style={{ padding: "54px 0 80px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 20,
              alignItems: "end",
              flexWrap: "wrap",
            }}
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

          {overview.needsOrganization ? (
            <p className="muted" style={{ marginTop: 24 }}>
              Your company workspace is not set up yet, so there are no jobs to show.
            </p>
          ) : (
            <article
              className="figma-info-card white employer-card"
              style={{ marginTop: 28 }}
            >
              <EmployerJobsList
                jobs={overview.jobs}
                emptyCopy="No jobs yet. Post a role and Odesseus will start surfacing qualified candidates for it."
              />
            </article>
          )}

          <div className="employer-portal-foot">
            <Link className="link" href="/employers/dashboard">
              Overview
            </Link>
            <Link className="link" href="/employers/dashboard/team">
              Team
            </Link>
            <Link className="link" href="/employers/dashboard/billing">
              Billing
            </Link>
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
