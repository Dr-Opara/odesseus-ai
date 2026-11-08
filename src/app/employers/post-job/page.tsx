import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import { planForTier, subscriptionStatusLabel } from "@/lib/employer/plans";
import { EmployerNotices } from "@/components/employer/employer-cards";
import PostJobForm from "@/components/employers/post-job-form";
import { getEmployerOrgId } from "@/lib/employers/context";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerMobileScreen from "@/components/employer/employer-mobile-screen";

/**
 * Post a Job (Figma screen 75, F13-E) on the real backend.
 *
 * This page keeps the authorization and allowance the backend requires:
 *
 *  - It is signed-in-gated, and a candidate account is sent back to employer
 *    sign-in rather than shown an empty form.
 *  - `requireEmployerOverview` resolves the caller's organization, so the quota
 *    quoted below is the one persisted on their subscription.
 *  - An organization with no workspace, or with no plan, gets an honest
 *    explanation and a next step instead of a form that would fail on submit.
 *
 * The form itself is the Figma component, and its submit path goes through
 * `createEmployerJob` / `publishEmployerJob` — the same service functions the
 * jobs API routes call. Capacity is enforced server-side, so a plan at its
 * active-job limit produces a real refusal rather than a client-side guess.
 */
export default async function EmployerPostJobPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    redirect("/employers/signup?next=/employers/post-job");
  }

  if (user.user_metadata?.account_type !== "employer") {
    redirect("/employers/login?error=Sign%20in%20with%20your%20company%20account%20to%20post%20a%20job.");
  }

  const [overview, orgId] = await Promise.all([
    requireEmployerOverview("/employers/post-job"),
    getEmployerOrgId(),
  ]);
  const plan = planForTier(overview.subscription?.tier);
  const quota = overview.quota;
  const orgName = overview.organization?.name ?? overview.account.companyName;

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerAppNav orgName={orgName} role={overview.yourRole} />
        </div>

        <section className="odesseus-desktop-only" style={{ width: "min(860px,100%)", margin: "54px auto 90px" }}>
          <span className="figma-eyebrow">FOR EMPLOYERS</span>
          <h1>Post a Job</h1>
          <p className="muted">Publish a role and let Odesseus surface qualified candidates.</p>

          <EmployerNotices notices={overview.notices} />

          {overview.needsOrganization ? (
            <div className="figma-info-card white employer-card" style={{ marginTop: 28 }}>
              <h2>Your company workspace is not set up yet</h2>
              <p>
                There is no organization on this account yet, so there is nothing to post a job
                against. Our team completes set-up with you.
              </p>
              <Link className="figma-btn figma-btn-orange" href="/employers/onboarding/company">
                Set up your workspace
              </Link>
            </div>
          ) : !plan && !quota?.canPublishJob ? (
            <div className="figma-info-card white employer-card" style={{ marginTop: 28 }}>
              <h2>No job-post credits yet</h2>
              <p>
                Each published job uses one job-post credit and stays live for 30 days. The AI
                Starter Bundle includes 5 credits every 30 days.
              </p>
              <Link className="figma-btn figma-btn-orange" href="/employers/dashboard/billing">
                Get the AI Starter Bundle
              </Link>
            </div>
          ) : (
            <>
              <div className="figma-info-card peach" style={{ marginTop: 20 }}>
                <strong>Publishing uses 1 job-post credit and keeps the post live for 30 days.</strong>
                <p>
                  {quota
                    ? `${quota.remaining} usable ${quota.remaining === 1 ? "credit" : "credits"} left.`
                    : "Your remaining credits are not available to display right now."}{" "}
                  {plan ? `${plan.name}: ${subscriptionStatusLabel(overview.subscription?.status)}.` : ""}
                </p>
              </div>

              <PostJobForm orgId={orgId ?? ""} />
            </>
          )}
        </section>

        <EmployerMobileScreen
          orgName={orgName}
          eyebrow="Employer"
          title="Post a job"
          active="Jobs"
          lead="Employer accounts are created on a desktop browser, and posting a job is a desktop action. On a phone you can review your jobs, plan and seats."
        >
          <Link className="m-action" href="/employers/dashboard/jobs">
            View my jobs
          </Link>
        </EmployerMobileScreen>
      </div>
    </main>
  );
}
