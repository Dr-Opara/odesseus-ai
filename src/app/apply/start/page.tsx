import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ApplyStartForm from "@/components/apply-start-form";
import MobileApplyStart from "@/components/mobile/mobile-apply-start";

export default async function ApplyStartPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job: jobId } = await searchParams;
  if (!jobId) redirect("/dashboard");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: job }, { data: credits }, { data: tailoring }] = await Promise.all([
    supabase
      .from("job_opportunities")
      .select("id,company_name,role_title,location,match_score,source_url,status")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_balances")
      .select("wallet_balance_cents,application_credits")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("resume_tailorings")
      .select("id,version_number,status,approved_resume_id")
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!job) redirect("/dashboard");

  return (
    <>
    <main className="shell odesseus-desktop-only" style={{ padding: "54px 0 100px" }}>
      <Link href="/dashboard" className="wordmark">Odesseus</Link>

      <div style={{ width: "min(760px,100%)", margin: "64px auto 0" }}>
        <Link href={`/match/${job.id}`} className="muted" style={{ fontSize: 14 }}>
          ← Back to job
        </Link>

        <div style={{ marginTop: 22 }}>
          <div className="badge">Odesseus Apply</div>
          <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "16px 0 8px" }}>
            Ready to apply?
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, margin: 0 }}>
            {job.role_title} · {job.company_name}
            {job.location ? ` · ${job.location}` : ""}
          </p>
        </div>

        <div className="apply-preflight-grid">
          <div className="card apply-preflight-item">
            <span className="muted">Match</span>
            <strong>{job.match_score ?? "—"}%</strong>
          </div>
          <div className="card apply-preflight-item">
            <span className="muted">Resume</span>
            <strong>{tailoring ? `Approved v${tailoring.version_number}` : "Not approved"}</strong>
          </div>
          <div className="card apply-preflight-item">
            <span className="muted">Wallet</span>
            <strong>${((credits?.wallet_balance_cents ?? 0) / 100).toFixed(2)}</strong>
          </div>
        </div>

        {!tailoring?.approved_resume_id ? (
          <div className="review-note">
            Approve a tailored resume before starting the application.
          </div>
        ) : (credits?.wallet_balance_cents ?? 0) < 1 ? (
          <div className="review-note">
            Your wallet needs funds to start Apply. <Link href="/billing" style={{ fontWeight: 700 }}>Top up</Link>
          </div>
        ) : (
          <ApplyStartForm jobId={job.id} defaultUrl={job.source_url} />
        )}

        <div className="apply-charge-note">
          <strong>No charge when you start.</strong>
          <span>Standard Apply $0.49 and Smart Apply $1.99 are charged only after Odesseus verifies a successful submission.</span>
        </div>
      </div>
    </main>

    <MobileApplyStart
      job={job}
      matchScore={job.match_score}
      approvedVersion={tailoring?.approved_resume_id ? tailoring.version_number : null}
      applicationCredits={credits?.application_credits ?? 0}
    />
    </>
  );
}
