import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ApplyStartForm from "@/components/apply-start-form";

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

  const [{ data: job }, { data: wallet }, { data: credits }, { data: tailoring }, { data: masterResume }] = await Promise.all([
    supabase
      .from("job_opportunities")
      .select("id,company_name,role_title,location,match_score,source_url,status")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_balances")
      .select("application_credits")
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
    <main className="shell" style={{ padding: "54px 0 100px" }}>
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
          <div className="card apply-preflight-item"><span className="muted">Match</span><strong>{job.match_score ?? "—"}%</strong></div>
          <div className="card apply-preflight-item"><span className="muted">Smart resume</span><strong>{tailoring ? `Approved v${tailoring.version_number}` : "Not approved"}</strong></div>
          <div className="card apply-preflight-item"><span className="muted">Wallet</span><strong>${((wallet?.balance_cents ?? 0) / 100).toFixed(2)}</strong></div>
        </div>

        <div className="figma-two-grid" style={{ marginTop: 24 }}>
          <section className="card" style={{ padding: 24 }}>
            <div className="badge">Apply · $0.49</div>
            <h2>Use your approved master resume</h2>
            <p className="muted">Odesseus completes the repetitive application flow using your verified profile and existing resume. No resume rewrite.</p>
            {!masterResume?.id ? <div className="review-note">Approve a master resume to use Apply.</div> :
              (wallet?.balance_cents ?? 0) < 49 && (credits?.application_credits ?? 0) < 1 ?
              <div className="review-note">Add funds to your <Link href="/billing" style={{fontWeight:700}}>Odesseus wallet</Link>.</div> :
              <ApplyStartForm jobId={job.id} defaultUrl={job.source_url} mode="apply" />}
          </section>

          <section className="card" style={{ padding: 24 }}>
            <div className="badge">Smart Apply · $1.99</div>
            <h2>Tailor before Odesseus submits</h2>
            <p className="muted">Uses your approved tailored resume, job-specific context, application answers, and automated submission.</p>
            {!tailoring?.approved_resume_id ? <div className="review-note">Approve a tailored resume to use Smart Apply.</div> :
              (wallet?.balance_cents ?? 0) < 199 && (credits?.application_credits ?? 0) < 1 ?
              <div className="review-note">Add funds to your <Link href="/billing" style={{fontWeight:700}}>Odesseus wallet</Link>.</div> :
              <ApplyStartForm jobId={job.id} defaultUrl={job.source_url} mode="smart_apply" />}
          </section>
        </div>

        <div className="apply-charge-note">
          <strong>Nothing is deducted when the secure browser starts.</strong>
          <span>Odesseus deducts $0.49 for Apply or $1.99 for Smart Apply only after it verifies a successful submission. Existing legacy application credits remain usable during migration.</span>
        </div>
      </div>
    </main>
  );
}
