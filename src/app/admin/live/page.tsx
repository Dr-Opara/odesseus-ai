import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: "Live — Odesseus Admin" };

const STATUS_TONE: Record<string, string> = {
  active: "readiness-status good",
  ended: "badge",
  prepared: "badge",
  failed: "readiness-status bad",
};

export default async function AdminLivePage() {
  const service = createServiceClient();

  const [{ data: sessions }, { data: applications }, { data: authUsers }] = await Promise.all([
    service
      .from("live_interview_sessions")
      .select("id,user_id,application_id,status,capture_mode,error_message,activated_at,ended_at,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    service.from("applications").select("id,company_name,role_title"),
    service.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const appById = new Map((applications || []).map((app) => [app.id, app]));
  const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));

  const activeCount = (sessions || []).filter((s) => s.status === "active").length;
  const failedCount = (sessions || []).filter((s) => s.status === "failed").length;

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Live</div>
          <h1>Odesseus Live sessions</h1>
          <p className="muted">
            {sessions?.length || 0} sessions · {activeCount} active now · {failedCount} failed
          </p>
        </div>
      </div>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.2fr 1.2fr .8fr .8fr 1.2fr" }}>
          <span>Candidate</span><span>Role</span><span>Status</span><span>Mode</span><span>Timing</span>
        </div>
        {(sessions || []).map((session) => {
          const application = appById.get(session.application_id);
          return (
            <div className="admin-row" key={session.id} style={{ ["--admin-row-cols" as string]: "1.2fr 1.2fr .8fr .8fr 1.2fr" }}>
              <span>{emailById.get(session.user_id) || session.user_id}</span>
              <span>
                <strong>{application?.role_title || "—"}</strong>
                <small>{application?.company_name || "—"}</small>
              </span>
              <span className={STATUS_TONE[session.status] || "badge"}>{session.status}</span>
              <span>{session.capture_mode}</span>
              <span>
                {session.activated_at ? new Date(session.activated_at).toLocaleString() : "Not activated"}
                {session.error_message ? <><br /><small className="wallet-unavailable-note">{session.error_message}</small></> : null}
              </span>
            </div>
          );
        })}
        {!sessions?.length ? <div className="admin-empty">No Live sessions recorded yet.</div> : null}
      </div>
    </main>
  );
}
