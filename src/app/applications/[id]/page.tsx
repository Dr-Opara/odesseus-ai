import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ApplicationStatusForm from "@/components/application-status-form";
import { statusLabel } from "@/lib/applications/status";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: application }, { data: events }, { data: interviews }] = await Promise.all([
    supabase
      .from("applications")
      .select("*,job_opportunities(match_score,location),resumes(file_name)")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("application_status_events")
      .select("id,event_type,title,detail,source,from_status,to_status,occurred_at")
      .eq("application_id", id)
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("interviews")
      .select("id,stage,scheduled_at,status,meeting_provider")
      .eq("application_id", id)
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: true }),
  ]);

  if (!application) notFound();

  const matchScore =
    application.match_score_snapshot ??
    application.job_opportunities?.match_score ??
    null;

  return (
    <main className="shell" style={{ padding: "54px 0 100px" }}>
      <Link href="/applications" className="muted" style={{ fontSize: 14 }}>
        ← Applications
      </Link>

      <div className="track-detail-heading">
        <div>
          <div className="track-status-pill">{statusLabel(application.status)}</div>
          <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "14px 0 7px" }}>
            {application.role_title}
          </h1>
          <p className="muted" style={{ fontSize: 18, margin: 0 }}>
            {application.company_name}
            {application.job_opportunities?.location
              ? ` · ${application.job_opportunities.location}`
              : ""}
          </p>
        </div>

        {application.application_url ? (
          <a
            className="btn btn-secondary"
            href={application.application_url}
            target="_blank"
            rel="noreferrer"
          >
            Open job page
          </a>
        ) : null}
      </div>

      <div className="track-summary-grid">
        <div className="card track-summary-card">
          <span className="muted">Match</span>
          <strong>{matchScore ?? "—"}{matchScore !== null ? "%" : ""}</strong>
        </div>
        <div className="card track-summary-card">
          <span className="muted">Applied</span>
          <strong>
            {application.submitted_at
              ? new Date(application.submitted_at).toLocaleDateString()
              : "Not yet"}
          </strong>
        </div>
        <div className="card track-summary-card">
          <span className="muted">Resume</span>
          <strong>{application.resumes?.file_name || "Saved"}</strong>
        </div>
      </div>

      {interviews?.length ? (
        <div className="card track-interview-card">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Interview</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 5px" }}>
              {interviews[0].stage || "Interview scheduled"}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {interviews[0].scheduled_at
                ? new Date(interviews[0].scheduled_at).toLocaleString()
                : "Time pending"}
              {interviews[0].meeting_provider
                ? ` · ${interviews[0].meeting_provider}`
                : ""}
            </p>
          </div>
          <Link href="/interviews" className="btn btn-secondary">
            Open interview
          </Link>
        </div>
      ) : null}

      <div className="track-detail-grid">
        <section>
          <div className="muted" style={{ fontSize: 13 }}>Timeline</div>
          <h2 style={{ fontSize: 27, margin: "7px 0 14px" }}>Everything that happened.</h2>

          <div className="card track-timeline">
            {events?.length ? (
              events.map((event, index) => (
                <div
                  className="track-event"
                  key={event.id}
                  style={{ borderTop: index ? "1px solid var(--line)" : "none" }}
                >
                  <div className="track-event-dot" />
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{event.title}</strong>
                      <span className="muted track-source">{event.source}</span>
                    </div>
                    {event.detail ? (
                      <p className="muted" style={{ margin: "5px 0 0", lineHeight: 1.55 }}>
                        {event.detail}
                      </p>
                    ) : null}
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {new Date(event.occurred_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="muted" style={{ padding: 24 }}>No timeline events yet.</div>
            )}
          </div>
        </section>

        <aside>
          <ApplicationStatusForm
            applicationId={application.id}
            currentStatus={application.status}
          />

          <div className="card track-context-card">
            <div className="muted" style={{ fontSize: 13 }}>Frozen application context</div>
            <h3 style={{ margin: "8px 0 8px" }}>What Odysseus remembers</h3>
            <p className="muted" style={{ lineHeight: 1.55, margin: 0 }}>
              The exact job and approved resume used for this application stay attached to this record even if your profile changes later.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
