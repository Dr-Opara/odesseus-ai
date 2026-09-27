import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { suspendUser, unsuspendUser } from "../actions";

export const metadata = { title: "User detail — Odesseus Admin" };

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const [{ data: authUser }, { data: profile }, { data: wallet }, { data: transactions }, { data: membership }, { count: applicationCount }] =
    await Promise.all([
      service.auth.admin.getUserById(id),
      service.from("profiles").select("*").eq("id", id).maybeSingle(),
      service.from("credit_balances").select("wallet_balance_cents,interview_passes,live_unlimited_until").eq("user_id", id).maybeSingle(),
      service.from("credit_transactions").select("id,credit_type,delta,amount_cents,reason,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(15),
      (service as any).from("employer_members").select("org_id,role,employer_organizations(name)").eq("user_id", id).maybeSingle(),
      service.from("applications").select("id", { count: "exact", head: true }).eq("user_id", id),
    ]);

  if (!authUser?.user) notFound();

  const bannedUntil = (authUser.user as { banned_until?: string | null }).banned_until || null;
  const suspended = Boolean(bannedUntil && new Date(bannedUntil) > new Date());

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Users</div>
          <h1>{profile?.full_name || authUser.user.email || "User"}</h1>
          <p className="muted">{authUser.user.email}</p>
        </div>
        <div className="admin-badge-row">
          <Link className="btn btn-secondary" href="/admin/users">Back to users</Link>
          <form action={suspended ? unsuspendUser : suspendUser}>
            <input type="hidden" name="user_id" value={id} />
            <button className={suspended ? "btn btn-primary" : "btn btn-secondary"}>
              {suspended ? "Unsuspend account" : "Suspend account"}
            </button>
          </form>
        </div>
      </div>

      <div className="admin-detail-grid">
        <section className="card">
          <h2>Account state</h2>
          <div className="admin-detail-list">
            <div><span className="muted">Status</span><br /><strong>{suspended ? "Suspended" : "Active"}</strong></div>
            <div><span className="muted">Joined</span><br /><strong>{new Date(authUser.user.created_at).toLocaleDateString()}</strong></div>
            <div><span className="muted">Last sign-in</span><br /><strong>{authUser.user.last_sign_in_at ? new Date(authUser.user.last_sign_in_at).toLocaleDateString() : "Never"}</strong></div>
            <div><span className="muted">Onboarding</span><br /><strong>{profile?.onboarding_completed ? "Completed" : "Incomplete"}</strong></div>
          </div>
        </section>

        <section className="card">
          <h2>Role context</h2>
          {membership ? (
            <p>Employer team member — <strong>{membership.role}</strong> at{" "}
              <strong>{membership.employer_organizations?.name || "Unknown organization"}</strong>.
            </p>
          ) : (
            <p className="muted">Candidate account. No employer organization membership.</p>
          )}
          <p className="muted" style={{ marginTop: 10 }}>{applicationCount || 0} application(s) on file.</p>
        </section>

        <section className="card">
          <h2>Wallet</h2>
          <p><strong>{formatCents(wallet?.wallet_balance_cents ?? 0)}</strong> <span className="muted">balance</span></p>
          <p className="muted">{wallet?.interview_passes ?? 0} interview pass(es).</p>
          <Link className="btn btn-secondary" href={`/admin/wallets/${id}`} style={{ marginTop: 10, display: "inline-block" }}>
            View wallet ledger
          </Link>
        </section>

        <section className="card">
          <h2>Profile</h2>
          <div className="admin-detail-list">
            <div><span className="muted">Location</span><br /><strong>{profile?.location || "—"}</strong></div>
            <div><span className="muted">Headline</span><br /><strong>{profile?.headline || "—"}</strong></div>
            <div><span className="muted">Work preference</span><br /><strong>{profile?.work_preference || "—"}</strong></div>
          </div>
        </section>
      </div>

      <section className="card admin-section-card">
        <h2>Recent wallet activity</h2>
        {transactions?.length ? (
          <div className="admin-table">
            <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1fr .6fr .6fr 1.4fr" }}>
              <span>Date</span><span>Type</span><span>Delta</span><span>Reason</span>
            </div>
            {transactions.map((tx) => (
              <div className="admin-row" key={tx.id} style={{ ["--admin-row-cols" as string]: "1fr .6fr .6fr 1.4fr" }}>
                <span>{new Date(tx.created_at).toLocaleString()}</span>
                <span>{tx.credit_type}</span>
                <span>{tx.delta > 0 ? "+" : ""}{tx.delta}</span>
                <span>{tx.reason}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No wallet activity yet.</div>
        )}
      </section>
    </main>
  );
}
