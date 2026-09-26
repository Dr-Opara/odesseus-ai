import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import WalletPanel from "@/components/wallet/wallet-panel";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { status, error } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: credits }, { data: transactions }, { data: annualPurchases }, { data: profile }] = await Promise.all([
    supabase
      .from("credit_balances")
      .select("wallet_balance_cents,interview_passes,live_unlimited_until")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_transactions")
      .select("id,credit_type,delta,reason,amount_cents,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    // Odesseus Live Annual is a time-boxed entitlement, not a discrete
    // credit grant — it never writes a credit_transactions row (see
    // add_live_annual_entitlement migration), so without this it would
    // never appear in "Recent activity" despite being a real purchase.
    supabase
      .from("billing_events")
      .select("id,amount_cents,created_at")
      .eq("user_id", userId)
      .eq("sku", "interview_annual")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  // Only Live purchases appear in billing history. Legacy `application`
  // credit_transactions rows are historical facts about a currency that is no
  // longer valid, so listing them next to wallet top-ups would imply they
  // still buy something.
  const activity = [
    ...(transactions ?? [])
      .filter((t) => t.credit_type !== "application")
      .map((t) => ({
        id: `credit:${t.id}`,
        createdAt: t.created_at,
        label: `${t.delta > 0 ? "Purchased" : "Used"} ${Math.abs(t.delta)} interview ${
          Math.abs(t.delta) === 1 ? "pass" : "passes"
        }`,
        amountText: t.delta > 0 && t.amount_cents ? `$${(t.amount_cents / 100).toFixed(2)}` : null,
        deltaText: `${t.delta > 0 ? "+" : ""}${t.delta}`,
      })),
    ...(annualPurchases ?? []).map((purchase) => ({
      id: `annual:${purchase.id}`,
      createdAt: purchase.created_at,
      label: "Purchased Odesseus Live Annual",
      amountText: `$${(purchase.amount_cents / 100).toFixed(2)}`,
      deltaText: "12 mo",
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <AppShell
      fullName={profile?.full_name}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
    >
      <section className="shell" style={{ padding: "54px 0 100px" }}>
      <div style={{ width: "min(980px,100%)", margin: "20px auto 0" }}>
        <div>
          <div className="badge">Billing</div>
          <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "16px 0 8px" }}>
            Pay for progress, not access.
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 650 }}>
            No subscription. Pay when Odesseus works for you.
          </p>
        </div>

        {status === "success" ? (
          <div className="billing-success">
            Payment received. Your balance will update as soon as Stripe confirms the purchase.
          </div>
        ) : null}

        {status === "cancelled" ? (
          <div className="review-note">Checkout was cancelled. Nothing was charged.</div>
        ) : null}

        {error ? (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: "#fff1ef" }}>
            {error}
          </div>
        ) : null}

        {/*
          The wallet is the only application-spend surface now, so it leads.
          The legacy `application_credits` balance is deliberately not rendered:
          it can no longer start an application, and showing a number that does
          not buy anything would be misleading.
        */}
        <section style={{ marginTop: 26 }}>
          <div className="muted" style={{ fontSize: 13 }}>Pay as you go</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 8px" }}>Wallet</h2>
          <p className="muted" style={{ margin: "0 0 18px", maxWidth: 620 }}>
            Standard Apply and Smart Apply are charged from your wallet after a verified successful
            submission — no more pre-buying credit packs.{" "}
            <Link href="/pricing" style={{ fontWeight: 700 }}>See full pricing →</Link>
          </p>
          <WalletPanel />
        </section>

        <section style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>Interview</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 12px" }}>Odesseus Live</h2>

          <div className="billing-balance-grid">
            <div className="card billing-balance-card">
              <div className="muted" style={{ fontSize: 13 }}>Interview passes</div>
              <strong>{credits?.interview_passes ?? 0}</strong>
              <span className="muted">One pass is used when Odesseus Live starts.</span>
            </div>

            {credits?.live_unlimited_until && new Date(credits.live_unlimited_until) > new Date() ? (
              <div className="card billing-balance-card">
                <div className="muted" style={{ fontSize: 13 }}>Live Annual</div>
                <strong>Active</strong>
                <span className="muted">
                  Through {new Date(credits.live_unlimited_until).toLocaleDateString()}.
                </span>
              </div>
            ) : null}
          </div>
        </section>

        <section style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>History</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 12px" }}>Recent Live purchases</h2>

          <div className="card">
            {activity.length ? activity.slice(0, 8).map((item, index) => (
              <div
                className="billing-history-row"
                key={item.id}
                style={{ borderTop: index ? "1px solid var(--line)" : "none" }}
              >
                <div>
                  <strong>{item.label}</strong>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <strong>{item.deltaText}</strong>
                  {item.amountText ? (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {item.amountText}
                    </div>
                  ) : null}
                </div>
              </div>
            )) : (
              <div className="muted" style={{ padding: 26 }}>No Live purchases yet.</div>
            )}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Earlier application purchases are no longer listed here. That currency was replaced
            by the wallet, so it is not valid for anything today.
          </p>
        </section>
      </div>
      </section>
    </AppShell>
  );
}
