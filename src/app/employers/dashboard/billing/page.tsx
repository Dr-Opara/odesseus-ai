import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import EmployerPortalHeader from "@/components/employer/employer-portal-header";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";
import {
  EmployerNotices,
  EmployerPlanCard,
  EmployerSeatsCard,
} from "@/components/employer/employer-cards";
import {
  FEATURED_OPTION_BY_TIER,
  FEATURED_TIERS,
  planForTier,
  subscriptionStatusLabel,
} from "@/lib/employer/plans";

/**
 * Employer billing (Phase 5).
 *
 * A display of what the organization is on and what it has: the stored
 * subscription and its status, the granted job-post allowance, the paid seat
 * count, and the approved promotion prices.
 *
 * This page changes nothing. Subscription changes, seat administration and
 * featured purchases are Stripe-backed and backend-owned; the checkout entry
 * points do not exist on this branch yet (the wallet/billing backend has not
 * shipped), so the page shows real state and links to the published pricing
 * rather than wiring buttons to a checkout that would fail. See
 * `docs/phase-5-employer-blockers.md`.
 */

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function EmployerBillingPage() {
  const overview = await requireEmployerOverview("/employers/dashboard/billing");
  const orgName = overview.organization?.name ?? overview.account.companyName;
  const plan = planForTier(overview.subscription?.tier);

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <EmployerPortalHeader orgName={orgName} role={overview.yourRole} />

        <section className="odesseus-desktop-only" style={{ padding: "54px 0 80px" }}>
          <div>
            <span className="figma-eyebrow">BILLING</span>
            <h1>Billing</h1>
            <p className="muted">
              {plan
                ? `${plan.name} · ${plan.priceLabel} ${plan.unit} · ${plan.jobsLabel}.`
                : "What this organization is currently on."}
            </p>
          </div>

          <EmployerNotices notices={overview.notices} />

          {overview.needsOrganization ? (
            <p className="muted" style={{ marginTop: 24 }}>
              Your company workspace is not set up yet, so there is no plan or billing to show.
            </p>
          ) : (
            <>
              <div className="figma-two-grid" style={{ marginTop: 28 }}>
                <EmployerPlanCard
                  subscription={overview.subscription}
                  quota={overview.quota}
                />
                <EmployerSeatsCard seats={overview.seats} />
              </div>

              <article className="figma-info-card white employer-card" style={{ marginTop: 24 }}>
                <h2>This billing period</h2>
                <dl className="employer-facts">
                  <div>
                    <dt>Plan</dt>
                    <dd>{plan ? plan.name : overview.subscription ? "Not recognised" : "None"}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{subscriptionStatusLabel(overview.subscription?.status)}</dd>
                  </div>
                  <div>
                    <dt>Period</dt>
                    <dd>
                      {formatDate(overview.subscription?.periodStart)} –{" "}
                      {formatDate(overview.subscription?.periodEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt>Job posts included</dt>
                    <dd>{overview.quota?.included ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Job posts used</dt>
                    <dd>{overview.allowance?.used ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Recruiter seats</dt>
                    <dd>
                      {overview.seats ? `${overview.seats.active} paid` : "—"}
                      {overview.seats ? ` of ${overview.seats.required} included` : ""}
                    </dd>
                  </div>
                </dl>
                <p className="muted employer-billing-note">
                  Stripe identifiers are never shown here. Plan changes and seat purchases are
                  handled by our billing system once it is connected to this deployment.
                </p>
                <Link className="figma-btn figma-btn-orange" href="/employers/pricing">
                  Compare plans
                </Link>
              </article>

              <article className="figma-info-card white employer-card" style={{ marginTop: 24 }}>
                <h2>Job promotions</h2>
                <ul className="employer-promotion-list">
                  {FEATURED_TIERS.map((tier) => {
                    const option = FEATURED_OPTION_BY_TIER[tier];
                    const running = overview.jobs.filter(
                      (job) => job.featured?.tier === tier && job.featured.isActive
                    ).length;
                    return (
                      <li key={tier}>
                        <div>
                          <strong>{option.name}</strong>
                          <span className="muted">{option.unit.replace(/^\/\s*/, "")}</span>
                        </div>
                        <div>
                          <span className="employer-promotion-price">
                            {option.priceLabel}
                          </span>
                          <span className="muted">
                            {running ? `${running} running` : "none running"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="muted employer-billing-note">
                  Buying a promotion is a Stripe checkout and is completed on a desktop browser.
                </p>
              </article>

              <div className="employer-portal-foot">
                <Link className="link" href="/employers/dashboard">
                  Overview
                </Link>
                <Link className="link" href="/employers/dashboard/jobs">
                  Jobs
                </Link>
                <Link className="link" href="/employers/dashboard/team">
                  Team
                </Link>
              </div>
            </>
          )}
        </section>

        <EmployerMobileScreen
          orgName={orgName}
          eyebrow="Employer"
          title="Billing"
          active="Billing"
          backHref="/employers/dashboard"
          lead={plan ? `${plan.name} · ${plan.priceLabel} ${plan.unit}` : undefined}
        >
          <div className="m-card employer-m-plan" style={{ margin: "0 4px" }}>
            <div className="m-copy">
              <small>Plan</small>
              <strong>{plan ? plan.name : overview.subscription ? "Not recognised" : "No subscription"}</strong>
              <small>{subscriptionStatusLabel(overview.subscription?.status)}</small>
            </div>
            {plan ? (
              <span className="m-tag">
                {plan.priceLabel} {plan.unit}
              </span>
            ) : null}
          </div>

          <div className="m-card employer-m-plan" style={{ margin: "10px 4px 0" }}>
            <div className="m-copy">
              <small>Job posts</small>
              <strong>
                {overview.quota ? `${overview.quota.remaining} of ${overview.quota.included} left` : "Not available"}
              </strong>
              <small>
                Renews {formatDate(overview.subscription?.periodEnd)}
              </small>
            </div>
          </div>

          <div className="m-card employer-m-plan" style={{ margin: "10px 4px 0" }}>
            <div className="m-copy">
              <small>Recruiter seats</small>
              <strong>
                {overview.seats ? `${overview.seats.active} of ${overview.seats.required} included` : "Not available"}
              </strong>
              <small>$20 per additional seat each month</small>
            </div>
          </div>

          <EmployerDesktopOnlyNotice>
            Change your plan, add seats or buy a promotion from a desktop browser. This page shows
            what you have; it does not take payment.
          </EmployerDesktopOnlyNotice>
          <div style={{ height: 84 }} aria-hidden="true" />
        </EmployerMobileScreen>
      </div>
    </main>
  );
}
