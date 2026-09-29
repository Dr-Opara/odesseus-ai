import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import { planForTier, subscriptionStatusLabel } from "@/lib/employer/plans";
import { EmployerNotices } from "@/components/employer/employer-cards";
import PostJobForm from "@/components/employers/post-job-form";
import { getEmployerOrgId } from "@/lib/employers/context";

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

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
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
          ) : !plan ? (
            <div className="figma-info-card white employer-card" style={{ marginTop: 28 }}>
              <h2>No plan on this organization</h2>
              <p>
                Posting a job needs a plan, because each published job uses one of the job posts
                included in your subscription. This organization has no plan on file.
              </p>
              <Link className="figma-btn figma-btn-orange" href="/employers/pricing">
                See plans
              </Link>
            </div>
          ) : (
            <>
              <div className="figma-info-card peach" style={{ marginTop: 20 }}>
                <strong>
                  Publishing uses 1 of your {quota?.included ?? plan.jobPostsIncluded} job posts.
                </strong>
                <p>
                  {quota
                    ? `${quota.remaining} remaining on the ${plan.name} plan.`
                    : "Your remaining allowance is not available to display right now."}{" "}
                  {subscriptionStatusLabel(overview.subscription?.status)}.
                </p>
              </div>

              <PostJobForm orgId={orgId ?? ""} />
            </>
          )}
        </section>

        <section className="odesseus-mobile-only" style={{ padding: "20px 20px 40px" }}>
          <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>Post a job</h1>
          <p className="m-lead">
            Employer accounts are created on a desktop browser, and posting a job is a desktop
            action. On a phone you can review your jobs, plan and seats.
          </p>
          <Link className="m-action" href="/employers/dashboard/jobs">
            View my jobs
          </Link>
        </section>
      </div>
    </main>
  );
}
