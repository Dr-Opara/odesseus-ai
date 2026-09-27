import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import MobileInterviews from "@/components/mobile/mobile-interviews";

export default async function InterviewsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: interviews }, { data: profile }, { data: credits }] = await Promise.all([
    supabase
      .from("interviews")
      .select("id,stage,scheduled_at,status,meeting_provider,source,readiness_generated_at,applications(company_name,role_title)")
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: true }),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.from("credit_balances").select("wallet_balance_cents,interview_passes").eq("user_id", userId).maybeSingle(),
  ]);

  const upcoming =
    interviews?.filter((item) =>
      ["invited", "scheduled", "ready", "live"].includes(item.status)
    ) || [];

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="interviews"
    >
      <section className="shell odesseus-desktop-only" style={{ padding: "54px 0 90px" }}>
      <div style={{ width: "min(820px,100%)", margin: "30px auto 0" }}>
        <div className="muted" style={{ fontSize: 14 }}>Interviews</div>
        <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "10px 0 6px" }}>
          Your interview workspace.
        </h1>
        <p className="muted" style={{ fontSize: 18, lineHeight: 1.6 }}>
          Every interview stays connected to the exact application, submitted resume, and job context.
        </p>

        {upcoming.length ? (
          <div className="interview-list">
            {upcoming.map((interview) => (
              <Link
                className="card interview-list-card"
                href={`/interviews/${interview.id}`}
                key={interview.id}
              >
                <div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {interview.stage || "Interview"}
                  </div>
                  <h2 style={{ fontSize: 24, margin: "7px 0 5px" }}>
                    {interview.applications?.role_title || "Role"}
                  </h2>
                  <div className="muted">
                    {interview.applications?.company_name || "Company"}
                  </div>
                </div>

                <div className="interview-list-meta">
                  <strong>
                    {interview.scheduled_at
                      ? new Date(interview.scheduled_at).toLocaleString()
                      : "Time pending"}
                  </strong>
                  <span className="muted">
                    {interview.meeting_provider || "Platform pending"}
                  </span>
                  <span className={interview.readiness_generated_at ? "badge" : "track-status-pill"}>
                    {interview.readiness_generated_at ? "Prepared" : "Prepare"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: 34, marginTop: 30 }}>
            <div className="badge">Nothing scheduled</div>
            <h2 style={{ fontSize: 32, margin: "18px 0 8px" }}>
              Your interview workspace will appear here.
            </h2>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              When Odesseus detects an interview for a tracked application, it will connect the job, submitted resume, and application history automatically.
            </p>
          </div>
        )}
      </div>
      </section>

      <MobileInterviews upcoming={upcoming} />
    </AppShell>
  );
}
