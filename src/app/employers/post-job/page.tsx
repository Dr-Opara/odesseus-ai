import { redirect } from "next/navigation";
import Link from "next/link";
import EmployerNav from "@/components/employer-nav";
import { createClient } from "@/lib/supabase/server";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import { planForTier, subscriptionStatusLabel } from "@/lib/employer/plans";
import { EmployerNotices } from "@/components/employer/employer-cards";

/**
 * Post a job (Phase 5).
 *
 * This page is signed-in-gated for the overview it needs (a signed-out visitor
 * is sent to employer sign-up, as before) and then reads the organization's
 * real plan so the allowance it quotes is the persisted one.
 *
 * The form is intentionally inert. Publishing a job has to consume one job post
 * from `employer_job_post_credits`, and that decrement is backend-owned: the
 * only grant function in the schema, `grant_employer_tier_job_posts`, is not
 * executable by `authenticated`, and writing `used` from the browser would let
 * a client mint its own allowance. Rather than ship a Publish button that
 * either does nothing or quietly breaks the billing invariant, the form is
 * disabled with the reason stated. See `docs/phase-5-employer-blockers.md`.
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

  const overview = await requireEmployerOverview("/employers/post-job");
  const plan = planForTier(overview.subscription?.tier);
  const quota = overview.quota;

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerNav />
        </div>
        <div className="odesseus-mobile-only employer-portal-mobile-bar">
          <span>Post a job</span>
          <a href="/employers/dashboard">Back to dashboard</a>
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
              <a className="figma-btn figma-btn-orange" href="mailto:employers@odesseus.ai?subject=Company%20workspace%20set-up">
                Contact employer support
              </a>
            </div>
          ) : !plan ? (
            <div className="figma-info-card white employer-card" style={{ marginTop: 28 }}>
              <h2>No plan on this organization</h2>
              <p>
                Posting a job needs a plan, because each published job uses one of the job posts
                included in your subscription. This organization has no plan on file.
              </p>
              <a className="figma-btn figma-btn-orange" href="/employers/pricing">
                See plans
              </a>
            </div>
          ) : (
            <>
              <div className="figma-info-card white employer-card" style={{ padding: 32, marginTop: 28 }}>
                <fieldset disabled style={{ border: 0, margin: 0, padding: 0 }}>
                  <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Job title<input className="input" placeholder="e.g. GenAI Security Engineer" /></label>
                  <div className="figma-two-grid" style={{ marginTop: 18 }}>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>City<input className="input" placeholder="e.g. Lagos" /></label>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Country<select className="input" defaultValue="Nigeria"><option>Nigeria</option><option>United States</option><option>Canada</option><option>United Kingdom</option></select></label>
                  </div>
                  <div className="figma-two-grid" style={{ marginTop: 18 }}>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Work arrangement<select className="input"><option>Remote</option><option>Hybrid</option><option>On-site</option></select></label>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Employment type<select className="input"><option>Full-time</option><option>Contract</option><option>Part-time</option></select></label>
                  </div>
                  <div className="figma-three-grid" style={{ marginTop: 18 }}>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Currency<select className="input"><option>USD ($)</option><option>NGN (₦)</option><option>GBP (£)</option><option>CAD ($)</option></select></label>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Min salary<input className="input" type="number" /></label>
                    <label style={{ display: "grid", gap: 8, fontWeight: 650 }}>Max salary<input className="input" type="number" /></label>
                  </div>
                  <label style={{ display: "grid", gap: 8, marginTop: 18, fontWeight: 650 }}>Job description<textarea className="input" rows={9} placeholder="Describe the role, responsibilities and requirements…" /></label>
                </fieldset>

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

                <div className="employer-publish-blocked" role="status">
                  <strong>Publishing is not connected yet.</strong>
                  <p>
                    A job post has to be charged against your plan on the server, and that step is
                    not part of this deployment. Nothing here is submitted, and nothing is
                    deducted. Your job list, plan and seats are unaffected.
                  </p>
                  <a className="figma-btn figma-btn-orange" href="/employers/dashboard">
                    Back to dashboard
                  </a>
                </div>
              </div>
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
