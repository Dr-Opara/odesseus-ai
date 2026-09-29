import { requireEmployerPage } from "@/app/employers/guard";
import EmployerAppNav from "@/components/employers/app-nav";
import EmployerCapacityBadge from "@/components/employers/capacity-badge";
import EmployerStatePanel from "@/components/employers/state-panel";
import { EmployerRow, EmployerRowList } from "@/components/employers/row-list";
import { getEmployerDashboard } from "@/lib/employers/dashboard-adapter";
import { toPipelineStage } from "@/lib/employers/types";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not recorded" : parsed.toLocaleDateString();
}

/**
 * Employer Dashboard (Figma screen 73, F13-C). Every number comes from the
 * real dashboard read: active jobs, applicants, strong fits, capacity, seats,
 * plan, and recent activity. Read gaps the backend reported render as quiet
 * notices rather than as zeroes.
 */
export default async function EmployerDashboardPage() {
  const { orgId } = await requireEmployerPage("/employers/dashboard");
  const dashboardResult = await getEmployerDashboard(orgId);

  if (dashboardResult.status === "unavailable") {
    return (
      <main className="figma-site figma-soft-page">
        <div className="figma-page-wrap">
          <EmployerAppNav />
          <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
            <h1>Hiring Overview</h1>
            <div style={{ marginTop: 24 }}>
              <EmployerStatePanel
                kind="error"
                title="We couldn't load your hiring overview"
                message={dashboardResult.reason}
                actionHref="/employers/jobs"
                actionLabel="Go to Jobs"
              />
            </div>
          </section>
        </div>
      </main>
    );
  }

  const dashboard = dashboardResult.data;
  const interviews = dashboard.recentPipelineActivity.filter(
    (entry) => toPipelineStage(entry.stage) === "INTERVIEW"
  ).length;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerAppNav />
        <section style={{ width: "min(1160px,100%)", margin: "54px auto 90px" }}>
          <h1>{dashboard.organizationName || "Hiring Overview"}</h1>
          <p className="muted">
            {dashboard.planName
              ? `${dashboard.planName} plan`
              : "No active plan yet — post a job to start building your pipeline."}
          </p>

          {dashboard.notices.length > 0 ? (
            <div className="emp-row-list" style={{ marginTop: 18 }}>
              {dashboard.notices.map((notice) => (
                <div className="emp-row" key={notice}>
                  <span className="emp-row-value">{notice}</span>
                </div>
              ))}
            </div>
          ) : null}

          {dashboard.capacity && dashboard.planName ? (
            <div style={{ marginTop: 16 }}>
              <EmployerCapacityBadge
                capacity={{
                  activeJobCount: dashboard.capacity.published,
                  planLimit: dashboard.capacity.included,
                  planId: dashboard.planName,
                }}
              />
            </div>
          ) : null}

          <div style={{ marginTop: 24 }}>
            <EmployerRowList>
              <EmployerRow label="Active jobs" value={dashboard.jobCounts.published} href="/employers/jobs" />
              <EmployerRow label="Drafts" value={dashboard.jobCounts.draft} href="/employers/jobs" />
              <EmployerRow label="Applicants" value={dashboard.applicantTotal} href="/employers/candidates" />
              <EmployerRow label="Strong Fits" value={dashboard.strongFitCount} href="/employers/candidates" />
              <EmployerRow label="Interviews" value={interviews} href="/employers/pipeline" />
              {dashboard.seats ? (
                <EmployerRow
                  label="Recruiter seats"
                  value={`${dashboard.seats.active} of ${dashboard.seats.required}`}
                  href="/employers/team"
                />
              ) : null}
              <EmployerRow label="Featured listings" value={dashboard.featuredActive} />
            </EmployerRowList>
          </div>

          <h2 style={{ marginTop: 40 }}>Recent applicants</h2>
          <div className="emp-row-list" style={{ marginTop: 14 }}>
            {dashboard.recentApplicants.length === 0 ? (
              <EmployerStatePanel
                kind="empty"
                title="No applicants yet"
                message="Post a job to start receiving applicants."
                actionHref="/employers/post-job"
                actionLabel="Post a Job"
              />
            ) : (
              dashboard.recentApplicants.map((applicant) => (
                <EmployerRow
                  key={applicant.applicationId}
                  label={applicant.jobTitle}
                  value={`${applicant.applicationStatus} · ${formatDate(applicant.submittedAt)}`}
                  href={`/employers/candidates/${applicant.applicationId}`}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
