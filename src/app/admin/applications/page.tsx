import { createServiceClient } from "@/lib/supabase/service";
import AdminApplicationsTable, { type AdminApplicationRunRow } from "@/components/admin-applications-table";

export const metadata = { title: "Applications — Odesseus Admin" };

export default async function AdminApplicationsPage() {
  const service = createServiceClient();

  const [{ data: runs }, { data: jobs }, { data: authUsers }] = await Promise.all([
    service
      .from("application_runs")
      .select("id,user_id,job_id,execution_mode,status,stop_reason,created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    service.from("job_opportunities").select("id,company_name,role_title"),
    service.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const jobById = new Map((jobs || []).map((job) => [job.id, job]));
  const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));

  const rows: AdminApplicationRunRow[] = (runs || []).map((run) => {
    const job = jobById.get(run.job_id);
    return {
      id: run.id,
      userEmail: emailById.get(run.user_id) ?? null,
      companyName: job?.company_name ?? null,
      roleTitle: job?.role_title ?? null,
      executionMode: run.execution_mode,
      status: run.status,
      stopReason: run.stop_reason,
      createdAt: run.created_at,
    };
  });

  const failedCount = rows.filter((r) => r.status === "failed").length;
  const smartCount = rows.filter((r) => r.executionMode === "smart").length;

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Applications</div>
          <h1>Application runs</h1>
          <p className="muted">
            {rows.length} runs · {smartCount} Smart Apply · {failedCount} failed
          </p>
        </div>
      </div>

      <AdminApplicationsTable runs={rows} />
    </main>
  );
}
