import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: "Application run detail — Odesseus Admin" };

export default async function AdminApplicationRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: run } = await service.from("application_runs").select("*").eq("id", id).maybeSingle();
  if (!run) notFound();

  const [{ data: job }, { data: authUser }, { data: events }, { data: relatedApplication }] = await Promise.all([
    service.from("job_opportunities").select("company_name,role_title,status").eq("id", run.job_id).maybeSingle(),
    service.auth.admin.getUserById(run.user_id),
    service.from("application_run_events").select("id,event_type,summary,created_at,metadata").eq("run_id", id).order("created_at", { ascending: true }),
    service.from("applications").select("id,status,submitted_at").eq("user_id", run.user_id).eq("job_id", run.job_id).maybeSingle(),
  ]);

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Applications</div>
          <h1>{job?.role_title || "Application run"}</h1>
          <p className="muted">{job?.company_name} · {authUser?.user?.email}</p>
        </div>
        <Link className="btn btn-secondary" href="/admin/applications">Back to applications</Link>
      </div>

      <div className="admin-detail-grid">
        <section className="card">
          <h2>Run state</h2>
          <div className="admin-detail-list">
            <div><span className="muted">Tier</span><br /><strong>{run.execution_mode === "smart" ? "Smart Apply" : "Standard Apply"}</strong></div>
            <div><span className="muted">Status</span><br /><strong>{run.status.replace(/_/g, " ")}</strong></div>
            <div><span className="muted">Started</span><br /><strong>{run.started_at ? new Date(run.started_at).toLocaleString() : "Not started"}</strong></div>
            <div><span className="muted">Finished</span><br /><strong>{run.finished_at ? new Date(run.finished_at).toLocaleString() : "—"}</strong></div>
          </div>
          {run.stop_reason ? (
            <p className="wallet-unavailable-note" style={{ marginTop: 12 }}>Stop reason: {run.stop_reason}</p>
          ) : null}
          {run.status === "failed" ? (
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              No automated retry exists yet for failed runs — recovery today means the candidate starts a new Apply run.
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2>Finalized application</h2>
          {relatedApplication ? (
            <>
              <p><strong>{relatedApplication.status}</strong></p>
              <p className="muted">Submitted {relatedApplication.submitted_at ? new Date(relatedApplication.submitted_at).toLocaleString() : "—"}</p>
            </>
          ) : (
            <p className="muted">This run has not produced a finalized application record.</p>
          )}
        </section>
      </div>

      <section className="card admin-section-card">
        <h2>Run event timeline</h2>
        {events?.length ? (
          <div className="admin-table">
            {events.map((event) => (
              <div className="admin-row" key={event.id} style={{ ["--admin-row-cols" as string]: "1fr .8fr 2fr" }}>
                <span>{new Date(event.created_at).toLocaleString()}</span>
                <span>{event.event_type}</span>
                <span>{event.summary}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No events recorded for this run.</div>
        )}
      </section>
    </main>
  );
}
