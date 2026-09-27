import { createServiceClient } from "@/lib/supabase/service";
import AdminWalletsTable, { type AdminWalletRow } from "@/components/admin-wallets-table";

export const metadata = { title: "Wallets — Odesseus Admin" };

export default async function AdminWalletsPage() {
  const service = createServiceClient();

  const [{ data: wallets }, { data: authUsers }, { data: profiles }] = await Promise.all([
    service.from("credit_balances").select("user_id,wallet_balance_cents,interview_passes"),
    service.auth.admin.listUsers({ page: 1, perPage: 200 }),
    service.from("profiles").select("id,full_name"),
  ]);

  const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));
  const nameById = new Map((profiles || []).map((p) => [p.id, p.full_name]));

  const rows: AdminWalletRow[] = (wallets || [])
    .map((wallet) => ({
      userId: wallet.user_id,
      email: emailById.get(wallet.user_id) ?? null,
      fullName: nameById.get(wallet.user_id) ?? null,
      walletBalanceCents: wallet.wallet_balance_cents,
      interviewPasses: wallet.interview_passes,
    }))
    .sort((a, b) => b.walletBalanceCents - a.walletBalanceCents);

  const totalCents = rows.reduce((sum, row) => sum + row.walletBalanceCents, 0);

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Wallets</div>
          <h1>Candidate wallets</h1>
          <p className="muted">
            {rows.length} wallet(s) · ${(totalCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} total volume.
          </p>
        </div>
      </div>

      <AdminWalletsTable wallets={rows} />
    </main>
  );
}
