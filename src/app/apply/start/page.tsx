import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { APPLICATION_PRICE_LABEL, applicationsAvailable, canStartApply } from "@/lib/pricing/candidate-pricing";
import ApplyTierAndStart from "@/components/apply/apply-tier-and-start";
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

  const [{ data: job }, { data: balance }, { data: tailoring }] = await Promise.all([
    supabase
      .from("job_opportunities")
      .select("id,company_name,role_title,location,match_score,source_url,status")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_balances")
      .select("application_credits,wallet_balance_cents")
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

  // Eligibility gate: 1 application credit (or the single-credit price in a
  // legacy wallet balance). Balances are read-only for clients; the credit is
  // spent server-side only after a verified successful submission.
  const canApply = canStartApply(balance);
  const available = applicationsAvailable(balance);

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
            <span className="muted">Application credits</span>
            <strong>{available}</strong>
          </div>
        </div>

        {!tailoring?.approved_resume_id ? (
          <div className="review-note">
            Approve a tailored resume before starting the application.
          </div>
        ) : !canApply ? (
          <div className="review-note">
            You need 1 application credit to apply. <Link href="/billing" style={{ fontWeight: 700 }}>Buy credits</Link>
          </div>
        ) : (
          <ApplyTierAndStart jobId={job.id} defaultUrl={job.source_url} canApply={canApply} />
        )}

        <div className="apply-charge-note">
          <strong>No charge when you start.</strong>
          <span>
            One application credit ({APPLICATION_PRICE_LABEL}) is used only after Odesseus verifies a successful
            submission. Failed, unsupported, cancelled or unconfirmed applications use nothing.
          </span>
        </div>
      </div>
    </main>

    <MobileApplyStart
      job={job}
      matchScore={job.match_score}
      approvedVersion={tailoring?.approved_resume_id ? tailoring.version_number : null}
      canApply={canApply}
    />
    </>
  );
}
