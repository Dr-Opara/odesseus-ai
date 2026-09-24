import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/app/actions/billing";
import AppShell from "@/components/app-shell";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const { status, error } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: credits }, { data: wallet }, { data: walletTransactions }, { data: transactions }, { data: annualPurchases }, { data: profile }] = await Promise.all([
    supabase.from("credit_balances").select("application_credits,interview_passes,live_unlimited_until").eq("user_id", userId).maybeSingle(),
    supabase.from("wallet_balances").select("balance_cents").eq("user_id", userId).maybeSingle(),
    supabase.from("wallet_transactions").select("id,amount_cents,transaction_type,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    supabase.from("credit_transactions").select("id,credit_type,delta,reason,amount_cents,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    supabase.from("billing_events").select("id,amount_cents,created_at").eq("user_id", userId).eq("sku", "interview_annual").order("created_at", { ascending: false }).limit(8),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const activity = [
    ...(walletTransactions ?? []).map((t) => ({
      id: `wallet:${t.id}`, createdAt: t.created_at,
      label: t.transaction_type === "top_up" ? "Added funds to Odesseus wallet" : t.transaction_type === "smart_apply" ? "Smart Apply submitted" : t.transaction_type === "apply" ? "Apply submitted" : "Wallet adjustment",
      amountText: null, deltaText: `${t.amount_cents > 0 ? "+" : "-"}$${(Math.abs(t.amount_cents) / 100).toFixed(2)}`,
    })),
    ...(transactions ?? []).map((t) => ({
      id: `credit:${t.id}`, createdAt: t.created_at,
      label: `${t.delta > 0 ? "Purchased" : "Used"} ${Math.abs(t.delta)} ${t.credit_type === "application" ? "legacy application credit" : "interview pass"}${Math.abs(t.delta) === 1 ? "" : "es"}`,
      amountText: t.delta > 0 && t.amount_cents ? `$${(t.amount_cents / 100).toFixed(2)}` : null,
      deltaText: `${t.delta > 0 ? "+" : ""}${t.delta}`,
    })),
    ...(annualPurchases ?? []).map((purchase) => ({
      id: `annual:${purchase.id}`, createdAt: purchase.created_at, label: "Purchased Odesseus Live Annual",
      amountText: `$${(purchase.amount_cents / 100).toFixed(2)}`, deltaText: "12 mo",
    })),
  ].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <AppShell fullName={profile?.full_name} applicationCredits={credits?.application_credits ?? 0} interviewPasses={credits?.interview_passes ?? 0}>
      <section className="shell" style={{ padding: "54px 0 100px" }}><div style={{ width: "min(980px,100%)", margin: "20px auto 0" }}>
        <div><div className="badge">Billing</div><h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "16px 0 8px" }}>Pay for progress, not access.</h1><p className="muted" style={{ fontSize: 18 }}>Fund your wallet once. Odesseus deducts only after a successful application.</p></div>
        {status === "success" ? <div className="billing-success">Payment received. Your balance will update as soon as Stripe confirms the purchase.</div> : null}
        {status === "cancelled" ? <div className="review-note">Checkout was cancelled. Nothing was charged.</div> : null}
        {error ? <div className="review-note">{error}</div> : null}

        <div className="billing-balance-grid">
          <div className="card billing-balance-card"><div className="muted" style={{fontSize:13}}>Odesseus wallet</div><strong>{`$${((wallet?.balance_cents ?? 0)/100).toFixed(2)}`}</strong><span className="muted">Apply $0.49 · Smart Apply $1.99 after successful submission.</span></div>
          <div className="card billing-balance-card"><div className="muted" style={{fontSize:13}}>Interview passes</div><strong>{credits?.interview_passes ?? 0}</strong><span className="muted">One pass is used when Odesseus Live starts.</span></div>
        </div>
        {credits?.live_unlimited_until && new Date(credits.live_unlimited_until) > new Date() ? <div className="billing-success" style={{marginTop:18}}>Odesseus Live Annual is active through {new Date(credits.live_unlimited_until).toLocaleDateString()}.</div> : null}

        <section style={{marginTop:34}}><div className="muted" style={{fontSize:13}}>Prepaid wallet</div><h2 style={{fontSize:24,margin:"7px 0 8px"}}>Add application funds</h2><p className="muted">Avoid a separate card charge for every 49¢ or $1.99 submission.</p>
          <div className="billing-pack-grid">
            <form className="card billing-pack" action={createCheckoutSession.bind(null,"wallet_10")}><div><div className="muted">Wallet top-up</div><div className="billing-pack-number">$10</div><p className="muted">About 20 Apply submissions or 5 Smart Apply submissions.</p></div><button className="btn btn-secondary" type="submit">Add $10</button></form>
            <form className="card billing-pack" action={createCheckoutSession.bind(null,"wallet_20")}><div><div className="muted">Wallet top-up</div><div className="billing-pack-number">$20</div><p className="muted">Flexible balance for Apply and Smart Apply.</p></div><button className="btn btn-primary" type="submit">Add $20</button></form>
            <form className="card billing-pack" action={createCheckoutSession.bind(null,"wallet_50")}><div><div className="muted">Wallet top-up</div><div className="billing-pack-number">$50</div><p className="muted">Best for higher-volume application activity.</p></div><button className="btn btn-secondary" type="submit">Add $50</button></form>
          </div>
          {(credits?.application_credits ?? 0)>0 ? <p className="muted" style={{marginTop:12}}>You also have {credits?.application_credits} legacy application credit{credits?.application_credits===1?"":"s"}. Odesseus will keep honoring them during migration.</p> : null}
        </section>

        <section style={{marginTop:34}}><h2 style={{fontSize:24,margin:"0 0 18px"}}>Odesseus Live</h2><div className="card bundle-band"><div className="bundle-row">
          <form className="bundle-option" action={createCheckoutSession.bind(null,"interview_1")}><div className="bundle-option-quantity">1 Live pass</div><div className="bundle-option-price">$24.99</div><button className="btn btn-secondary" type="submit">Buy</button></form>
          <form className="bundle-option" action={createCheckoutSession.bind(null,"interview_3")}><div className="bundle-option-quantity">3 passes</div><div className="bundle-option-price">$59.99</div><button className="btn btn-secondary" type="submit">Buy</button></form>
          <form className="bundle-option is-featured" action={createCheckoutSession.bind(null,"interview_annual")}><div className="bundle-option-quantity">Live Annual</div><div className="bundle-option-price">$499</div><div className="bundle-option-unit">per year</div><button className="btn btn-primary" type="submit">Buy</button></form>
        </div><p className="bundle-fine-print">Odesseus Live is conversational interview guidance. Coding interview assistance is not included. Annual access is subject to fair use.</p></div></section>

        <section style={{marginTop:34}}><div className="muted" style={{fontSize:13}}>Recent activity</div><h2 style={{fontSize:24,margin:"7px 0 12px"}}>Wallet & passes</h2><div className="card">
          {activity.length ? activity.slice(0,8).map((item,index)=><div className="billing-history-row" key={item.id} style={{borderTop:index?"1px solid var(--line)":"none"}}><div><strong>{item.label}</strong><div className="muted" style={{fontSize:13,marginTop:4}}>{new Date(item.createdAt).toLocaleString()}</div></div><div style={{textAlign:"right"}}><strong>{item.deltaText}</strong>{item.amountText?<div className="muted" style={{fontSize:13}}>{item.amountText}</div>:null}</div></div>) : <div className="muted" style={{padding:26}}>No billing activity yet.</div>}
        </div></section>
      </div></section>
    </AppShell>
  );
}
