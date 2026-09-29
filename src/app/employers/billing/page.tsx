import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import EmployerPlanPicker from "@/components/employers/manage-plan-button";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";
import { getFeaturedJobPackages } from "@/lib/employers/featured-adapter";
import { EMPLOYER_PLANS, RECRUITER_SEAT_PRICE_LABEL, RECRUITER_SEAT_UNIT } from "@/lib/pricing/candidate-pricing";

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not set" : parsed.toLocaleDateString();
}

/**
 * Employer Billing (Figma screen 82, F13-N). A separate surface from
 * candidate wallet billing (`/billing`) — no adapter, route, or price source
 * is shared with it. Capacity, seats, and plan state are read from the
 * billing endpoint; a plan or seat only changes once Stripe confirms.
 */
export default async function EmployerBillingPage() {
  const { orgId } = await requireEmployerPage("/employers/billing");

  const billingResult = await getEmployerBilling(orgId);
  const packages = getFeaturedJobPackages();

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Employer Billing</h1>
          {billingResult.status === "ok" ? (
            <p className="muted">
              {billingResult.data.planId
                ? `${billingResult.data.planId} plan${billingResult.data.priceLabel ? ` · ${billingResult.data.priceLabel}` : ""}`
                : "No active plan"}
              {billingResult.data.subscriptionStatus ? ` · ${billingResult.data.subscriptionStatus.replaceAll("_", " ")}` : ""}
            </p>
          ) : null}

          <div style={{ marginTop: 24 }}>
            {billingResult.status === "ok" ? (
              <>
                <EmployerRowList>
                  <EmployerRow label="Plan" value={billingResult.data.planId ?? "No active plan"} />
                  <EmployerRow
                    label="Active jobs"
                    value={`${billingResult.data.capacity.published} of ${billingResult.data.capacity.included}`}
                  />
                  <EmployerRow label="Renews" value={formatDate(billingResult.data.periodEnd)} />
                  <EmployerRow
                    label="Recruiter seats"
                    value={
                      billingResult.data.seats
                        ? `${billingResult.data.seats.active} of ${billingResult.data.seats.required}`
                        : "Not available"
                    }
                  />
                  <EmployerRow label="Featured listings" value={billingResult.data.featuredActive} />
                  {packages.map((pkg) => (
                    <EmployerRow key={pkg.id} label={`${pkg.name} ${pkg.unit.replace(/^\//, "").trim()}`} value={pkg.priceLabel} />
                  ))}
                  <EmployerRow
                    label="Extra recruiter seat"
                    value={`${RECRUITER_SEAT_PRICE_LABEL}${RECRUITER_SEAT_UNIT.replace("per additional seat", "").trim()}`}
                  />
                </EmployerRowList>

                <EmployerPlanPicker orgId={orgId} currentPlanId={billingResult.data.planId} />
                <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
                  Starter includes {EMPLOYER_PLANS[0].jobs.toLowerCase()}, Growth includes {EMPLOYER_PLANS[1].jobs.toLowerCase()}, and
                  Business includes {EMPLOYER_PLANS[2].jobs.toLowerCase()}. Plan changes take effect once payment is confirmed.
                </p>
              </>
            ) : (
              <EmployerStatePanel kind="error" title="We couldn't load your billing details" message={billingResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
