import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import ManagePlanButton from "@/components/employers/manage-plan-button";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";
import { getEmployerOrgId } from "@/lib/employers/context";
import { FEATURED_OPTION_BY_TIER, FEATURED_TIERS } from "@/lib/employer/plans";
import {
  EXTRA_RECRUITER_SEAT_PRICE_LABEL,
  EXTRA_RECRUITER_SEAT_UNIT,
  subscriptionStatusLabel,
} from "@/lib/employer/plans";

/**
 * Employer Billing (Figma screen 82, F13-N).
 *
 * A separate surface from candidate wallet billing (`/billing`). The candidate
 * wallet holds Apply money; this page holds a company subscription, a
 * job-post allowance, recruiter seats, and promotions. They share no route, no
 * adapter, and no balance.
 *
 * Every figure is read from the backend's billing view. An organization with
 * no subscription renders "No plan" rather than inheriting Starter's price:
 * "you are not subscribed" and "you are on the cheapest plan" are different
 * statements, and only the first is true here.
 */
export default async function EmployerBillingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect("/employers/login");
  if (user.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  const [billing, orgId] = await Promise.all([getEmployerBilling(), getEmployerOrgId()]);

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Employer Billing</h1>
          {billing.status === "ok" ? (
            <p className="muted">
              {billing.data.planName
                ? `${billing.data.planName}${billing.data.priceLabel ? ` · ${billing.data.priceLabel} ${billing.data.unit ?? ""}`.trimEnd() : ""}`
                : "Your organization does not have a plan yet."}
            </p>
          ) : null}

          <div style={{ marginTop: 24 }}>
            {billing.status === "ok" ? (
              <>
                <EmployerRowList>
                  <EmployerRow
                    label="Plan"
                    value={billing.data.planName ?? "No plan"}
                  />
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
                  <EmployerRow
                    label="Promotions running"
                    value={billing.data.featuredActive}
                  />
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
                  Billing details are handled by our payment provider. Card details are never
                  stored by Odesseus.{" "}
                  <Link className="link" href="/employers/pricing">
                    Compare plans
                  </Link>
                </p>
              </>
            ) : (
              <EmployerStatePanel kind="error" title="Billing isn't available yet" message={billing.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
