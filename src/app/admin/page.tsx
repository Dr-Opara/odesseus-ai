import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = {
  title: "Admin Dashboard — Odesseus",
  description: "Platform overview for users, employers, applications, wallet, jobs, and Live.",
};

async function loadStats() {
  const service = createServiceClient();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: candidateCount },
    { count: employerCount },
    { count: applicationCount },
    { count: applicationsThisWeek },
    { count: publishedJobCount },
    { count: activeLiveCount },
    { count: liveSessionsThisWeek },
    { data: wallets },
  ] = await Promise.all([
    service.from("profiles").select("id", { count: "exact", head: true }),
    service.from("employer_organizations").select("id", { count: "exact", head: true }),
    service.from("applications").select("id", { count: "exact", head: true }),
    service.from("applications").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    service.from("employer_jobs").select("id", { count: "exact", head: true }).eq("status", "published"),
    service.from("live_interview_sessions").select("id", { count: "exact", head: true }).eq("status", "active"),
    service.from("live_interview_sessions").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    service.from("credit_balances").select("wallet_balance_cents"),
  ]);

  const walletVolumeCents = (wallets || []).reduce(
    (sum: number, row: { wallet_balance_cents: number }) => sum + (row.wallet_balance_cents || 0),
    0
  );

  return {
    candidateCount: candidateCount || 0,
    employerCount: employerCount || 0,
    applicationCount: applicationCount || 0,
    applicationsThisWeek: applicationsThisWeek || 0,
    publishedJobCount: publishedJobCount || 0,
    activeLiveCount: activeLiveCount || 0,
    liveSessionsThisWeek: liveSessionsThisWeek || 0,
    walletVolumeCents,
    walletHolders: (wallets || []).length,
  };
}

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function AdminDashboardPage() {
  const stats = await loadStats();

  const quickLinks = [
    { href: "/admin/users", icon: "👤", title: "Users", body: "Search accounts, review balances, manage account state." },
    { href: "/admin/wallets", icon: "💰", title: "Wallets", body: "Balances, transaction history, and adjustments." },
    { href: "/admin/applications", icon: "📋", title: "Applications", body: "Standard & Smart Apply runs, failures, status events." },
    { href: "/admin/employers", icon: "🏢", title: "Employers", body: "Organizations, subscriptions, seats, jobs." },
  ];

  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin</div>
          <h1>Platform overview</h1>
          <p className="muted">Live counts pulled directly from the database.</p>
        </div>
      </div>

      <div className="admin-stat-grid">
        <div className="card admin-stat-card">
          <strong>{stats.candidateCount.toLocaleString()}</strong>
          <span className="muted">Candidate profiles</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{stats.employerCount.toLocaleString()}</strong>
          <span className="muted">Employer organizations</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{stats.applicationCount.toLocaleString()}</strong>
          <span className="muted">Applications ({stats.applicationsThisWeek} this week)</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{formatCents(stats.walletVolumeCents)}</strong>
          <span className="muted">Wallet volume across {stats.walletHolders} accounts</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{stats.publishedJobCount.toLocaleString()}</strong>
          <span className="muted">Published job postings</span>
        </div>
        <div className="card admin-stat-card">
          <strong>{stats.activeLiveCount.toLocaleString()}</strong>
          <span className="muted">Active Live sessions ({stats.liveSessionsThisWeek} this week)</span>
        </div>
      </div>

      <div className="admin-section-card" style={{ marginTop: 28 }}>
        <h2>Quick links</h2>
        <div className="admin-quick-actions">
          {quickLinks.map((link) => (
            <Link href={link.href} className="admin-action-link" key={link.href}>
              <div className="admin-action-item">
                <span className="admin-action-icon">{link.icon}</span>
                <div>
                  <strong>{link.title}</strong>
                  <span className="muted">{link.body}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
