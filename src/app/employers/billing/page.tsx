import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import ManagePlanButton from "@/components/employers/manage-plan-button";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";
import { getEmployerJobs } from "@/lib/employers/jobs-adapter";
import { EMPLOYER_PLANS, PROMOTION_PLANS, RECRUITER_SEAT_PRICE_LABEL, RECRUITER_SEAT_UNIT } from "@/lib/pricing/candidate-pricing";

/**
 * Employer Billing (Figma screen 82, F13-N). A separate surface from
 * candidate wallet billing (`/billing`) — never shares an adapter or route
 * with it.
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

  const [billingResult, jobsResult] = await Promise.all([getEmployerBilling(), getEmployerJobs()]);
  const activeCount = jobsResult.status === "ok" ? jobsResult.data.filter((j) => j.status === "Published").length : undefined;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>Employer Billing</h1>
          {billingResult.status === "ok" ? (
            <p className="muted">
              {billingResult.data.planId} plan · {billingResult.data.priceLabel}
            </p>
          ) : null}

          <div style={{ marginTop: 24 }}>
            {billingResult.status === "ok" ? (
              <>
                <EmployerRowList>
                  <EmployerRow label="Plan" value={billingResult.data.planId} />
                  <EmployerRow
                    label="Active jobs"
                    value={
                      activeCount !== undefined
                        ? `${activeCount} of ${EMPLOYER_PLANS.find((p) => p.name === billingResult.data.planId)?.activeJobLimit ?? "—"}`
                        : "—"
                    }
                  />
                  {PROMOTION_PLANS.map((plan) => (
                    <EmployerRow key={`${plan.name}-${plan.unit}`} label={`${plan.name} ${plan.unit.replace(/^\//, "").trim()}`} value={plan.priceLabel} />
                  ))}
                  <EmployerRow label="Extra recruiter seat" value={`${RECRUITER_SEAT_PRICE_LABEL}${RECRUITER_SEAT_UNIT.replace("per additional seat", "").trim()}`} />
                </EmployerRowList>
                <ManagePlanButton currentPlanId={billingResult.data.planId} />
              </>
            ) : (
              <EmployerStatePanel kind="error" title="Billing isn't available yet" message={billingResult.reason} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
