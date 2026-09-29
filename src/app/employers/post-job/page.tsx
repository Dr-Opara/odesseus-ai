import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEmployerOrgContext } from "@/lib/employers/org";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import PostJobForm from "@/components/employers/post-job-form";
import { getEmployerBilling } from "@/lib/employers/billing-adapter";

/** Post a Job (Figma screen 75, F13-E). */
export default async function EmployerPostJobPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    redirect("/employers/signup?next=/employers/post-job");
  }

  const org = await getEmployerOrgContext();
  if (!org) {
    if (user.user_metadata?.account_type === "employer") {
      redirect("/employers/onboarding/company");
    }
    await supabase.auth.signOut();
    redirect("/employers/signup?error=Create%20an%20employer%20account%20with%20your%20company%20email%20to%20post%20a%20job.");
  }

  const billingResult = await getEmployerBilling(org.orgId);
  const billing = billingResult.status === "ok" ? billingResult.data : null;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Post a Job</h1>
          <p className="muted">Create a new role.</p>

          {billing && billing.planId ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge
                capacity={{
                  activeJobCount: billing.capacity.published,
                  planLimit: billing.capacity.included,
                  planId: billing.planId,
                }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <EmployerStatePanel
                kind="billing-required"
                title="Choose a plan to publish"
                message="Odesseus needs an active plan before it can publish a job post."
                actionHref="/employers/billing"
                actionLabel="View Plans"
              />
            </div>
          )}

          <PostJobForm orgId={org.orgId} />
        </section>
      </div>
    </main>
  );
}
