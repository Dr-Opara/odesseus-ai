import Link from "next/link";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/profile-form";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name,headline,location,work_preference")
    .eq("id", userId)
    .maybeSingle();

  return (
    <main className="shell" style={{ padding: "54px 0 90px" }}>
      <Link href="/dashboard" className="wordmark">Odysseus</Link>
      <div style={{ width: "min(760px,100%)", margin: "60px auto 0" }}>
        <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", marginBottom: 10 }}>Profile</h1>
        <p className="muted">The verified information Odysseus uses on your behalf.</p>
        <ProfileForm userId={userId} initial={profile} />

        <div className="card profile-integration-card">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Integrations</div>
            <h2 style={{ fontSize: 22, margin: "7px 0 6px" }}>Email + Calendar</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
              Let Odysseus detect employer responses, assessments, interview invitations, and scheduled interviews.
            </p>
          </div>
          <Link href="/integrations" className="btn btn-secondary">
            Manage Google
          </Link>
        </div>
      </div>
    </main>
  );
}
