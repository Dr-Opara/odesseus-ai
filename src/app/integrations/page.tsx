import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import { disconnectIntegration } from "@/app/actions/account";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; disconnected?: string }>;
}) {
  const { error, disconnected } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: accounts }, { data: profile }, { data: credits }] =
    await Promise.all([
      supabase
        .from("integration_accounts")
        .select("id,service_type,provider,account_email,status")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      supabase
        .from("credit_balances")
        .select("wallet_balance_cents,interview_passes")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
    >
      <section className="shell" style={{ padding: "54px 0 100px" }}>
        <Link href="/profile" className="muted" style={{ fontSize: 14 }}>
          ← Profile
        </Link>

        <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
          <div className="badge">Integrations</div>
          <h1
            style={{
              fontSize: 42,
              letterSpacing: "-0.05em",
              margin: "16px 0 8px",
            }}
          >
            Odesseus never reads your inbox.
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 640 }}>
            Google and email sign-in are used only to verify who you are.
            Odesseus does not connect to, scan, or monitor your email or
            calendar. Track interviews and application updates directly in
            your Odesseus dashboard instead.
          </p>

          {error ? (
            <div className="apply-error" style={{ marginTop: 18 }}>
              {error}
            </div>
          ) : null}

          {disconnected ? (
            <div className="billing-success" style={{ marginTop: 18 }}>
              Account disconnected.
            </div>
          ) : null}

          {accounts && accounts.length > 0 ? (
            <section className="integration-section" style={{ marginTop: 32 }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Legacy connections</div>
                <h2 style={{ fontSize: 24, margin: "7px 0 6px" }}>
                  Previously connected accounts
                </h2>
                <p className="muted" style={{ margin: 0 }}>
                  These accounts were connected before Odesseus retired inbox
                  monitoring. They are no longer synced. Disconnect to revoke
                  access.
                </p>
              </div>

              <div className="integration-account-list">
                {accounts.map((account) => (
                  <div className="card integration-account-row" key={account.id}>
                    <div>
                      <strong>{account.provider}</strong>
                      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                        {account.account_email || account.service_type}
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      no longer synced
                    </div>
                    <form action={disconnectIntegration}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <button
                        type="submit"
                        className="account-menu-logout"
                        style={{ width: "auto", padding: "8px 14px", border: "1px solid var(--line)" }}
                      >
                        Disconnect
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
