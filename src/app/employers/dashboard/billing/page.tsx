import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import {
  FEATURED_OPTION_BY_TIER,
  FEATURED_TIERS,
  planForTier,
  subscriptionStatusLabel,
} from "@/lib/employer/plans";
import {
  EXTRA_RECRUITER_SEAT_PRICE_LABEL,
  EXTRA_RECRUITER_SEAT_UNIT,
} from "@/lib/employer/plans";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import ManagePlanButton from "@/components/employers/manage-plan-button";
import { EmployerNotices } from "@/components/employer/employer-cards";
import EmployerMobileScreen, {
  EmployerDesktopOnlyNotice,
} from "@/components/employer/employer-mobile-screen";

/**
 * Employer Billing (Figma screen 82) on the canonical
 * `/employers/dashboard/billing` route.
 *
 * A separate surface from candidate wallet billing (`/billing`). The candidate
 * wallet holds Apply money; this page holds a company subscription, a job-post
 * allowance, recruiter seats, and promotions. They share no route, no adapter,
 * and no balance.
 *
 * Every figure is the backend's billing view. An organization with no
 * subscription renders "No plan" rather than inheriting Starter's price:
 * "you are not subscribed" and "you are on the cheapest plan" are different
 * statements, and only the first is true here.
 */
export default async function EmployerBillingPage() {
  const [overview, billing, orgId] = await Promise.all([
    requireEmployerOverview("/employers/dashboard/billing"),
    getEmployerBilling(),
    getEmployerOrgId(),
  ]);

  const orgName = overview.organization?.name ?? overview.account.companyName;
  const plan = planForTier(overview.subscription?.tier);

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerAppNav />
        </div>

        <section className="odesseus-desktop-only" style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
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
          ) : billing.status === "ok" ? (
            <>
              <div style={{ marginTop: 24 }}>
                <EmployerRowList>
                  <EmployerRow label="Plan" value={billing.data.planName ?? "No plan"} />
                  <EmployerRow
                    label="Status"
                    value={subscriptionStatusLabel(billing.data.subscriptionStatus)}
                  />
                  <EmployerRow
                    label="Job posts"
                    value={
                      billing.data.jobPostsRemaining === null
                        ? "Not available"
                        : `${billing.data.jobPostsRemaining} of ${
                            billing.data.jobPostsIncluded ?? billing.data.jobPostsRemaining
                          } remaining`
                    }
                  />
                  <EmployerRow
                    label="Recruiter seats"
                    value={`${billing.data.seatsUsed} of ${billing.data.seatLimit} included`}
                  />
                  <EmployerRow label="Promotions running" value={billing.data.featuredActive} />
                  {FEATURED_TIERS.map((tier) => {
                    const option = FEATURED_OPTION_BY_TIER[tier];
                    return (
                      <EmployerRow
                        key={tier}
                        label={`${option.name} ${option.unit.replace(/^\/\s*/, "")}`}
                        value={option.priceLabel}
                      />
                    );
                  })}
                  <EmployerRow
                    label="Extra recruiter seat"
                    value={`${EXTRA_RECRUITER_SEAT_PRICE_LABEL} ${EXTRA_RECRUITER_SEAT_UNIT}`}
                  />
                </EmployerRowList>
              </div>

              {billing.data.planId ? (
                <ManagePlanButton orgId={orgId ?? ""} currentPlanId={billing.data.planId} />
              ) : (
                <div style={{ marginTop: 20 }}>
                  <EmployerStatePanel
                    kind="billing-required"
                    title="Choose a plan to start hiring."
                    message="Posting a job uses one of the job posts included in your subscription. Pick a plan to begin."
                    actionHref="/employers/pricing"
                    actionLabel="See plans"
                  />
                </div>
              )}

              <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
                Billing details are handled by our payment provider. Card details are never stored
                by Odesseus.{" "}
                <Link className="link" href="/employers/pricing">
                  Compare plans
                </Link>
              </p>
            </>
          ) : (
            <EmployerStatePanel
              kind="error"
              title="Billing isn't available"
              message={billing.reason}
            />
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
              <strong>
                {plan ? plan.name : overview.subscription ? "Not recognised" : "No subscription"}
              </strong>
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
                {overview.quota
                  ? `${overview.quota.remaining} of ${overview.quota.included} left`
                  : "Not available"}
              </strong>
              <small>Renews {formatDate(overview.subscription?.periodEnd)}</small>
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
              <small>
                {EXTRA_RECRUITER_SEAT_PRICE_LABEL} per additional seat each month
              </small>
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

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
