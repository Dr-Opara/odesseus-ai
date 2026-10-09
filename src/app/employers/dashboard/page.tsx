import Link from "next/link";
import { requireEmployerOverview } from "@/app/employers/dashboard/overview";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerMobilePortal from "@/components/employer/employer-mobile-portal";
import {
  EmployerJobsList,
  EmployerNeedsOrganization,
  EmployerNotices,
  EmployerPlanCard,
  EmployerSeatsCard,
} from "@/components/employer/employer-cards";

/**
 * Employer overview (Phase 5).
 *
 * Replaces the previous hardcoded placeholder, which rendered invented figures
 * ("4 Active Jobs", "156 Applicants", "31 Strong Matches", "Credits Remaining
 * 3 / 5", "AI Starter Bundle"). Nothing on this page is sample data: every
 * number is read from the organization's own records through
 * `src/lib/employer/service`, and a missing record renders an honest empty or
 * unavailable state.
 *
 * Deliberately absent: an applicant count, a strong-match count, and any
 * shortlist. `applications` is candidate-owned and has no employer foreign key,
 * so there is no employer -> applicant link to count. See
 * `docs/phase-5-employer-blockers.md`. Inventing those numbers is exactly the
 * failure this page had.
 *
 * Desktop is the primary form factor: job creation, seat administration,
 * subscription changes and featured purchases are desktop-only. The phone
 * rendering is a read-only portal reached from Business Login.
 */
export default async function EmployerDashboardPage() {
  const overview = await requireEmployerOverview("/employers/dashboard");
  const orgName = overview.organization?.name ?? overview.account.companyName;

  return (
    <main className="figma-site figma-soft-page employer-portal">
      <div className="figma-page-wrap">
        <div className="odesseus-desktop-only">
          <EmployerAppNav orgName={orgName} role={overview.yourRole} />
        </div>

        <section className="odesseus-desktop-only" style={{ padding: "54px 0 80px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 20,
              alignItems: "end",
              flexWrap: "wrap",
            }}
          >
            <div>
              <span className="figma-eyebrow">FOR EMPLOYERS</span>
              <h1>{orgName || "Your company"}</h1>
              <p className="muted">
                {overview.jobCounts.total
                  ? `${overview.jobCounts.published} live ${
                      overview.jobCounts.published === 1 ? "job" : "jobs"
                    } · ${overview.jobCounts.draft} draft${
                      overview.jobCounts.draft === 1 ? "" : "s"
                    }.`
                  : "Post your first role to start building your pipeline."}
              </p>
            </div>
            <Link className="figma-btn figma-btn-orange" href="/employers/post-job">
              + Post a Job
            </Link>
          </div>

          <EmployerNotices notices={overview.notices} />

          {overview.needsOrganization ? (
            <div style={{ marginTop: 30 }}>
              <EmployerNeedsOrganization overview={overview} />
            </div>
          ) : (
            <>
              <div className="figma-three-grid" style={{ marginTop: 30 }}>
                <article className="figma-info-card white employer-card">
                  <h2>{overview.jobCounts.published}</h2>
                  <p>Live jobs</p>
                </article>
                <article className="figma-info-card cyan employer-card">
                  <h2>{overview.jobCounts.draft}</h2>
                  <p>Drafts</p>
                </article>
                <article className="figma-info-card lavender employer-card">
                  <h2>{overview.members.length}</h2>
                  <p>Team members</p>
                </article>
              </div>

              <div className="figma-two-grid" style={{ marginTop: 24 }}>
                <EmployerPlanCard
                  subscription={overview.subscription}
                  quota={overview.quota}
                />
                <EmployerSeatsCard seats={overview.seats} />
              </div>

              <article className="figma-info-card white employer-card" style={{ marginTop: 24 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <h2 style={{ margin: 0 }}>Your jobs</h2>
                  <Link href="/employers/dashboard/jobs" className="link">
                    Manage jobs
                  </Link>
                </div>
                <EmployerJobsList
                  jobs={overview.jobs}
                  emptyCopy="No jobs yet. Post a role and Odesseus will start surfacing qualified candidates for it."
                />
              </article>

              <div className="employer-portal-foot">
                <Link className="link" href="/employers/dashboard/team">
                  Team
                </Link>
                <Link className="link" href="/employers/dashboard/billing">
                  Billing
                </Link>
                <Link className="link" href="/employers/pricing">
                  Plans and promotions
                </Link>
              </div>
            </>
          )}
        </section>

        <EmployerMobilePortal overview={overview} />
      </div>
    </main>
  );
}
