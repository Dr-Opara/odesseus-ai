import { createServiceClient } from "@/lib/supabase/service";
import { subscriptionStatusLabel } from "@/lib/employer/plans";

export const metadata = { title: "Billing & Operations — Odesseus Admin" };

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminBillingPage() {
  const service = createServiceClient();

  const [{ data: events }, { data: subscriptions }, { data: orgs }, { data: seatAdjustments }, { data: authUsers }] =
    await Promise.all([
      service.from("billing_events").select("id,user_id,sku,credit_type,amount_cents,currency,created_at").order("created_at", { ascending: false }).limit(50),
      service.from("employer_subscriptions").select("org_id,tier,status,period_end"),
      service.from("employer_organizations").select("id,name"),
      service.from("employer_seat_adjustments").select("id,org_id,outcome,error,previous_quantity,new_quantity,created_at").order("created_at", { ascending: false }).limit(50),
      service.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);

  const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));
  const orgById = new Map((orgs || []).map((org) => [org.id, org.name]));

  const pastDue = (subscriptions || []).filter((s) => s.status === "past_due" || s.status === "incomplete");
  const failedSeatSync = (seatAdjustments || []).filter((a) => a.outcome !== "applied" && a.outcome !== "succeeded");

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Billing</div>
          <h1>Billing & operations</h1>
          <p className="muted">Payment issues, wallet purchase events, and seat sync state.</p>
        </div>
      </div>

      <div className="admin-stat-grid">
        <div className="card admin-stat-card">
          <strong>{pastDue.length}</strong>
          <span className="muted">Subscriptions past due / incomplete</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{failedSeatSync.length}</strong>
          <span className="muted">Seat sync issues (last 50)</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{events?.length || 0}</strong>
          <span className="muted">Recent billing events</span>
        </div>
      </div>

      {pastDue.length ? (
        <section className="card admin-section-card">
          <h2>Subscriptions needing attention</h2>
          <div className="admin-table">
            {pastDue.map((sub) => (
              <div className="admin-row" key={sub.org_id} style={{ ["--admin-row-cols" as string]: "1.4fr 1fr 1fr" }}>
                <span><strong>{orgById.get(sub.org_id) || sub.org_id}</strong></span>
                <span>{subscriptionStatusLabel(sub.status)}</span>
                <span>{sub.period_end ? `Ends ${new Date(sub.period_end).toLocaleDateString()}` : "—"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {failedSeatSync.length ? (
        <section className="card admin-section-card">
          <h2>Seat synchronization issues</h2>
          <div className="admin-table">
            {failedSeatSync.map((adjustment) => (
              <div className="admin-row" key={adjustment.id} style={{ ["--admin-row-cols" as string]: "1.4fr .6fr .6fr 1.4fr" }}>
                <span><strong>{orgById.get(adjustment.org_id) || adjustment.org_id}</strong></span>
                <span>{adjustment.previous_quantity ?? "—"} → {adjustment.new_quantity}</span>
                <span>{adjustment.outcome}</span>
                <span>{adjustment.error || "—"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card admin-section-card">
        <h2>Recent billing events</h2>
        {events?.length ? (
          <div className="admin-table">
            <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.4fr .8fr .8fr .8fr" }}>
              <span>Account</span><span>SKU</span><span>Type</span><span>Amount</span>
            </div>
            {events.map((event) => (
              <div className="admin-row" key={event.id} style={{ ["--admin-row-cols" as string]: "1.4fr .8fr .8fr .8fr" }}>
                <span>{emailById.get(event.user_id) || event.user_id}</span>
                <span>{event.sku}</span>
                <span>{event.credit_type}</span>
                <span>{formatCents(event.amount_cents)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No billing events recorded yet.</div>
        )}
      </section>
    </main>
  );
}
