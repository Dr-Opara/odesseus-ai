import { redirect } from "next/navigation";
import Link from "next/link";
import ProfileForm from "@/components/profile-form";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import MobileProfile from "@/components/mobile/mobile-profile";
import { deleteResume } from "@/app/actions/account";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { status, error } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : null;
  if (!userId) redirect("/login");

  const [
    { data: profile },
    { data: credits },
    { data: resumes },
    { count: applicationCount },
    { count: interviewCount },
    { count: savedJobCount },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name,headline,location,work_preference")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("credit_balances").select("application_credits,interview_passes").eq("user_id", userId).maybeSingle(),
    supabase
      .from("resumes")
      .select("id,file_name,is_master,is_approved,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("interviews").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("job_opportunities").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "saved"),
  ]);

  return (
    <AppShell
      fullName={profile?.full_name}
      applicationCredits={credits?.application_credits ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="profile"
    >
      <section className="shell odesseus-desktop-only" style={{ padding: "54px 0 90px" }}>
      <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
        <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", marginBottom: 10 }}>Profile</h1>
        <p className="muted">The verified information Odesseus uses on your behalf.</p>

        {status === "resume_deleted" ? (
          <div className="billing-success" style={{ marginTop: 18 }}>Resume deleted.</div>
        ) : null}
        {error ? (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: "#fff1ef" }}>{error}</div>
        ) : null}

        <ProfileForm userId={userId} initial={profile} />

        <div className="card" style={{ padding: 26, marginTop: 24 }}>
          <div className="muted" style={{ fontSize: 13 }}>Resumes</div>
          <h2 style={{ fontSize: 22, margin: "7px 0 16px" }}>Uploaded resumes</h2>
          {resumes?.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {resumes.map((resume) => (
                <div
                  key={resume.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "10px 0", borderTop: "1px solid var(--line)" }}
                >
                  <div>
                    <strong>{resume.file_name}</strong>
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      {resume.is_master ? "Master resume · " : ""}
                      {resume.is_approved ? "Approved · " : ""}
                      {new Date(resume.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <form action={deleteResume}>
                    <input type="hidden" name="resumeId" value={resume.id} />
                    <button type="submit" className="account-menu-logout" style={{ width: "auto", padding: "8px 14px", border: "1px solid var(--line)" }}>
                      Delete
                    </button>
                  </form>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No resumes uploaded yet.</p>
          )}
        </div>

        <div className="card profile-integration-card">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Integrations</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 6px" }}>Email + Calendar</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
              Let Odesseus detect employer responses, assessments, interview invitations, and scheduled interviews.
            </p>
          </div>
          <Link href="/integrations" className="btn btn-secondary">
            Manage Google
          </Link>
        </div>
      </div>
      </section>

      <MobileProfile
        fullName={profile?.full_name ?? null}
        email={email}
        applicationCount={applicationCount ?? 0}
        interviewCount={interviewCount ?? 0}
        savedJobCount={savedJobCount ?? 0}
      />
    </AppShell>
  );
}
