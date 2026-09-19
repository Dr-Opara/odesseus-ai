import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWhen(value: string | null) {
  if (!value) return "Time pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [
    { data: profile },
    { data: credits },
    { data: jobs },
    { data: applications },
    { data: interviews },
    { data: applicationEvents },
    { data: externalSignals },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name,headline,onboarding_completed").eq("id", userId).maybeSingle(),
    supabase.from("credit_balances").select("application_credits,interview_passes").eq("user_id", userId).maybeSingle(),
    supabase.from("job_opportunities").select("id,company_name,role_title,location,match_score,status").eq("user_id", userId).order("match_score", { ascending: false }).limit(5),
    supabase.from("applications").select("id,company_name,role_title,status,last_event_at,submitted_at").eq("user_id", userId).order("last_event_at", { ascending: false }).limit(20),
    supabase.from("interviews").select("id,stage,scheduled_at,status,meeting_provider,readiness_generated_at,applications(company_name,role_title)").eq("user_id", userId).in("status", ["invited","scheduled","ready","live"]).order("scheduled_at", { ascending: true }).limit(3),
    supabase.from("application_status_events").select("id,title,detail,occurred_at").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(6),
    supabase.from("external_signals").select("id,title,signal_type,occurred_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(4),
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const appCredits = credits?.application_credits ?? 0;
  const interviewPasses = credits?.interview_passes ?? 0;
  const recentApplications = applications || [];
  const strongMatches = (jobs || []).filter((job) => (job.match_score ?? 0) >= 85);
  const bestJob = strongMatches[0] || jobs?.[0] || null;
  const nextInterview = interviews?.[0] || null;

  const pipeline = {
    active: recentApplications.filter((item) =>
      ["applied","employer_response","assessment","interview"].includes(item.status)
    ).length,
    responses: recentApplications.filter((item) =>
      ["employer_response","assessment","interview","offer","accepted"].includes(item.status)
    ).length,
    interviews: recentApplications.filter((item) => item.status === "interview").length,
    offers: recentApplications.filter((item) => ["offer","accepted"].includes(item.status)).length,
  };

  const activity = [
    ...(applicationEvents || []).map((event) => ({
      key: `event-${event.id}`,
      title: event.title,
      detail: event.detail,
      at: event.occurred_at,
    })),
    ...(externalSignals || []).map((signal) => ({
      key: `signal-${signal.id}`,
      title: signal.title || labelStatus(signal.signal_type),
      detail: labelStatus(signal.signal_type),
      at: signal.occurred_at || signal.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);

  const nextAction = nextInterview
    ? {
        eyebrow: "Next up",
        title: `${nextInterview.applications?.role_title || "Interview"} at ${nextInterview.applications?.company_name || "your next company"}`,
        detail: `${nextInterview.stage || "Interview"} · ${formatWhen(nextInterview.scheduled_at)} · ${nextInterview.meeting_provider || "Platform pending"}`,
        href: `/interviews/${nextInterview.id}`,
        cta: nextInterview.readiness_generated_at ? "Open interview" : "Prepare interview",
      }
    : bestJob
      ? {
          eyebrow: "Strong match",
          title: `${bestJob.role_title} at ${bestJob.company_name}`,
          detail: `${bestJob.match_score ?? "—"}% match${bestJob.location ? ` · ${bestJob.location}` : ""}`,
          href: `/match/${bestJob.id}`,
          cta: "Review match",
        }
      : {
          eyebrow: "Get started",
          title: "Find your next strong match",
          detail: "Paste a role or job description and let Odysseus check it against your verified profile.",
          href: "/match",
          cta: "Check a job",
        };

  return (
    <AppShell
      fullName={profile.full_name}
      applicationCredits={appCredits}
      interviewPasses={interviewPasses}
      active="home"
    >
      <section className="shell dashboard-v2">
        <div className="dashboard-heading">
          <div>
            <div className="muted dashboard-eyebrow">Your workspace</div>
            <h1 className="dashboard-title">Good to see you, {firstName(profile.full_name)}.</h1>
            <p className="muted dashboard-subtitle">
              {profile.headline || "Here’s what needs your attention."}
            </p>
          </div>
          <Link className="btn btn-primary" href="/match">Find jobs</Link>
        </div>

        <div className="card dashboard-next-card">
          <div>
            <div className="dashboard-eyebrow">{nextAction.eyebrow}</div>
            <h2>{nextAction.title}</h2>
            <p className="muted">{nextAction.detail}</p>
          </div>
          <Link className="btn btn-primary" href={nextAction.href}>{nextAction.cta}</Link>
        </div>

        <div className="dashboard-stat-grid">
          <div className="card dashboard-stat"><span className="muted">Strong matches</span><strong>{strongMatches.length}</strong></div>
          <div className="card dashboard-stat"><span className="muted">Active applications</span><strong>{pipeline.active}</strong></div>
          <div className="card dashboard-stat"><span className="muted">Employer responses</span><strong>{pipeline.responses}</strong></div>
          <div className="card dashboard-stat"><span className="muted">Interviews</span><strong>{pipeline.interviews}</strong></div>
          <div className="card dashboard-stat"><span className="muted">Offers</span><strong>{pipeline.offers}</strong></div>
        </div>

        <div className="dashboard-command-grid">
          <section className="card dashboard-panel">
            <div className="dashboard-panel-heading">
              <div>
                <div className="dashboard-eyebrow">Applications</div>
                <h2>Recent activity</h2>
              </div>
              <Link href="/applications" className="muted">View all</Link>
            </div>
            {recentApplications.length ? (
              <div className="dashboard-list">
                {recentApplications.slice(0, 5).map((application) => (
                  <Link href={`/applications/${application.id}`} className="dashboard-list-row" key={application.id}>
                    <div>
                      <strong>{application.role_title}</strong>
                      <span className="muted">{application.company_name}</span>
                    </div>
                    <div className="dashboard-list-meta">
                      <span>{labelStatus(application.status)}</span>
                      <small className="muted">{formatWhen(application.last_event_at)}</small>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">No applications yet.</div>
            )}
          </section>

          <aside className="dashboard-side-stack">
            <section className="card dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <div className="dashboard-eyebrow">Interviews</div>
                  <h2>Upcoming</h2>
                </div>
                <Link href="/interviews" className="muted">View all</Link>
              </div>
              {interviews?.length ? (
                <div className="dashboard-list">
                  {interviews.map((interview) => (
                    <Link href={`/interviews/${interview.id}`} className="dashboard-list-row compact" key={interview.id}>
                      <div>
                        <strong>{interview.applications?.role_title || interview.stage || "Interview"}</strong>
                        <span className="muted">{interview.applications?.company_name || interview.meeting_provider || "Details pending"}</span>
                      </div>
                      <small className="muted">{formatWhen(interview.scheduled_at)}</small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty">Nothing scheduled.</div>
              )}
            </section>

            <section className="card dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <div className="dashboard-eyebrow">Balances</div>
                  <h2>Ready to use</h2>
                </div>
                <Link href="/billing" className="muted">Manage</Link>
              </div>
              <div className="dashboard-balance-grid">
                <div><strong>{appCredits}</strong><span className="muted">Application credits</span></div>
                <div><strong>{interviewPasses}</strong><span className="muted">Interview passes</span></div>
              </div>
            </section>
          </aside>
        </div>

        <section className="card dashboard-panel dashboard-activity">
          <div className="dashboard-panel-heading">
            <div>
              <div className="dashboard-eyebrow">Odysseus activity</div>
              <h2>What changed</h2>
            </div>
          </div>
          {activity.length ? (
            <div className="dashboard-activity-grid">
              {activity.map((item) => (
                <div className="dashboard-activity-item" key={item.key}>
                  <span className="dashboard-activity-dot" />
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail ? <span className="muted">{item.detail}</span> : null}
                  </div>
                  <small className="muted">{formatWhen(item.at)}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">Odysseus activity will appear here as your search moves forward.</div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
