import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import AdminWalletAdjustForm from "@/components/admin-wallet-adjust-form";

export const metadata = { title: "Wallet detail — Odesseus Admin" };

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminWalletDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const [{ data: authUser }, { data: wallet }, { data: transactions }] = await Promise.all([
    service.auth.admin.getUserById(id),
    service.from("credit_balances").select("wallet_balance_cents,interview_passes,live_unlimited_until").eq("user_id", id).maybeSingle(),
    service.from("credit_transactions").select("id,credit_type,delta,amount_cents,reason,external_reference,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
  ]);

  if (!authUser?.user) notFound();

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Wallets</div>
          <h1>{authUser.user.email}</h1>
          <p className="muted">Full transaction ledger for this account.</p>
        </div>
        <Link className="btn btn-secondary" href="/admin/wallets">Back to wallets</Link>
      </div>

      <div className="admin-detail-grid">
        <section className="card">
          <h2>Balances</h2>
          <p><strong>{formatCents(wallet?.wallet_balance_cents ?? 0)}</strong> <span className="muted">wallet balance</span></p>
          <p className="muted">{wallet?.interview_passes ?? 0} interview pass(es) remaining.</p>
        </section>

        <section className="card">
          <h2>Adjust balance</h2>
          <p className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
            Every adjustment requires a reason for the audit trail.
          </p>
          <AdminWalletAdjustForm userId={id} />
        </section>
      </div>

      <section className="card admin-section-card">
        <h2>Transaction history</h2>
        {transactions?.length ? (
          <div className="admin-table">
            <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1fr .6fr .6fr .6fr 1.4fr" }}>
              <span>Date</span><span>Type</span><span>Delta</span><span>Amount</span><span>Reason</span>
            </div>
            {transactions.map((tx) => (
              <div className="admin-row" key={tx.id} style={{ ["--admin-row-cols" as string]: "1fr .6fr .6fr .6fr 1.4fr" }}>
                <span>{new Date(tx.created_at).toLocaleString()}</span>
                <span>{tx.credit_type}</span>
                <span>{tx.delta > 0 ? "+" : ""}{tx.delta}</span>
                <span>{tx.amount_cents != null ? formatCents(tx.amount_cents) : "—"}</span>
                <span>{tx.reason}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No transactions recorded for this account.</div>
        )}
      </section>
    </main>
  );
}
