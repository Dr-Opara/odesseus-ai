import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";

/**
 * Inbox and calendar reading is retired. Odesseus does not read candidate
 * email or calendars and does not auto-detect interviews. This page remains
 * only so anyone who connected Google earlier can revoke that access.
 */
export default async function GoogleIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ disconnected?: string }>;
}) {
  const { disconnected } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: connection }, { data: profile }, { data: credits }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("status")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase
      .from("credit_balances")
      .select("wallet_balance_cents,interview_passes")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const stillConnected =
    connection?.status === "connected" ||
    connection?.status === "connecting" ||
    connection?.status === "error";

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
      active="profile"
    >
      <section className="shell" style={{ padding: "54px 0 100px" }}>
        <Link href="/profile" className="muted" style={{ fontSize: 14 }}>
          ← Profile
        </Link>

        <div style={{ width: "min(760px,100%)", margin: "20px auto 0" }}>
          <h1 style={{ fontSize: 40, letterSpacing: "-0.04em", margin: "16px 0 8px" }}>
            Odesseus doesn&apos;t read your email.
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, margin: 0 }}>
            Email and calendar sync has been turned off. When you&apos;re invited to interview,
            open the application in Odesseus and start Prep from there.
          </p>

          {disconnected ? (
            <div className="billing-success" style={{ marginTop: 20 }}>
              Google access has been revoked.
            </div>
          ) : null}

          {stillConnected ? (
            <div className="card google-connection-card">
              <div>
                <h2 style={{ fontSize: 22, margin: "0 0 5px" }}>Revoke earlier Google access</h2>
                <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                  You connected Google before sync was turned off. Odesseus no longer uses that
                  access. Disconnect to revoke it.
                </p>
              </div>
              <form action="/api/integrations/google/disconnect" method="post">
                <button className="btn btn-secondary" type="submit">
                  Disconnect Google
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
