import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/app/actions/billing";
import { billingCatalog, applyRates } from "@/lib/billing/catalog";
import AppShell from "@/components/app-shell";

/** Formats integer minor units as a USD string (e.g. 49 -> "$0.49"). */
const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Amounts are read from the sellable catalog rather than hardcoded so the
// page can never advertise a price the checkout action would reject. The
// wallet top-ups below are the only way a candidate funds Apply under the
// current contract (Standard Apply 49c / Smart Apply 199c are wallet debits,
// not purchasable products).
const WALLET_TOPUPS = [
  { sku: "wallet_10", blurb: "Covers roughly 20 Standard Apply submissions." },
  { sku: "wallet_20", blurb: "Covers roughly 40 Standard Apply submissions." },
  { sku: "wallet_50", blurb: "Covers roughly 100 Standard Apply submissions." },
] as const;

/** Human label for one wallet/credit ledger credit_type. */
function activityLabel(creditType: string, delta: number): string {
  const unit =
    creditType === "wallet_topup"
      ? "wallet top-up"
      : creditType === "standard_apply"
        ? "Standard Apply"
        : creditType === "smart_apply"
          ? "Smart Apply"
          : creditType === "interview"
            ? "interview pass"
            : "application credit";
  return `${delta > 0 ? "Purchased" : "Used"} ${Math.abs(delta)} ${unit}${Math.abs(delta) === 1 || creditType === "wallet_topup" ? "" : "s"}`;
}

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

  const activity = [
    ...(transactions ?? []).map((t) => ({
      id: `credit:${t.id}`,
      createdAt: t.created_at,
      label: activityLabel(t.credit_type, t.delta),
      amountText: t.delta > 0 && t.amount_cents ? `$${(t.amount_cents / 100).toFixed(2)}` : null,
      deltaText: t.credit_type === "wallet_topup" ? `+$${(t.amount_cents ?? 0) / 100}` : `${t.delta > 0 ? "+" : ""}${t.delta}`,
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
      // The legacy application_credits column is retired (Gate 0 confirmed zero
      // rows) and is no longer read here; the wallet is the candidate's money.
      // The AppShell sidebar badge itself is frontend-owned and is handed off
      // for removal.
      applicationCredits={0}
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

        <div className="billing-balance-grid">
          <div className="card billing-balance-card">
            <div className="muted" style={{ fontSize: 13 }}>Wallet</div>
            <strong>${((credits?.wallet_balance_cents ?? 0) / 100).toFixed(2)}</strong>
            <span className="muted">
              Standard Apply {formatUsd(applyRates.standard.amountCents)} and Smart Apply {formatUsd(applyRates.smart.amountCents)} are charged only after a verified successful submission.
            </span>
          </div>

          <div className="card billing-balance-card">
            <div className="muted" style={{ fontSize: 13 }}>Interview passes</div>
            <strong>{credits?.interview_passes ?? 0}</strong>
            <span className="muted">One pass is used when Odesseus Live starts.</span>
          </div>
        </div>

        {credits?.live_unlimited_until && new Date(credits.live_unlimited_until) > new Date() ? (
          <div className="billing-success" style={{ marginTop: 18 }}>
            Odesseus Live Annual is active through {new Date(credits.live_unlimited_until).toLocaleDateString()}.
          </div>
        ) : null}

        <section style={{ marginTop: 34 }}>
          <div className="billing-pack-grid">
            <div className="card billing-pack">
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Apply with Odesseus</div>
                <div className="billing-pack-number">
                  ${(applyRates.standard.amountCents / 100).toFixed(2)}
                  <span className="muted" style={{ fontSize: 18 }}> / ${(applyRates.smart.amountCents / 100).toFixed(2)}</span>
                </div>
                <p className="muted" style={{ lineHeight: 1.55 }}>
                  Odesseus matches the role, tailors your resume, completes the application, submits it, and tracks it.
                </p>
                <p className="muted" style={{ lineHeight: 1.55 }}>
                  Standard Apply {formatUsd(applyRates.standard.amountCents)} and Smart Apply {formatUsd(applyRates.smart.amountCents)} are taken from your wallet only after a verified successful submission.
                </p>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Apply across supported job boards and direct employer career sites — no platform-specific fee. Includes Workday, Indeed, UN Careers / UN job portals, Greenhouse, Lever, Ashby, iCIMS, direct company career websites, corporate ATS portals, and other supported job boards and employer application sites.
                </p>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>Add funds below to start applying.</div>
            </div>

            <form className="card billing-pack" action={createCheckoutSession.bind(null, "interview_1")}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Odesseus Live</div>
                <div className="billing-pack-number">$24.99</div>
                <p className="muted" style={{ lineHeight: 1.55 }}>
                  Your AI interview companion—from preparation through follow-up.
                </p>
                <p className="muted" style={{ lineHeight: 1.55 }}>
                  One interview. One pass. Everything included.
                </p>
              </div>
              <button className="btn btn-primary" type="submit">Buy an interview pass</button>
            </form>
          </div>
        </section>

        <section style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>Add funds</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 18px" }}>Wallet top-ups</h2>
          <div className="card bundle-band">
            <p className="muted" style={{ margin: "0 0 4px" }}>
              Apply is billed from your wallet after a verified successful submission — never at the moment you start.
            </p>
            <div className="bundle-row">
              {WALLET_TOPUPS.map((topup) => {
                const item = billingCatalog[topup.sku];
                return (
                  <form className="bundle-option" key={topup.sku} action={createCheckoutSession.bind(null, topup.sku)}>
                    <div className="bundle-option-quantity">${(item.amountCents / 100).toFixed(0)}</div>
                    <div className="bundle-option-price">${(item.amountCents / 100).toFixed(2)}</div>
                    <button className="btn btn-secondary" type="submit">Top up</button>
                  </form>
                );
              })}
            </div>
            <p className="bundle-fine-print">{WALLET_TOPUPS[0].blurb} Failed, cancelled, or unverified submissions never deduct from your wallet.</p>
          </div>
        </section>

        <section style={{ marginTop: 34 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 18px" }}>Interview passes</h2>
          <div className="card bundle-band">
            <p className="muted" style={{ margin: "0 0 4px" }}>1 interview pass = 1 successfully activated Odesseus Live interview round.</p>
            <div className="bundle-row bundle-row-2">
              <form className="bundle-option" action={createCheckoutSession.bind(null, "interview_3")}>
                <div className="bundle-option-quantity">3 passes</div>
                <div className="bundle-option-price">$59.99</div>
                <button className="btn btn-secondary" type="submit">Buy</button>
              </form>
              <form className="bundle-option is-featured" action={createCheckoutSession.bind(null, "interview_annual")}>
                <div className="bundle-option-quantity">Odesseus Live Annual</div>
                <div className="bundle-option-price">$499</div>
                <div className="bundle-option-unit">per year</div>
                <button className="btn btn-primary" type="submit">Buy</button>
              </form>
            </div>
            <p className="bundle-fine-print">Odesseus Live Annual is subject to fair use.</p>
          </div>
        </section>

        <section style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>Recent activity</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 12px" }}>Credits</h2>

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
              <div className="muted" style={{ padding: 26 }}>No credit activity yet.</div>
            )}
          </div>
        </section>
      </div>
      </section>
    </AppShell>
  );
}
