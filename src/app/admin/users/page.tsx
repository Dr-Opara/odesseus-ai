import { createServiceClient } from "@/lib/supabase/service";
import AdminUsersTable, { type AdminUserRow } from "@/components/admin-users-table";

export const metadata = { title: "Users — Odesseus Admin" };

export default async function AdminUsersPage() {
  const service = createServiceClient();

  const [{ data: authUsers }, { data: profiles }, { data: wallets }, { data: members }, { data: orgs }] =
    await Promise.all([
      service.auth.admin.listUsers({ page: 1, perPage: 200 }),
      service.from("profiles").select("id,full_name,onboarding_completed,created_at"),
      service.from("credit_balances").select("user_id,wallet_balance_cents"),
      // partner-program tables are not yet in the generated Database types, hence `as any` here mirrors
      // the existing pattern in src/lib/partners/service.ts.
      (service as any).from("employer_members").select("user_id,org_id,role"),
      (service as any).from("employer_organizations").select("id,name"),
    ]);

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  const walletByUser = new Map((wallets || []).map((w) => [w.user_id, w.wallet_balance_cents]));
  const orgById = new Map(((orgs || []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const memberByUser = new Map(
    ((members || []) as { user_id: string; org_id: string; role: string }[]).map((m) => [m.user_id, m])
  );

  const rows: AdminUserRow[] = (authUsers?.users || []).map((user) => {
    const profile = profileById.get(user.id);
    const membership = memberByUser.get(user.id);
    return {
      id: user.id,
      email: user.email || null,
      createdAt: user.created_at,
      bannedUntil: (user as { banned_until?: string | null }).banned_until || null,
      fullName: profile?.full_name || null,
      onboardingCompleted: profile?.onboarding_completed ?? false,
      walletBalanceCents: walletByUser.get(user.id) ?? 0,
      employerRole: membership?.role || null,
      employerOrgName: membership ? orgById.get(membership.org_id) || "Unknown org" : null,
    };
  });

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Users</div>
          <h1>User accounts</h1>
          <p className="muted">
            {rows.length} accounts loaded. Search by name, email, or employer organization.
          </p>
        </div>
      </div>

      <AdminUsersTable users={rows} />
    </main>
  );
}
