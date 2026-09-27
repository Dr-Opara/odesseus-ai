import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OdesseusLiveClient from "@/components/odesseus-live-client";
import AppShell from "@/components/app-shell";

export default async function OdesseusLivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: interview }, { data: credits }, { data: liveSession }, { data: profile }] =
    await Promise.all([
      supabase
        .from("interviews")
        .select("id,stage,scheduled_at,meeting_provider,status,applications(company_name,role_title)")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("credit_balances")
        .select("wallet_balance_cents,interview_passes")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("live_interview_sessions")
        .select("id,status,activated_at,ended_at")
        .eq("interview_id", id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ]);

  if (!interview) notFound();

  if (liveSession?.status === "ended") {
    redirect(`/interviews/${id}?live=completed`);
  }

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="interviews"
    >
      <section className="shell" style={{ padding: "36px 0 90px" }}>
      <div className="live-page-heading">
        <div>
          <Link href={`/interviews/${id}`} className="muted" style={{ fontSize: 14 }}>
            ← Interview workspace
          </Link>

          <div style={{ marginTop: 16 }} className="badge">
            Odesseus Live
          </div>

          <h1
            style={{
              fontSize: 42,
              letterSpacing: "-0.05em",
              margin: "14px 0 6px",
            }}
          >
            {interview.applications?.role_title || "Interview"}
          </h1>

          <p className="muted" style={{ margin: 0 }}>
            {interview.applications?.company_name || "Company"}
            {interview.stage ? ` · ${interview.stage}` : ""}
          </p>
        </div>

        <div className="live-meeting-meta">
          <span>
            {interview.scheduled_at
              ? new Date(interview.scheduled_at).toLocaleString()
              : "Time pending"}
          </span>
          <span className="muted">
            {interview.meeting_provider || "Meeting platform pending"}
          </span>
        </div>
      </div>

      <div className="live-boundary-note">
        <strong>You remain the interviewee.</strong>
        <span>
          Odesseus listens only after you start it, shows private on-screen guidance,
          and never joins the meeting or speaks for you.
        </span>
      </div>

      <OdesseusLiveClient
        interviewId={interview.id}
        interviewPasses={credits?.interview_passes ?? 0}
      />
      </section>
    </AppShell>
  );
}
