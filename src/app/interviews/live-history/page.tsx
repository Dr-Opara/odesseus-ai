import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import MobileScreen from "@/components/mobile/mobile-screen";
import { formatWhen } from "@/app/dashboard/page";

export default async function LiveHistoryPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: sessions }, { data: profile }, { data: credits }] = await Promise.all([
    supabase
      .from("live_interview_sessions")
      .select("*,interviews(id,stage,scheduled_at,meeting_provider,applications(company_name,role_title))")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase.from("credit_balances").select("wallet_balance_cents,interview_passes").eq("user_id", userId).maybeSingle(),
  ]);

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="interviews"
    >
      <section className="shell odesseus-desktop-only" style={{ padding: "54px 0 100px" }}>
      <div style={{ width: "min(820px,100%)", margin: "30px auto 0" }}>
        <Link href="/interviews" className="muted" style={{ fontSize: 14 }}>
          ← Interviews
        </Link>

        <div className="muted" style={{ fontSize: 14, marginTop: 30 }}>Odesseus Live</div>
        <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "10px 0 6px" }}>
          Live session history
        </h1>
        <p className="muted" style={{ fontSize: 18, lineHeight: 1.6 }}>
          Every completed Live session, its transcript status, and the interview it was linked to.
        </p>

        {sessions?.length ? (
          <div className="live-history-list">
            {sessions.map((session) => {
              const interview = session.interviews;
              const isActive = session.status === "active" || session.status === "prepared";
              const isEnded = session.status === "ended";
              const hasAnalysis = isEnded; // We'll check for analysis separately if needed

              return (
                <Link
                  className="card live-history-card"
                  href={isEnded ? `/interviews/${interview?.id}/analysis` : `/interviews/${interview?.id}/live`}
                  key={session.id}
                >
                  <div className="live-history-main">
                    <div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {interview?.stage || "Interview"}
                      </div>
                      <h2 style={{ fontSize: 24, margin: "7px 0 5px" }}>
                        {interview?.applications?.role_title || "Role"}
                      </h2>
                      <div className="muted">
                        {interview?.applications?.company_name || "Company"}
                      </div>
                    </div>

                    <div className="live-history-meta">
                      <strong>
                        {session.ended_at
                          ? new Date(session.ended_at).toLocaleString()
                          : session.activated_at
                          ? new Date(session.activated_at).toLocaleString()
                          : new Date(session.created_at).toLocaleString()}
                      </strong>
                      <span className="muted">
                        {interview?.meeting_provider || "Platform pending"}
                      </span>
                      <span
                        className={
                          session.status === "ended"
                            ? "badge"
                            : session.status === "active"
                            ? "track-status-pill"
                            : "track-status-pill"
                        }
                      >
                        {session.status === "ended"
                          ? "Completed"
                          : session.status === "active"
                          ? "Active"
                          : session.status === "prepared"
                          ? "Prepared"
                          : session.status === "failed"
                          ? "Failed"
                          : "Ended"}
                      </span>
                    </div>
                  </div>

                  <div className="live-history-details">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Session {session.id.slice(0, 8)} ·{" "}
                      {session.capture_mode?.replace("_", " ") || "shared audio"}
                    </div>
                    {isEnded && (
                      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                        {hasAnalysis
                          ? "Analysis available →"
                          : "Transcript ready for analysis →"}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ padding: 34, marginTop: 30 }}>
            <div className="badge">No Live sessions yet</div>
            <h2 style={{ fontSize: 32, margin: "18px 0 8px" }}>
              Your Live history will appear here.
            </h2>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              When you complete an Odesseus Live session, it will be listed here with a link
              to the transcript and post-interview analysis.
            </p>
          </div>
        )}
      </div>
      </section>

      <MobileScreen index="11" title="Prep Agent" nav>
        <div className="m-section">
          <div className="m-section-heading">
            <h2>Live session history</h2>
          </div>
          {sessions?.length ? (
            sessions.map((session) => {
              const interview = session.interviews;
              const isEnded = session.status === "ended";
              return (
                <Link
                  className="m-card"
                  key={session.id}
                  href={isEnded ? `/interviews/${interview?.id}/analysis` : `/interviews/${interview?.id}/live`}
                >
                  <span className="m-icon">✦</span>
                  <span className="m-copy">
                    <strong>{interview?.applications?.role_title || "Interview"}</strong>
                    <small>{interview?.applications?.company_name || "Company"}</small>
                  </span>
                  <b className="m-tag">
                    {session.status === "ended"
                      ? "Completed"
                      : session.status === "active"
                      ? "Active"
                      : session.status === "prepared"
                      ? "Prepared"
                      : session.status === "failed"
                      ? "Failed"
                      : "Ended"}
                  </b>
                </Link>
              );
            })
          ) : (
            <div className="m-empty">
              When you complete an Odesseus Live session, it will be listed here with a link
              to the transcript and post-interview analysis.
            </div>
          )}
        </div>
      </MobileScreen>
    </AppShell>
  );
}