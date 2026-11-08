import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/app/actions/billing";
import { billingCatalog, legacyLiveSubscriptions, liveSkus, LIVE_FAIR_USE } from "@/lib/billing/catalog";
import {
  APPLICATION_CREDIT_PACKS,
  APPLICATION_PRICE_LABEL,
  formatUsd,
} from "@/lib/pricing/candidate-pricing";
import AppShell from "@/components/app-shell";
import CandidateAutoCheckout from "@/components/pricing/candidate-auto-checkout";

// Amounts are read from the sellable catalog rather than hardcoded so the
// page can never advertise a price the checkout action would reject.

/** Human label for one ledger credit_type. */
function activityLabel(creditType: string, delta: number): string {
  if (creditType === "wallet_topup") return "Wallet top-up";
  if (creditType === "admin_adjustment") return "Balance adjustment";
  if (creditType === "standard_apply" || creditType === "smart_apply") {
    return delta < 0 ? "Application paid from wallet balance" : "Wallet refund";
  }
  const unit = creditType === "interview" ? "interview pass" : "application credit";
  return `${delta > 0 ? "Added" : "Used"} ${Math.abs(delta)} ${unit}${Math.abs(delta) === 1 ? "" : "s"}`;
}

function isWalletType(creditType: string) {
  return ["wallet_topup", "standard_apply", "smart_apply", "admin_adjustment"].includes(creditType);
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; purchase?: string }>;
}) {
  const { status, error, purchase } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const [{ data: credits }, { data: transactions }, { data: annualPurchases }, { data: profile }] = await Promise.all([
    supabase
      .from("credit_balances")
      .select("application_credits,wallet_balance_cents,interview_passes,live_unlimited_until")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_transactions")
      .select("id,credit_type,delta,reason,amount_cents,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    // Time-boxed Live entitlements (Annual, and subscriptions bought under the
    // earlier contract) never write a credit_transactions row (see
    // fulfill_billing_event), so without this they would never appear in
    // "Recent activity" despite being real purchases.
    supabase
      .from("billing_events")
      .select("id,sku,amount_cents,created_at")
      .eq("user_id", userId)
      .in("sku", ["live_monthly", "live_personal_annual", "live_share_annual", "interview_annual"])
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const purchaseSku =
    purchase && purchase in billingCatalog
      ? (purchase as keyof typeof billingCatalog)
      : null;

  const activity = [
    ...(transactions ?? []).map((t) => ({
      id: `credit:${t.id}`,
      createdAt: t.created_at,
      label: activityLabel(t.credit_type, t.delta),
      amountText: t.delta > 0 && t.amount_cents && t.credit_type !== "admin_adjustment" ? formatUsd(t.amount_cents) : null,
      deltaText: isWalletType(t.credit_type)
        ? `${t.delta > 0 ? "+" : "−"}$${(Math.abs(t.delta) / 100).toFixed(2)}`
        : `${t.delta > 0 ? "+" : ""}${t.delta}`,
    })),
    ...(annualPurchases ?? []).map((purchase) => {
      const label =
        purchase.sku in billingCatalog
          ? billingCatalog[purchase.sku as keyof typeof billingCatalog].label
          : purchase.sku in legacyLiveSubscriptions
            ? legacyLiveSubscriptions[purchase.sku as keyof typeof legacyLiveSubscriptions].label
            : "Odesseus Live";
      return {
        id: `live:${purchase.id}`,
        createdAt: purchase.created_at,
        label: `Purchased ${label}`,
        amountText: formatUsd(purchase.amount_cents),
        deltaText: purchase.sku === "live_monthly" ? "1 mo" : "12 mo",
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const applicationCredits = credits?.application_credits ?? 0;
  const walletBalanceCents = credits?.wallet_balance_cents ?? 0;
  const annualUntil = credits?.live_unlimited_until ?? null;
  const annualActive = annualUntil !== null && new Date(annualUntil) > new Date();

  return (
    <AppShell
      fullName={profile?.full_name}
      applicationCredits={credits?.application_credits ?? 0}
      walletBalanceCents={credits?.wallet_balance_cents ?? 0}
      interviewPasses={credits?.interview_passes ?? 0}
    >
      <section className="shell" style={{ padding: "54px 0 100px" }}>
      <div className="candidate-column-wide" style={{ marginTop: 20 }}>
        <div>
          <div className="badge">Billing</div>
          <h1 className="page-title">
            Pay for progress, not access.
          </h1>
          <p className="muted page-subtitle" style={{ maxWidth: 650 }}>
            No subscription. Pay when Odesseus works for you.
          </p>
        </div>

        {purchaseSku ? <CandidateAutoCheckout sku={purchaseSku} /> : null}

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
            <div className="muted" style={{ fontSize: 13 }}>Application credits</div>
            <strong>{applicationCredits}</strong>
            <span className="muted">
              1 credit = 1 verified successful application ({APPLICATION_PRICE_LABEL}). Failed, unsupported,
              cancelled, closed-role or unconfirmed applications use nothing.
            </span>
          </div>

          <div className="card billing-balance-card">
            <div className="muted" style={{ fontSize: 13 }}>Interview passes</div>
            <strong>{credits?.interview_passes ?? 0}</strong>
            <span className="muted">One pass is used only when an Odesseus Live interview activates.</span>
          </div>
        </div>

        {walletBalanceCents > 0 ? (
          <div className="review-note">
            You have a {formatUsd(walletBalanceCents)} wallet balance from an earlier purchase. It still pays for
            applications at {APPLICATION_PRICE_LABEL} each once your credits run out.
          </div>
        ) : null}

        {annualActive ? (
          <div className="billing-success" style={{ marginTop: 18 }}>
            Odesseus Live Annual is active through {annualUntil ? new Date(annualUntil).toLocaleDateString() : ""}.
          </div>
        ) : null}

        <section id="application-credits" style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>Apply with Odesseus</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 18px" }}>Application credits</h2>
          <div className="card bundle-band">
            <p className="muted" style={{ margin: "0 0 4px" }}>
              Odesseus matches the role, tailors your resume, and submits the application after you approve it.
              A credit is used only after a verified successful submission — Apply and Smart Apply cost the same.
            </p>
            <div className="bundle-row">
              {APPLICATION_CREDIT_PACKS.map((pack) => (
                <form
                  className={pack.credits === 50 ? "bundle-option is-featured" : "bundle-option"}
                  key={pack.sku}
                  action={createCheckoutSession.bind(null, pack.sku)}
                >
                  <div className="bundle-option-quantity">
                    {pack.credits} {pack.credits === 1 ? "credit" : "credits"}
                  </div>
                  <div className="bundle-option-price">{pack.priceLabel}</div>
                  <div className="bundle-option-unit">
                    {pack.perCreditLabel}
                    {pack.savingsPercent > 0 ? ` · save ${pack.savingsPercent}%` : ""}
                  </div>
                  <button className={pack.credits === 50 ? "btn btn-primary" : "btn btn-secondary"} type="submit">
                    Buy
                  </button>
                </form>
              ))}
            </div>
            <p className="bundle-fine-print">
              Credits don&apos;t expire. Works across supported job boards and employer career sites — no
              platform-specific fee. Prices are in USD.
            </p>
          </div>
        </section>

        <section id="interview-passes" style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>Desktop only</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 18px" }}>Odesseus Live</h2>
          <div className="card bundle-band">
            <p className="muted" style={{ margin: "0 0 4px" }}>
              1 pass = 1 successfully activated Odesseus Live interview round. A pass is only spent when a session
              actually starts, and reconnecting to it is free. Interview Prep is always free.
            </p>
            <div className="bundle-row">
              {liveSkus.map((sku) => {
                const item = billingCatalog[sku];
                const featured = sku === "interview_3";
                return (
                  <form
                    className={featured ? "bundle-option is-featured" : "bundle-option"}
                    key={sku}
                    action={createCheckoutSession.bind(null, sku)}
                  >
                    <div className="bundle-option-quantity">{item.label.replace("Odesseus Live — ", "")}</div>
                    <div className="bundle-option-price">{formatUsd(item.amountCents)}</div>
                    <div className="bundle-option-unit">
                      {sku === "interview_annual" ? "12 months · one-time" : "one-time"}
                    </div>
                    <button className={featured ? "btn btn-primary" : "btn btn-secondary"} type="submit">
                      Buy
                    </button>
                  </form>
                );
              })}
            </div>
            <p className="bundle-fine-print">
              Odesseus Live Annual covers up to {LIVE_FAIR_USE.sessions} Live sessions in a rolling{" "}
              {LIVE_FAIR_USE.windowDays}-day window (fair use). No subscription — it does not renew automatically.
            </p>
          </div>
        </section>

        <section style={{ marginTop: 34 }}>
          <div className="muted" style={{ fontSize: 13 }}>Recent activity</div>
          <h2 style={{ fontSize: 24, margin: "7px 0 12px" }}>Purchases and usage</h2>

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
              <div className="muted" style={{ padding: 26 }}>No purchases or usage yet.</div>
            )}
          </div>
        </section>
      </div>
      </section>
    </AppShell>
  );
}
