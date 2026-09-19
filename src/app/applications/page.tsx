import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { statusLabel } from "@/lib/applications/status";

const filterStatuses = [
  ["all", "All"],
  ["applied", "Applied"],
  ["employer_response", "Response"],
  ["assessment", "Assessment"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
] as const;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status = "all", q = "" } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  let query = supabase
    .from("applications")
    .select("id,company_name,role_title,status,last_event_at,submitted_at,match_score_snapshot,job_opportunities(match_score)")
    .eq("user_id", userId)
    .order("last_event_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);
  if (q.trim()) {
    query = query.or(
      `company_name.ilike.%${q.trim()}%,role_title.ilike.%${q.trim()}%`
    );
  }

  const { data: applications } = await query;

  return (
    <main className="shell" style={{ padding: "54px 0 90px" }}>
      <Link href="/dashboard" className="wordmark">Odysseus</Link>

      <div className="page-heading" style={{ marginTop: 52 }}>
        <div>
          <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: 0 }}>Applications</h1>
          <p className="muted">Everything you have in motion.</p>
        </div>
        <Link className="btn btn-primary" href="/match">Check a job</Link>
      </div>

      <form className="track-toolbar">
        <input
          className="input"
          name="q"
          defaultValue={q}
          placeholder="Search company or role"
        />
        <select className="input" name="status" defaultValue={status}>
          {filterStatuses.map(([value, label]) => (
            <option value={value} key={value}>{label}</option>
          ))}
        </select>
        <button className="btn btn-secondary" type="submit">Filter</button>
      </form>

      <div className="card track-list">
        {applications?.length ? (
          applications.map((application, index) => {
            const score =
              application.match_score_snapshot ??
              application.job_opportunities?.match_score ??
              null;

            return (
              <Link
                href={`/applications/${application.id}`}
                key={application.id}
                className="track-list-row"
                style={{ borderTop: index ? "1px solid var(--line)" : "none" }}
              >
                <div>
                  <strong>{application.company_name}</strong>
                  <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                    {application.role_title}
                  </div>
                </div>
                <div className="muted track-list-meta">
                  {score !== null ? `${score}% match` : "Match saved"}
                </div>
                <div className="muted track-list-meta">
                  {application.submitted_at
                    ? new Date(application.submitted_at).toLocaleDateString()
                    : "Not submitted"}
                </div>
                <div className="track-status-pill">
                  {statusLabel(application.status)}
                </div>
              </Link>
            );
          })
        ) : (
          <div style={{ padding: 34 }}>
            <div className="badge">No applications here</div>
            <h2 style={{ fontSize: 28, margin: "18px 0 8px" }}>
              Your pipeline stays simple.
            </h2>
            <p className="muted" style={{ maxWidth: 540, lineHeight: 1.6 }}>
              Applications appear here after submission and stay connected to their exact job, resume, employer responses, and interviews.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
