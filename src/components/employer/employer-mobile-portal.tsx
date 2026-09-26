import Link from "next/link";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";
import {
  EmployerNeedsOrganization,
  EmployerNotices,
} from "@/components/employer/employer-cards";
import {
  featuredOptionForTier,
  jobStatusLabel,
  planForTier,
  subscriptionStatusLabel,
} from "@/lib/employer/plans";
import type { EmployerOverview } from "@/lib/employer/types";

/**
 * Employer mobile portal (Phase 5).
 *
 * Employer accounts are created on desktop/web only, so the phone flow is
 * Business Login -> this overview. It shows real records and stays read-only:
 * job creation, job editing, seat administration, subscription changes and
 * featured purchases are desktop-first, and the screen says so rather than
 * showing controls that would do nothing.
 *
 * Both widths are covered by the same component; the layout is fluid and the
 * one action is a full-width link, so 390x844, 393x852 and 430x932 all read the
 * same without a separate narrow breakpoint.
 *
 * Odesseus Live is never mentioned or linked here — it is a candidate product.
 */

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function EmployerMobilePortal({ overview }: { overview: EmployerOverview }) {
  const orgName = overview.organization?.name ?? overview.account.companyName;
  const plan = planForTier(overview.subscription?.tier);
  const quota = overview.quota;
  const liveJobs = overview.jobs.filter((job) => job.status === "published");

  return (
    <EmployerMobileScreen
      orgName={orgName}
      eyebrow="Employer"
      title="Hiring overview"
      active="Overview"
      lead={
        overview.needsOrganization
          ? "Your sign-in works, but your company workspace is not set up yet."
          : undefined
      }
    >
      <EmployerNotices notices={overview.notices} />

      {overview.needsOrganization ? (
        <EmployerNeedsOrganization overview={overview} />
      ) : (
        <>
          <div className="m-grid" style={{ margin: "0 4px" }}>
            <div className="m-card">
              <strong style={{ fontSize: 26 }}>{liveJobs.length}</strong>
              <small>Live jobs</small>
            </div>
            <div className="m-card">
              <strong style={{ fontSize: 26 }}>{overview.jobCounts.draft}</strong>
              <small>Drafts</small>
            </div>
          </div>

          <div className="m-card employer-m-plan" style={{ margin: "10px 4px 0" }}>
            <div className="m-copy">
              <small>Plan</small>
              <strong>{plan ? plan.name : overview.subscription ? "Not recognised" : "No subscription"}</strong>
              <small>
                {overview.subscription
                  ? `${subscriptionStatusLabel(overview.subscription.status)}${
                      overview.subscription.periodEnd
                        ? ` · renews ${formatDate(overview.subscription.periodEnd)}`
                        : ""
                    }`
                  : "Contact support to set up a plan."}
              </small>
            </div>
            {plan ? (
              <span className="m-tag">
                {plan.priceLabel} {plan.unit}
              </span>
            ) : null}
          </div>

          <div className="m-card employer-m-plan" style={{ margin: "10px 4px 0" }}>
            <div className="m-copy">
              <small>Job posts remaining</small>
              <strong>
                {quota ? `${quota.remaining} of ${quota.included}` : "Not available"}
              </strong>
              <small>
                {quota && !quota.canPublishJob
                  ? "You have used this period's job posts."
                  : "Each published job uses one."}
              </small>
            </div>
          </div>

          <div className="m-card employer-m-plan" style={{ margin: "10px 4px 0" }}>
            <div className="m-copy">
              <small>Recruiter seats</small>
              <strong>
                {overview.seats
                  ? `${overview.seats.active} of ${overview.seats.required} included`
                  : "Not available"}
              </strong>
              <small>{overview.members.length} team member{overview.members.length === 1 ? "" : "s"}</small>
            </div>
            <Link className="m-chevron" href="/employers/dashboard/team" aria-label="Team">
              ›
            </Link>
          </div>

          <h2 className="employer-m-section">Your jobs</h2>
          {overview.jobs.length ? (
            <div className="m-list" style={{ margin: "0 4px" }}>
              {overview.jobs.map((job) => {
                const option = job.featured ? featuredOptionForTier(job.featured.tier) : null;
                return (
                  <div className="m-card employer-m-job" key={job.id}>
                    <div className="m-copy">
                      <strong>{job.title}</strong>
                      <small>
                        {job.location || "Location not set"} · {jobStatusLabel(job.status)}
                      </small>
                      {job.featured && job.featured.isActive ? (
                        <small>
                          {option ? option.name : "Promotion"} until{" "}
                          {formatDate(job.featured.expiresAt)}
                        </small>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="m-note employer-m-empty">
              No jobs yet. Post a role from a desktop browser to start building your pipeline.
            </p>
          )}

          <Link className="m-action employer-m-action" href="/employers/dashboard/jobs">
            All jobs
          </Link>

          <EmployerDesktopOnlyNotice>
            Post a job, change seats, change your plan or buy a promotion from a desktop browser.
            Everything you can see here is on the overview at /employers/dashboard.
          </EmployerDesktopOnlyNotice>

          <EmployerMobileNavSpacer />
        </>
      )}
    </EmployerMobileScreen>
  );
}

/** Keeps the fixed bottom navigation clear of the last card. */
function EmployerMobileNavSpacer() {
  return <div style={{ height: 84 }} aria-hidden="true" />;
}
