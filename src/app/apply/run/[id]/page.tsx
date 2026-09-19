import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ApplyRunControls from "@/components/apply-run-controls";

const activeStatuses = new Set([
  "queued",
  "preflight",
  "running",
  "needs_user",
  "ready_to_submit",
  "submitting",
]);

function statusCopy(status: string) {
  switch (status) {
    case "queued":
    case "preflight":
      return "Preparing secure browser…";
    case "running":
      return "Odysseus is completing the application.";
    case "needs_user":
      return "Odysseus needs you for a moment.";
    case "ready_to_submit":
      return "Application is ready for your approval.";
    case "submitting":
      return "Submitting application…";
    case "submitted":
      return "Application submitted.";
    case "failed":
      return "This application needs attention.";
    case "cancelled":
      return "Application cancelled.";
    default:
      return "Application run";
  }
}

export default async function ApplyRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: run }, { data: questions }, { data: events }] = await Promise.all([
    supabase
      .from("application_runs")
      .select("*,job_opportunities(company_name,role_title,location)")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("application_run_questions")
      .select("id,question_text,category,status")
      .eq("run_id", id)
      .eq("user_id", userId)
      .eq("status", "needs_user")
      .order("created_at", { ascending: true }),
    supabase
      .from("application_run_events")
      .select("id,event_type,summary,created_at")
      .eq("run_id", id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (!run) notFound();

  const job = run.job_opportunities;
  const isActive = activeStatuses.has(run.status);

  return (
    <main className="shell" style={{ padding: "54px 0 100px" }}>
      <Link href="/dashboard" className="wordmark">Odysseus</Link>

      <div style={{ width: "min(920px,100%)", margin: "58px auto 0" }}>
        <div className="apply-run-heading">
          <div>
            <div className={`apply-status apply-status-${run.status}`}>
              {run.status.replaceAll("_", " ")}
            </div>
            <h1 style={{ fontSize: 42, letterSpacing: "-0.05em", margin: "14px 0 7px" }}>
              {job?.role_title || "Application"}
            </h1>
            <p className="muted" style={{ margin: 0, fontSize: 17 }}>
              {job?.company_name || "Company"}{job?.location ? ` · ${job.location}` : ""}
            </p>
          </div>

          {run.live_view_url && isActive ? (
            <a
              className="btn btn-secondary"
              href={run.live_view_url}
              target="_blank"
              rel="noreferrer"
            >
              Open live browser
            </a>
          ) : null}
        </div>

        <div className="card apply-run-main">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Current state</div>
            <h2 style={{ fontSize: 28, margin: "7px 0 8px" }}>{statusCopy(run.status)}</h2>
            {run.stop_reason ? (
              <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
                {run.stop_reason}
              </p>
            ) : null}
          </div>

          {run.status === "submitted" ? (
            <div className="apply-success-box">
              <strong>Confirmed ✓</strong>
              <span>{run.submission_confirmation || "Employer confirmation detected."}</span>
              <span className="muted">1 application credit was used.</span>
            </div>
          ) : null}

          {run.status === "failed" ? (
            <div className="apply-error">
              No application credit was charged unless submission was already confirmed.
            </div>
          ) : null}

          <ApplyRunControls
            runId={run.id}
            status={run.status}
            questions={questions || []}
          />
        </div>

        {run.status === "needs_user" && run.live_view_url ? (
          <div className="card human-step-card">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Need to take over?</div>
              <h3 style={{ fontSize: 21, margin: "6px 0" }}>Use the live browser.</h3>
              <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                Complete login, MFA, CAPTCHA, identity confirmation, or any other step Odysseus intentionally leaves to you. Then return here and continue.
              </p>
            </div>
            <a
              className="btn btn-secondary"
              href={run.live_view_url}
              target="_blank"
              rel="noreferrer"
            >
              Open browser
            </a>
          </div>
        ) : null}

        <section style={{ marginTop: 28 }}>
          <div className="muted" style={{ fontSize: 13 }}>Activity</div>
          <div className="card apply-timeline">
            {events?.length ? events.map((event, index) => (
              <div
                className="apply-event"
                key={event.id}
                style={{ borderTop: index ? "1px solid var(--line)" : "none" }}
              >
                <div className="apply-event-dot" />
                <div>
                  <strong>{event.summary}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )) : (
              <div className="muted" style={{ padding: 22 }}>Odysseus is preparing the application.</div>
            )}
          </div>
        </section>

        {["submitted", "cancelled"].includes(run.status) ? (
          <div style={{ marginTop: 22 }}>
            <Link className="btn btn-primary" href="/applications">
              View applications
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
