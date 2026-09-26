import Link from "next/link";
import {
  featuredOptionForTier,
  jobStatusLabel,
  planForTier,
  subscriptionStatusLabel,
  isActiveSubscriptionStatus,
} from "@/lib/employer/plans";
import type {
  EmployerJob,
  EmployerJobQuota,
  EmployerOverview,
  EmployerSeats,
  EmployerSubscription,
} from "@/lib/employer/types";

/**
 * The plan / quota card, shared by the overview, the billing page and the
 * jobs page.
 *
 * Every number here comes from the persisted employer records. There is no
 * demo plan, no "AI Starter Bundle", and no invented applicant count: when a
 * record is missing the card says so.
 */

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The plan card: stored tier, live status, and the remaining job posts. */
export function EmployerPlanCard({
  subscription,
  quota,
}: {
  subscription: EmployerSubscription | null;
  quota: EmployerJobQuota | null;
}) {
  const plan = planForTier(subscription?.tier);
  const isLive = isActiveSubscriptionStatus(subscription?.status);

  if (!subscription) {
    return (
      <article className="figma-info-card white employer-card" data-testid="employer-plan-card">
        <span className="figma-eyebrow">PLAN</span>
        <h2>No subscription yet</h2>
        <p>
          This organization has no plan on file, so there is no job-post allowance to spend.
        </p>
        <Link className="figma-btn figma-btn-orange" href="/employers/pricing">
          See plans
        </Link>
      </article>
    );
  }

  if (!plan) {
    return (
      <article className="figma-info-card white employer-card" data-testid="employer-plan-card">
        <span className="figma-eyebrow">PLAN</span>
        <h2>Plan not recognised</h2>
        <p>
          The plan stored on this subscription is <code>{subscription.tier}</code>, which this
          build does not recognise. We are not going to guess at its price or its job allowance.
        </p>
        <p className="muted">Contact support and we will confirm the plan on your account.</p>
      </article>
    );
  }

  return (
    <article className="figma-info-card white employer-card" data-testid="employer-plan-card">
      <span className="figma-eyebrow">PLAN</span>
      <h2>
        {plan.name} <small className="employer-plan-price">{plan.priceLabel} {plan.unit}</small>
      </h2>
      <p className="employer-plan-status">
        {subscriptionStatusLabel(subscription.status)}
        {subscription.periodEnd ? ` · renews ${formatDate(subscription.periodEnd)}` : ""}
      </p>
      <p className="employer-quota-line">
        {quota ? (
          <>
            <strong>
              {quota.remaining} of {quota.included}
            </strong>{" "}
            job posts remaining
          </>
        ) : (
          "Job-post allowance not available"
        )}
      </p>
      {!isLive ? (
        <p className="muted">
          This subscription is not active, so it does not currently include any job posts.
        </p>
      ) : null}
      <Link className="figma-btn figma-btn-orange" href="/employers/dashboard/billing">
        View billing
      </Link>
    </article>
  );
}

/** The seat card: entitlement, paid seats and the per-extra-seat price. */
export function EmployerSeatsCard({ seats }: { seats: EmployerSeats | null }) {
  if (!seats) {
    return (
      <article className="figma-info-card peach employer-card" data-testid="employer-seats-card">
        <span className="figma-eyebrow">RECRUITER SEATS</span>
        <h2>Seat count unavailable</h2>
        <p>
          We could not read the seat entitlement for this organization right now, so we are not
          showing a number.
        </p>
      </article>
    );
  }

  return (
    <article className="figma-info-card peach employer-card" data-testid="employer-seats-card">
      <span className="figma-eyebrow">RECRUITER SEATS</span>
      <h2>
        {seats.active} <small className="employer-plan-price">of {seats.required} included</small>
      </h2>
      <p>
        {seats.extraSeats > 0
          ? `${seats.extraSeats} additional seat${seats.extraSeats === 1 ? "" : "s"} beyond your plan.`
          : "No additional seats on this plan."}
      </p>
      {seats.activeUntil ? <p className="muted">Seat subscription active until {formatDate(seats.activeUntil)}.</p> : null}
      {seats.isOverEntitled ? (
        <p className="muted">
          Your team has {seats.required - seats.active} more member
          {seats.required - seats.active === 1 ? "" : "s"} than the paid seats cover.
        </p>
      ) : null}
      <p className="muted">Additional seats are $20/month each.</p>
      <Link className="link" href="/employers/dashboard/billing">
        Seat billing
      </Link>
    </article>
  );
}

/** One job row: title, location, stored status and any running promotion. */
function jobMeta(job: EmployerJob) {
  const parts = [job.location || "Location not set", jobStatusLabel(job.status)];
  return parts.filter(Boolean).join(" · ");
}

function featuredLabel(job: EmployerJob) {
  if (!job.featured) return null;
  const option = featuredOptionForTier(job.featured.tier);
  if (!option) return `Promotion (${job.featured.tier})`;
  if (!job.featured.isActive) return `${option.name} inactive`;
  return `${option.name} until ${formatDate(job.featured.expiresAt)}`;
}

export function EmployerJobRow({ job }: { job: EmployerJob }) {
  const promotion = featuredLabel(job);
  return (
    <li className="employer-job-row">
      <div>
        <strong>{job.title}</strong>
        <span className="muted">{jobMeta(job)}</span>
      </div>
      <div className="employer-job-row-meta">
        {promotion ? <span className="employer-featured-pill">{promotion}</span> : null}
        <small className="muted">
          {job.postedAt ? `Posted ${formatDate(job.postedAt)}` : "Not published yet"}
        </small>
      </div>
    </li>
  );
}

/** The jobs list, shared by the overview and the jobs page. */
export function EmployerJobsList({
  jobs,
  emptyCopy,
}: {
  jobs: EmployerJob[];
  emptyCopy: string;
}) {
  if (!jobs.length) {
    return <p className="dashboard-empty">{emptyCopy}</p>;
  }

  return (
    <ul className="employer-job-list">
      {jobs.map((job) => (
        <EmployerJobRow job={job} key={job.id} />
      ))}
    </ul>
  );
}

/** Quiet notices for records the server could not read. */
export function EmployerNotices({ notices }: { notices: string[] }) {
  if (!notices.length) return null;
  return (
    <div className="employer-notices" role="status">
      {notices.map((notice) => (
        <p key={notice}>{notice}</p>
      ))}
    </div>
  );
}

/**
 * The empty state for an employer whose organization row was never created.
 *
 * This is reachable: `employerSignup` creates the auth user but does not yet
 * provision an `employer_organizations` / `employer_members` pair. The copy
 * says what is missing instead of rendering an all-zero dashboard.
 */
export function EmployerNeedsOrganization({ overview }: { overview: EmployerOverview }) {
  const company = overview.account.companyName || overview.organization?.name;

  return (
    <div className="figma-info-card white employer-card employer-empty">
      <span className="figma-eyebrow">YOUR COMPANY</span>
      <h2>{company || "Your company"}</h2>
      <p>
        Your sign-in works, but this account is not linked to a company workspace yet, so there
        are no jobs, plan or seats to show.
      </p>
      <p className="muted">
        Set-up is completed with our team. Send us a note and we will finish it for you.
      </p>
      <a className="figma-btn figma-btn-orange" href="mailto:employers@odesseus.ai?subject=Company%20workspace%20set-up">
        Contact employer support
      </a>
    </div>
  );
}
